/**
 * Model-facing terminal tools: `terminal_create` / `terminal_send` /
 * `terminal_read` / `terminal_list` / `terminal_signal` / `terminal_close`.
 *
 * They speak to the official `@deepseek-ai/dsh-terminal` seam
 * (`ctx.terminals`), whose backend (`@deepseek-ai/dsh-terminal-bash`) runs the
 * shell under the shared `sandboxPolicy`. Every operation is owner-scoped to
 * the exact Agent that issued the call (`exec.agent`), so a session id minted
 * for one conversation can never be reached from another.
 *
 * The seam is optional: when `ctx.terminals` is absent (the profile does not
 * mount the official terminal rows), the assembly root simply skips this
 * tool set and the plugin keeps working for the UI terminal.
 */

import { defineTool } from "@deepseek-ai/dsh-tools";
import type { TerminalSendRequest, TerminalSignal } from "@deepseek-ai/dsh-terminal";

/** The tiny host surface the tool set needs (structural, no hard deps). */
export interface ToolsHost {
  tools: { register(definition: unknown): () => void };
}

/** The small part of ctx.terminals the tools touch (structural mirror). */
export interface TerminalsLike {
  spawn(
    owner: unknown,
    request: { type: string; name?: string; cwd?: string },
    signal?: AbortSignal,
  ): Promise<{
    sessionId: string;
    name?: string;
    type: string;
    pid?: number;
    status: { kind: string; exitCode?: number | null; exitSignal?: string | null };
    motd: string;
  }>;
  startSend(
    owner: unknown,
    id: string,
    request: TerminalSendRequest,
  ): {
    done: Promise<{
      viewport: string;
      waitReason: string;
      sessionStatus: { kind: string; exitCode?: number | null; exitSignal?: string | null };
      truncated: boolean;
    }>;
    readOutput(): { delta: string; dropped?: boolean };
    cancel(): boolean;
  };
  read(
    owner: unknown,
    id: string,
    request?: { offset?: number; count?: number },
  ): {
    text: string;
    totalLines: number;
    lineBegin: number;
    lineEnd: number;
    truncated: boolean;
  };
  signal(owner: unknown, id: string, signal: TerminalSignal): Promise<unknown>;
  kill(owner: unknown, id: string, reason?: string): Promise<boolean>;
  list(owner: unknown): {
    sessionId: string;
    name?: string;
    type: string;
    pid?: number;
    status: { kind: string; exitCode?: number | null; exitSignal?: string | null };
  }[];
}

/** Minimal tool execution context shape (the dsh-tools exec object). */
interface ExecLike {
  agent?: unknown;
  signal?: AbortSignal;
}

function requireAgent(exec: ExecLike): unknown {
  if (exec.agent === undefined) {
    throw new Error("terminal tools require an agent execution context");
  }
  return exec.agent;
}

function toMessage(error: unknown): string {
  if (error !== null && typeof error === "object") {
    const record = error as { code?: unknown; message?: unknown };
    if (typeof record.message === "string") {
      return typeof record.code === "string" ? `${record.code}: ${record.message}` : record.message;
    }
  }
  return String(error);
}

/** Register the six model terminal tools; returns the disposer. */
export function registerAgentTerminalTools(host: ToolsHost, terminals: TerminalsLike): () => void {
  const disposers: (() => void)[] = [];

  function toolError(name: string, error: unknown): Error {
    return new Error(`${name}: ${toMessage(error)}`);
  }

  disposers.push(
    host.tools.register(
      defineTool({
        name: "terminal_create",
        description:
          "Create a persistent interactive shell session owned by this conversation and run an optional first command. Returns the opaque session_id for terminal_send / terminal_read / terminal_signal / terminal_close, plus the initial bounded output (motd) and the session status. Use terminal_close when done.",
        parameters: {
          title: {
            type: "string",
            description:
              'Optional short display name for the session (e.g. "dev server"). Never a permission boundary.',
          },
          command: {
            type: "string",
            description:
              'Optional first command to run in the fresh shell (e.g. "dotnet build"). Empty or omitted starts a bare shell.',
          },
          cwd: {
            type: "string",
            description: "Initial working directory; defaults to the conversation workspace root.",
          },
        },
        output: {
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              session_id: { type: "string", required: true },
              title: { oneOf: [{ type: "string" }, { type: "null" }] },
              pid: { oneOf: [{ type: "integer" }, { type: "null" }] },
              motd: { type: "string", required: true },
              status: {
                type: "object",
                additionalProperties: false,
                properties: {
                  kind: { type: "string", required: true },
                  exitCode: { oneOf: [{ type: "integer" }, { type: "null" }] },
                  exitSignal: { oneOf: [{ type: "string" }, { type: "null" }] },
                },
              },
            },
          },
          render: (_args, value) => [{ type: "text", text: JSON.stringify(value, null, 2) }],
        },
        async execute(args: { title?: string; command?: string; cwd?: string }, exec: ExecLike) {
          try {
            const owner = requireAgent(exec);
            const created = await terminals.spawn(
              owner,
              {
                type: "shell",
                ...(args.title !== undefined ? { name: args.title } : {}),
                ...(args.cwd !== undefined ? { cwd: args.cwd } : {}),
              },
              exec.signal,
            );
            let motd = created.motd;
            if (args.command !== undefined && args.command !== "") {
              const operation = terminals.startSend(owner, created.sessionId, {
                text: args.command,
                submit: true,
                ...(exec.signal !== undefined ? { signal: exec.signal } : {}),
              });
              try {
                const result = await operation.done;
                motd = (motd + result.viewport).slice(-65536);
              } catch (error) {
                motd = `${motd}\n${toMessage(error)}`;
              }
            }
            return {
              session_id: created.sessionId,
              title: created.name ?? args.title ?? null,
              pid: created.pid ?? null,
              motd,
              status: created.status,
            };
          } catch (error) {
            throw toolError("terminal_create", error);
          }
        },
      }),
    ),
  );

  disposers.push(
    host.tools.register(
      defineTool({
        name: "terminal_send",
        description:
          "Write text into a terminal session (tmux send-keys semantics). Waits for the shell to reach the next ready prompt (or the command to finish) and returns the bounded rendered output delta, the wait reason and the session status. Long-running output is truncated at the backend bound.",
        timeoutMs: 300_000,
        parameters: {
          session_id: { type: "string", required: true },
          text: { type: "string", required: true },
          submit: {
            type: "boolean",
            description:
              "Whether to send an Enter after text. Defaults to true (submit a command). Set false for partial input.",
          },
        },
        output: {
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              output: { type: "string", required: true },
              waitReason: { type: "string", required: true },
              truncated: { type: "boolean", required: true },
              status: {
                type: "object",
                additionalProperties: false,
                properties: {
                  kind: { type: "string", required: true },
                  exitCode: { oneOf: [{ type: "integer" }, { type: "null" }] },
                  exitSignal: { oneOf: [{ type: "string" }, { type: "null" }] },
                },
              },
            },
          },
          render: (_args, value) => [{ type: "text", text: JSON.stringify(value, null, 2) }],
        },
        async execute(
          args: { session_id: string; text: string; submit?: boolean },
          exec: ExecLike,
        ) {
          try {
            const owner = requireAgent(exec);
            const operation = terminals.startSend(owner, args.session_id, {
              text: args.text,
              submit: args.submit ?? true,
              ...(exec.signal !== undefined ? { signal: exec.signal } : {}),
            });
            const result = await operation.done;
            return {
              output: result.viewport,
              waitReason: result.waitReason,
              truncated: result.truncated,
              status: result.sessionStatus,
            };
          } catch (error) {
            throw toolError("terminal_send", error);
          }
        },
      }),
    ),
  );

  disposers.push(
    host.tools.register(
      defineTool({
        name: "terminal_read",
        description:
          "Read one bounded page of the retained terminal scrollback. Offsets are relative to the newest retained line: offset 0 reads the newest page; negative offsets page further back. Returns the page text plus totalLines so the caller can paginate.",
        parameters: {
          session_id: { type: "string", required: true },
          offset: {
            type: "number",
            description: "0-based offset from the newest retained line (default 0).",
          },
          count: {
            type: "number",
            description: "Maximum lines to return (backend bound applies).",
          },
        },
        output: {
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              text: { type: "string", required: true },
              totalLines: { type: "integer", required: true },
              lineBegin: { type: "integer", required: true },
              lineEnd: { type: "integer", required: true },
              truncated: { type: "boolean", required: true },
            },
          },
          render: (_args, value) => [
            {
              type: "text",
              text: `session ${_args.session_id} lines ${value.lineBegin}..${value.lineEnd}/${value.totalLines}${
                value.truncated ? " (truncated)" : ""
              }\n${value.text}`,
            },
          ],
        },
        execute(args: { session_id: string; offset?: number; count?: number }, exec: ExecLike) {
          try {
            const owner = requireAgent(exec);
            return Promise.resolve(
              terminals.read(owner, args.session_id, {
                ...(args.offset !== undefined ? { offset: args.offset } : {}),
                ...(args.count !== undefined ? { count: args.count } : {}),
              }),
            );
          } catch (error) {
            throw toolError("terminal_read", error);
          }
        },
      }),
    ),
  );

  disposers.push(
    host.tools.register(
      defineTool({
        name: "terminal_list",
        description:
          "List the live terminal sessions of this conversation (their session_id, title, kind and status). Optionally filter to one session.",
        parameters: {
          session_id: { type: "string", description: "Optional filter by session_id." },
        },
        output: {
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              sessions: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    session_id: { type: "string", required: true },
                    title: { oneOf: [{ type: "string" }, { type: "null" }] },
                    kind: { type: "string", required: true },
                    pid: { oneOf: [{ type: "integer" }, { type: "null" }] },
                    status: {
                      type: "object",
                      additionalProperties: false,
                      properties: {
                        kind: { type: "string", required: true },
                        exitCode: { oneOf: [{ type: "integer" }, { type: "null" }] },
                        exitSignal: { oneOf: [{ type: "string" }, { type: "null" }] },
                      },
                    },
                  },
                },
              },
            },
          },
          render: (_args, value) => [
            {
              type: "text",
              text: (value.sessions ?? [])
                .map(
                  (s) =>
                    `${s.session_id} ${s.title ?? "shell"} [${s.status?.kind ?? "?"}]${
                      s.pid ? " pid=" + s.pid : ""
                    }`,
                )
                .join("\n"),
            },
          ],
        },
        execute(args: { session_id?: string }, exec: ExecLike) {
          try {
            const owner = requireAgent(exec);
            const sessions = terminals
              .list(owner)
              .filter((s) => args.session_id === undefined || s.sessionId === args.session_id)
              .map((s) => ({
                session_id: s.sessionId,
                title: s.name ?? null,
                kind: s.type,
                pid: s.pid ?? null,
                status: s.status,
              }));
            return Promise.resolve({ sessions });
          } catch (error) {
            throw toolError("terminal_list", error);
          }
        },
      }),
    ),
  );

  const SIGNALS: TerminalSignal[] = ["SIGINT", "SIGTERM", "SIGKILL", "SIGTSTP", "SIGHUP"];
  disposers.push(
    host.tools.register(
      defineTool({
        name: "terminal_signal",
        description:
          "Send a signal to the terminal's foreground process group: SIGINT (Ctrl+C), SIGTSTP (Ctrl+Z), SIGTERM, SIGKILL or SIGHUP.",
        parameters: {
          session_id: { type: "string", required: true },
          signal: {
            type: "string",
            enum: SIGNALS,
            required: true,
            description: "One of SIGINT, SIGTSTP, SIGTERM, SIGKILL, SIGHUP.",
          },
        },
        output: {
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              ok: { type: "boolean", required: true },
            },
          },
          render: (_args, value) => [{ type: "text", text: JSON.stringify(value, null, 2) }],
        },
        async execute(args: { session_id: string; signal: TerminalSignal }, exec: ExecLike) {
          try {
            const owner = requireAgent(exec);
            await terminals.signal(owner, args.session_id, args.signal);
            return { ok: true };
          } catch (error) {
            throw toolError("terminal_signal", error);
          }
        },
      }),
    ),
  );

  disposers.push(
    host.tools.register(
      defineTool({
        name: "terminal_close",
        description:
          "Close a terminal session and wait for its process tree to settle. Idempotent: returns false when the session no longer exists.",
        parameters: {
          session_id: { type: "string", required: true },
        },
        output: {
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              closed: { type: "boolean", required: true },
            },
          },
          render: (_args, value) => [{ type: "text", text: JSON.stringify(value, null, 2) }],
        },
        async execute(args: { session_id: string }, exec: ExecLike) {
          try {
            const owner = requireAgent(exec);
            const closed = await terminals.kill(owner, args.session_id, "terminal_close");
            return { closed };
          } catch (error) {
            throw toolError("terminal_close", error);
          }
        },
      }),
    ),
  );

  return () => {
    for (const dispose of disposers) {
      try {
        dispose();
      } catch {
        // A failing disposer must not prevent the remaining unregistration.
      }
    }
  };
}
