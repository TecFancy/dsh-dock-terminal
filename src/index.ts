import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer } from "ws";
import { Config, type TerminalConfig } from "./config.js";
import { registerAgentTerminalTools, type TerminalsLike } from "./features/agent-terminal/index.js";
import { ensureSpawnHelper, loadNodePty, PtyManager } from "./pty.js";
import { attachTerminal, isTrustedRequest } from "./terminal-server.js";

/**
 * dsh-dock-terminal host half: owns the node-pty shell processes and the
 * terminal WebSocket bridge.
 *
 * The client opens one WebSocket per open popover (`/dock-terminal/ws?
 * sessionId=<id>&tab=<tabId>`). The host keeps one pty per `${sessionId}:
 * ${tabId}` key; a reconnecting socket (page refresh, session switch) rejoins
 * the same process and replays a bounded transcript ring.
 *
 * Wire protocol (client -> host, one message each):
 * - text that is not valid JSON is written to the pty stdin;
 * - {"type":"close"} closes the terminal (user closed the popover);
 * - {"type":"park"} marks the terminal parked across a session switch (no
 *   close countdown);
 * - {"type":"resize","cols":n,"rows":n} resizes the pty.
 * Host -> client: raw pty output (history first, then live data).
 */
export const name = "dsh-dock-terminal";

export const inject = ["webServer", "tools"] as const;

export { Config };

export function apply(ctx: RuntimeContext, config: unknown): void {
  const resolved: TerminalConfig = Config.parse(config ?? {});
  ensureSpawnHelper();
  const nodePty = loadNodePty();
  if (nodePty === null) {
    ctx
      .logger?.("dsh-dock-terminal")
      .warn("node-pty failed to load; the terminal popover reports it as unavailable");
  }
  const manager = nodePty === null ? null : new PtyManager(nodePty, resolved);
  const wss = new WebSocketServer({ noServer: true });

  // Close every pty of a disposed conversation immediately: deleting a
  // session must not wait out the reconnect grace window for its shells.
  ctx.effect(
    () =>
      ctx.on("session/disposed", (payload: unknown) => {
        let sessionId: unknown;
        if (typeof payload === "string") {
          sessionId = payload;
        } else if (payload !== null && typeof payload === "object") {
          sessionId = (payload as { id?: unknown }).id;
        }
        if (typeof sessionId === "string") manager?.closeSession(sessionId);
      }),
    "dsh-dock-terminal: close ptys of disposed sessions",
  );
  ctx.effect(
    () =>
      ctx.webServer.registerUpgrade({
        path: "/dock-terminal/ws",
        handler: (req, socket, head) => {
          const request = req as IncomingMessage;
          if (!isTrustedRequest(request)) {
            (socket as { destroy(): void }).destroy();
            return;
          }
          wss.handleUpgrade(request, socket as Duplex, head as Buffer, (ws) => {
            attachTerminal(ctx, manager, resolved, ws, request);
          });
        },
      }),
    "dsh-dock-terminal: /dock-terminal/ws upgrade",
  );
  ctx.effect(
    () => () => {
      manager?.disposeAll();
      wss.close();
    },
    "dsh-dock-terminal: teardown",
  );

  // Model terminal tools ride the optional official seam: without it the
  // plugin keeps working for the UI popover and only skips the tool set.
  const terminals = ctx.get("terminals") as TerminalsLike | undefined;
  if (terminals === undefined) {
    ctx
      .logger?.("dsh-dock-terminal")
      .warn(
        "ctx.terminals not mounted; model terminal tools are skipped (mount @deepseek-ai/dsh-terminal + dsh-terminal-bash to enable)",
      );
  } else {
    ctx.effect(
      () => registerAgentTerminalTools(ctx, terminals),
      "dsh-dock-terminal: model terminal tools",
    );
  }
}

/** Minimal context surface the host half touches (structural, no hard deps). */
interface RuntimeContext {
  webServer: {
    registerUpgrade(route: {
      path: string;
      handler(req: unknown, socket: unknown, head: unknown): void | Promise<void>;
    }): () => void;
  };
  tools: { register(definition: unknown): () => void };
  on(event: string, handler: (payload?: unknown) => void): () => void;
  get(name: string): unknown;
  effect(fn: () => unknown, label?: string): unknown;
  logger?: (namespace: string) => { warn(message: string): void };
}
