import { describe, expect, it, vi } from "vitest";
import { apply, Config } from "./index.js";
import { PtyManager } from "./pty.js";

/** Minimal fake pty (records writes/resizes, exposes simple emit helpers). */
function fakePty() {
  let dataSub: ((data: string) => void) | null = null;
  let exitSub: (() => void) | null = null;
  let killed = false;
  const pty = {
    onData(cb: (data: string) => void) {
      dataSub = cb;
      return { dispose: () => undefined };
    },
    onExit(cb: () => void) {
      exitSub = cb;
      return { dispose: () => undefined };
    },
    write(): void {
      return;
    },
    resize(): void {
      return;
    },
    kill() {
      killed = true;
    },
  };
  return {
    pty,
    get killed() {
      return killed;
    },
    emitData(data: string) {
      dataSub?.(data);
    },
    emitExit() {
      exitSub?.();
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

describe("Config schema", () => {
  it("fills defaults and rejects an out-of-range cap", () => {
    const cfg = Config.parse({});
    expect(cfg.shell).toBe("");
    expect(cfg.shellArgs).toEqual([]);
    expect(cfg.maxPerSession).toBe(2);
    expect(cfg.reconnectGraceMs).toBe(30000);

    expect(() => Config.parse({ maxPerSession: 0 })).toThrow();
    expect(() => Config.parse({ maxPerSession: 99 })).toThrow();
  });
});

describe("apply (host root)", () => {
  it("registers the ws upgrade route and wires teardown to the fibre", () => {
    const upgrades: { path: string; handler: unknown }[] = [];
    const effects: (() => unknown)[] = [];
    const ctx = {
      webServer: {
        registerUpgrade: (route: { path: string; handler: unknown }) => {
          upgrades.push(route);
          return () => undefined;
        },
      },
      get: () => undefined,
      logger: () => ({ warn: () => undefined }),
      effect: (fn: () => unknown) => {
        effects.push(fn);
        return fn();
      },
    };

    apply(ctx, {});
    expect(upgrades).toHaveLength(1);
    expect(upgrades[0]?.path).toBe("/dock-terminal/ws");
    expect(typeof upgrades[0]?.handler).toBe("function");
    // Two effects: the upgrade route and the teardown disposer.
    expect(effects).toHaveLength(2);
    const dispose = effects[1]!() as () => void;
    expect(dispose).toBeTypeOf("function");
    dispose(); // manager.disposeAll + wss.close must not throw
  });

  it("rejects untrusted upgrade requests before any socket work", () => {
    const upgrades: {
      path: string;
      handler: (req: unknown, socket: { destroy: () => void }, head: unknown) => void;
    }[] = [];
    const ctx = {
      webServer: {
        registerUpgrade: (route: {
          path: string;
          handler: (req: unknown, socket: { destroy: () => void }, head: unknown) => void;
        }) => {
          upgrades.push(route);
          return () => undefined;
        },
      },
      get: () => undefined,
      logger: () => ({ warn: () => undefined }),
      effect: (fn: () => unknown) => fn(),
    };
    apply(ctx, {});
    const handler = upgrades[0]!.handler;
    const destroy = { destroy: vi.fn() };
    handler({ headers: { host: "127.0.0.1:3000", "sec-fetch-site": "cross-site" } }, destroy, {});
    expect(destroy.destroy).toHaveBeenCalled();
  });

  it("still registers the route when node-pty is missing", () => {
    const upgrades: { path: string; handler: unknown }[] = [];
    const ctx = {
      webServer: {
        registerUpgrade: (route: { path: string; handler: unknown }) => {
          upgrades.push(route);
          return () => undefined;
        },
      },
      get: () => undefined,
      logger: () => ({ warn: () => undefined }),
      effect: (fn: () => unknown) => fn(),
    };
    // apply must not throw even when the native module is unavailable
    // (the route stays registered and answers with a 1011 close).
    expect(() => apply(ctx, {})).not.toThrow();
    expect(upgrades).toHaveLength(1);
  });
});

describe("PtyManager", () => {
  it("spawns one pty per session/tab key and replays its transcript", () => {
    const module = fakeModule();
    const manager = new PtyManager(module as never, Config.parse({ shell: "/bin/sh" }));
    const handle = manager.open("s1", "t1", "/tmp", 80, 24);
    const fake = module.spawned[0]!;

    fake.emitData("hello");
    expect(handle.transcript).toBe("hello");

    // Same key, same cwd: reuse the running pty.
    const again = manager.open("s1", "t1", "/tmp", 80, 24);
    expect(again).toBe(handle);
    expect(module.spawned).toHaveLength(1);
  });

  it("enforces the per-session cap and kills on close", async () => {
    const module = fakeModule();
    const manager = new PtyManager(module as never, Config.parse({ maxPerSession: 1 }));
    manager.open("s1", "t1", "/tmp", 80, 24);
    expect(() => manager.open("s1", "t2", "/tmp", 80, 24)).toThrow(/terminal limit/);

    manager.scheduleClose("s1:t1", 0);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const fake = module.spawned[0]!;
    expect(fake.killed).toBe(true);
  });

  it("parks across session switches; a close frame still kills the pty", async () => {
    const module = fakeModule();
    const manager = new PtyManager(module as never, Config.parse({ reconnectGraceMs: 200 }));
    manager.open("s1", "t1", "/tmp", 80, 24);
    const fake = module.spawned[0]!;

    // park marks the drop-grace exemption; the pty stays alive.
    manager.park("s1:t1");
    expect(manager.isParked("s1:t1")).toBe(true);

    // An explicit close frame (user closed the popover) kills even parked.
    manager.scheduleClose("s1:t1", 0);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(fake.killed).toBe(true);
  });
});
