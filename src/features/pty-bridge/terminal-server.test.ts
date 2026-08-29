import { describe, expect, it } from "vitest";
import type { WebSocket } from "ws";
import { Config } from "../../shared/config/index.js";
import { PtyManager, type PtyLike } from "./pty.js";
import { attachTerminal, isTrustedRequest, toText } from "./terminal-server.js";

/** Minimal fake pty. node-pty supports many onData/onExit subscribers
 * (EventEmitter semantics), so the fake keeps subscription sets too. */
function fakePty() {
  const writes: string[] = [];
  const resizes: { cols: number; rows: number }[] = [];
  const dataSubs = new Set<(data: string) => void>();
  const exitSubs = new Set<(info: { exitCode?: number }) => void>();
  let killed = false;
  const pty: PtyLike = {
    onData(cb: (data: string) => void) {
      dataSubs.add(cb);
      return {
        dispose: () => {
          dataSubs.delete(cb);
        },
      };
    },
    onExit(cb: (info: { exitCode?: number }) => void) {
      exitSubs.add(cb);
      return {
        dispose: () => {
          exitSubs.delete(cb);
        },
      };
    },
    write(data: string) {
      writes.push(data);
    },
    resize(cols: number, rows: number) {
      resizes.push({ cols, rows });
    },
    kill() {
      killed = true;
    },
  };
  return {
    pty,
    writes,
    resizes,
    get killed() {
      return killed;
    },
    emitData(data: string) {
      for (const cb of dataSubs) cb(data);
    },
    emitExit(info: { exitCode?: number } = {}) {
      for (const cb of exitSubs) cb(info);
    },
  };
}

function fakeModule() {
  const spawned: ReturnType<typeof fakePty>[] = [];
  return {
    spawn(_file: string, _args: string[], _options: Record<string, unknown>) {
      const fake = fakePty();
      spawned.push(fake);
      return fake.pty;
    },
    spawned,
  };
}

/** Minimal fake ws (records sends/closes; emits into registered handlers). */
function fakeWs() {
  const handlers = new Map<string, ((...args: unknown[]) => void)[]>();
  const sent: string[] = [];
  const closed: { code: number | null; reason: string | null }[] = [];
  const ws = {
    readyState: 1,
    bufferedAmount: 0,
    send: (data: string) => {
      sent.push(data);
    },
    close: (code?: number, reason?: string) => {
      closed.push({ code: code ?? null, reason: reason ?? null });
    },
    on: (event: string, cb: (...args: unknown[]) => void) => {
      const list = handlers.get(event) ?? [];
      list.push(cb);
      handlers.set(event, list);
    },
  } as unknown as WebSocket;
  const emit = (event: string, ...args: unknown[]) => {
    for (const cb of handlers.get(event) ?? []) cb(...args);
  };
  return { ws, sent, closed, emit };
}

const noCtx = { get: () => undefined };

describe("isTrustedRequest", () => {
  it("accepts loopback authorities and rejects cross-site requests", () => {
    expect(isTrustedRequest({ headers: { host: "127.0.0.1:3000" } })).toBe(true);
    expect(isTrustedRequest({ headers: { host: "localhost:3000" } })).toBe(true);
    expect(
      isTrustedRequest({ headers: { host: "127.0.0.1:3000", "sec-fetch-site": "cross-site" } }),
    ).toBe(false);
    expect(
      isTrustedRequest({ headers: { host: "evil.example:3000", origin: "https://evil.example" } }),
    ).toBe(true);
    expect(
      isTrustedRequest({ headers: { host: "evil.example:3000", origin: "https://other.example" } }),
    ).toBe(false);
  });
});

describe("toText", () => {
  it("decodes all RawData shapes", () => {
    expect(toText(Buffer.from("hi"))).toBe("hi");
    expect(toText("plain")).toBe("plain");
    expect(toText([Buffer.from("a"), Buffer.from("b")])).toBe("ab");
    expect(toText(Uint8Array.from([97]).buffer)).toBe("a");
  });
});

describe("attachTerminal", () => {
  it("closes with 1008 when session/tab params are missing", () => {
    const { ws, closed } = fakeWs();
    attachTerminal(noCtx, null, Config({}), ws, { url: "/dock-terminal/ws" });
    expect(closed[0]?.code).toBe(1008);
  });

  it("closes with 1011 when node-pty is unavailable", () => {
    const { ws, closed } = fakeWs();
    attachTerminal(noCtx, null, Config({}), ws, {
      url: "/dock-terminal/ws?sessionId=s1&tab=t1",
    });
    expect(closed[0]?.code).toBe(1011);
  });

  it("replays transcript, writes keyboard input, resizes, and closes", () => {
    const module = fakeModule();
    const manager = new PtyManager(module, Config({}));
    const { ws, sent, emit } = fakeWs();

    attachTerminal(noCtx, manager, Config({}), ws, {
      url: "/dock-terminal/ws?sessionId=s1&tab=t1",
    });
    const fake = module.spawned[0]!;

    // The first frame is the meta frame (shell/cwd/cap), then raw output.
    expect(JSON.parse(sent[0]!)).toMatchObject({ type: "meta", maxPerSession: 3 });
    expect(sent).toHaveLength(1);

    // Keyboard input is written verbatim; control frames are not.
    emit("message", Buffer.from("echo hi"));
    expect(fake.writes.at(-1)).toBe("echo hi");
    emit("message", JSON.stringify({ type: "resize", cols: 120, rows: 40 }));
    expect(fake.resizes.at(-1)).toEqual({ cols: 120, rows: 40 });
    emit("message", JSON.stringify({ type: "close" }));
    expect(fake.killed).toBe(true);
    expect(sent).toHaveLength(1);
  });

  it("an explicit close frame wins over the socket-close grace window", () => {
    const module = fakeModule();
    const manager = new PtyManager(module, Config({}));
    const { ws, emit } = fakeWs();
    attachTerminal(noCtx, manager, Config({}), ws, {
      url: "/dock-terminal/ws?sessionId=s1&tab=t1",
    });
    const fake = module.spawned[0]!;

    // User close kills synchronously; the socket close event that follows
    // must NOT re-arm a reconnect-grace timer for the dead key.
    emit("message", JSON.stringify({ type: "close" }));
    emit("close");
    expect(fake.killed).toBe(true);
    expect(manager.isLive("s1:t1")).toBe(false);
    expect(manager.isParked("s1:t1")).toBe(false);

    // A reconnect after an explicit close spawns a fresh pty, never the dead one.
    const second = fakeWs();
    attachTerminal(noCtx, manager, Config({}), second.ws, {
      url: "/dock-terminal/ws?sessionId=s1&tab=t1",
    });
    expect(module.spawned).toHaveLength(2);
    expect(JSON.parse(second.sent[0]!)).toMatchObject({ type: "meta" });
    expect(second.sent).toHaveLength(1);
  });

  it("park is a no-op on a dead key (no zombie park left behind)", () => {
    const module = fakeModule();
    const manager = new PtyManager(module, Config({}));
    const { ws, emit } = fakeWs();
    attachTerminal(noCtx, manager, Config({}), ws, {
      url: "/dock-terminal/ws?sessionId=s1&tab=t1",
    });
    emit("message", JSON.stringify({ type: "close" }));
    expect(module.spawned[0]!.killed).toBe(true);

    emit("message", JSON.stringify({ type: "park" }));
    expect(manager.isParked("s1:t1")).toBe(false);
  });

  it("a stale socket close never schedules grace while a newer socket is attached", async () => {
    const module = fakeModule();
    const config = Config({ reconnectGraceMs: 40 });
    const manager = new PtyManager(module, config);
    const first = fakeWs();
    attachTerminal(noCtx, manager, config, first.ws, {
      url: "/dock-terminal/ws?sessionId=s1&tab=t1",
    });
    const fake = module.spawned[0]!;

    // The popover re-attaches (new socket) before the old socket's close
    // event lands: the old close must not start the reconnect grace timer
    // for a key that is still being served by the newer socket.
    const second = fakeWs();
    attachTerminal(noCtx, manager, config, second.ws, {
      url: "/dock-terminal/ws?sessionId=s1&tab=t1",
    });
    expect(manager.hasSockets("s1:t1")).toBe(true);

    first.emit("close");
    expect(fake.killed).toBe(false);
    expect(manager.isLive("s1:t1")).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(fake.killed).toBe(false);

    // The last socket dropping starts the grace countdown, which then closes.
    second.emit("close");
    expect(manager.hasSockets("s1:t1")).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(fake.killed).toBe(true);
  });

  it("replays the transcript on reopen and parks on a park frame", () => {
    const module = fakeModule();
    const manager = new PtyManager(module, Config({}));
    const first = fakeWs();
    attachTerminal(noCtx, manager, Config({}), first.ws, {
      url: "/dock-terminal/ws?sessionId=s1&tab=t1",
    });
    const fake = module.spawned[0]!;
    fake.emitData("prompt> ");
    first.emit("close");

    // Reconnect within the grace window: same pty, meta then transcript replay.
    const second = fakeWs();
    attachTerminal(noCtx, manager, Config({}), second.ws, {
      url: "/dock-terminal/ws?sessionId=s1&tab=t1",
    });
    expect(JSON.parse(second.sent[0]!)).toMatchObject({ type: "meta", cwd: process.cwd() });
    expect(second.sent[1]).toBe("prompt> ");
    expect(fake.killed).toBe(false);

    // Park frame marks the handle; a later socket drop keeps the pty alive.
    second.emit("message", JSON.stringify({ type: "park" }));
    second.emit("close");
    expect(fake.killed).toBe(false);
  });
});
