import { describe, expect, it, vi } from "vitest";
import { registerAgentTerminalTools, type TerminalsLike, type ToolsHost } from "./tools.js";

/** Collects tool definitions and exposes captured calls. */
function fakeHost() {
  const definitions: {
    name: string;
    execute: (args: unknown, exec: unknown) => Promise<unknown>;
    output?: { render?: (args: never, value: never) => unknown };
  }[] = [];
  const host: ToolsHost = {
    tools: {
      register: (definition: unknown) => {
        definitions.push(definition as (typeof definitions)[number]);
        return () => undefined;
      },
    },
  };
  return { host, definitions };
}

function fakeTerminals() {
  const calls: { method: string; args: unknown[] }[] = [];
  const donePromise = Promise.resolve({
    viewport: "\r\nok\r\n$ ",
    waitReason: "ready",
    sessionStatus: { kind: "running" },
    truncated: false,
  });
  const terminals: TerminalsLike = {
    spawn: (owner, request, signal) => {
      calls.push({ method: "spawn", args: [owner, request, signal] });
      return Promise.resolve({
        sessionId: "sess-1",
        ...(request.name !== undefined ? { name: request.name } : {}),
        type: request.type,
        pid: 4242,
        status: { kind: "running" },
        motd: "welcome",
      });
    },
    startSend(owner, id, request) {
      calls.push({ method: "startSend", args: [owner, id, request] });
      return {
        done: donePromise,
        readOutput: () => ({ delta: "" }),
        cancel: () => true,
      };
    },
    read(owner, id, request) {
      calls.push({ method: "read", args: [owner, id, request] });
      return { text: "line1\nline2", totalLines: 2, lineBegin: 0, lineEnd: 2, truncated: false };
    },
    signal: (owner, id, signal) => {
      calls.push({ method: "signal", args: [owner, id, signal] });
      return Promise.resolve({ ok: true });
    },
    kill: (owner, id, reason) => {
      calls.push({ method: "kill", args: [owner, id, reason] });
      return Promise.resolve(true);
    },
    list(owner) {
      calls.push({ method: "list", args: [owner] });
      return [
        { sessionId: "sess-1", name: "dev", type: "shell", pid: 1, status: { kind: "running" } },
        {
          sessionId: "sess-2",
          type: "shell",
          pid: 2,
          status: { kind: "exited", exitCode: 0, exitSignal: null },
        },
      ];
    },
  };
  return { terminals, calls };
}

const owner = { id: "agent-1" };

function executeOf(
  definitions: { name: string; execute: (args: unknown, exec: unknown) => Promise<unknown> }[],
  name: string,
) {
  const def = definitions.find((d) => d.name === name);
  expect(def, `tool ${name} registered`).toBeDefined();
  return def!.execute;
}

describe("registerAgentTerminalTools", () => {
  it("registers the six model terminal tools", () => {
    const { host, definitions } = fakeHost();
    registerAgentTerminalTools(host, fakeTerminals().terminals);
    expect(definitions.map((d) => d.name).sort()).toEqual([
      "terminal_close",
      "terminal_create",
      "terminal_list",
      "terminal_read",
      "terminal_send",
      "terminal_signal",
    ]);
  });

  it("terminal_create spawns with the issuing agent as owner", async () => {
    const { host, definitions } = fakeHost();
    const { terminals, calls } = fakeTerminals();
    registerAgentTerminalTools(host, terminals);
    const execute = executeOf(definitions, "terminal_create");
    const result = (await execute({ title: "dev", cwd: "/srv" }, { agent: owner })) as {
      session_id: string;
      title: string;
      pid: number;
      motd: string;
      status: { kind: string };
    };
    expect(result.session_id).toBe("sess-1");
    expect(result.title).toBe("dev");
    expect(result.pid).toBe(4242);
    expect(result.motd).toBe("welcome");
    expect(calls[0]?.method).toBe("spawn");
    expect(calls[0]?.args[0]).toBe(owner);
    expect(calls[0]?.args[1]).toEqual({ type: "shell", name: "dev", cwd: "/srv" });
  });

  it("terminal_create waits for the first command and appends its output", async () => {
    const { host, definitions } = fakeHost();
    const { terminals, calls } = fakeTerminals();
    registerAgentTerminalTools(host, terminals);
    const execute = executeOf(definitions, "terminal_create");
    const result = (await execute({ command: "echo hi", title: "x" }, { agent: owner })) as {
      motd: string;
    };
    expect(calls.some((c) => c.method === "startSend")).toBe(true);
    const sendCall = calls.find((c) => c.method === "startSend")!;
    expect(sendCall.args[2]).toEqual({ text: "echo hi", submit: true });
    expect(result.motd).toContain("welcome");
    expect(result.motd).toContain("ok");
  });

  it("terminal_send maps the send operation result", async () => {
    const { host, definitions } = fakeHost();
    const { terminals } = fakeTerminals();
    registerAgentTerminalTools(host, terminals);
    const execute = executeOf(definitions, "terminal_send");
    const result = (await execute({ session_id: "sess-1", text: "ls" }, { agent: owner })) as {
      output: string;
      waitReason: string;
      status: { kind: string };
    };
    expect(result.output).toContain("ok");
    expect(result.waitReason).toBe("ready");
    expect(result.status.kind).toBe("running");
  });

  it("terminal_read passes optional pagination only when given", async () => {
    const { host, definitions } = fakeHost();
    const { terminals, calls } = fakeTerminals();
    registerAgentTerminalTools(host, terminals);
    const execute = executeOf(definitions, "terminal_read");
    const page = (await execute({ session_id: "sess-1" }, { agent: owner })) as {
      text: string;
      totalLines: number;
    };
    expect(page.text).toBe("line1\nline2");
    expect(page.totalLines).toBe(2);
    const readCall = calls.find((c) => c.method === "read")!;
    expect(readCall.args[2]).toEqual({});

    const page2 = (await execute({ session_id: "sess-1", offset: 1 }, { agent: owner })) as {
      text: string;
    };
    expect(page2.text).toBe("line1\nline2");
    const readCall2 = calls.filter((c) => c.method === "read")[1]!;
    expect(readCall2.args[2]).toEqual({ offset: 1 });
  });

  it("terminal_list filters by session and shapes snapshots", async () => {
    const { host, definitions } = fakeHost();
    const { terminals } = fakeTerminals();
    registerAgentTerminalTools(host, terminals);
    const execute = executeOf(definitions, "terminal_list");
    const result = (await execute({ session_id: "sess-2" }, { agent: owner })) as {
      sessions: { session_id: string; kind: string; status: { kind: string } }[];
    };
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]?.session_id).toBe("sess-2");
    expect(result.sessions[0]?.status.kind).toBe("exited");
  });

  it("terminal_signal forwards the requested signal", async () => {
    const { host, definitions } = fakeHost();
    const { terminals, calls } = fakeTerminals();
    registerAgentTerminalTools(host, terminals);
    const execute = executeOf(definitions, "terminal_signal");
    const result = (await execute(
      { session_id: "sess-1", signal: "SIGINT" },
      { agent: owner },
    )) as { ok: boolean };
    expect(result.ok).toBe(true);
    expect(calls.find((c) => c.method === "signal")?.args[2]).toBe("SIGINT");
  });

  it("terminal_close calls kill with a clear reason", async () => {
    const { host, definitions } = fakeHost();
    const { terminals, calls } = fakeTerminals();
    registerAgentTerminalTools(host, terminals);
    const execute = executeOf(definitions, "terminal_close");
    const result = (await execute({ session_id: "sess-1" }, { agent: owner })) as {
      closed: boolean;
    };
    expect(result.closed).toBe(true);
    expect(calls.find((c) => c.method === "kill")?.args[2]).toBe("terminal_close");
  });

  it("rejects tools without an agent execution context", async () => {
    const { host, definitions } = fakeHost();
    registerAgentTerminalTools(host, fakeTerminals().terminals);
    const execute = executeOf(definitions, "terminal_list");
    await expect(execute({}, {})).rejects.toThrow(/agent execution context/);
  });

  it("wraps seam failures with the tool name", async () => {
    const { host, definitions } = fakeHost();
    const terminals = fakeTerminals().terminals;
    terminals.list = vi.fn(() => {
      throw new Error("backend down");
    });
    registerAgentTerminalTools(host, terminals);
    const execute = executeOf(definitions, "terminal_list");
    await expect(execute({}, { agent: owner })).rejects.toThrow(/terminal_list: backend down/);
  });
});
