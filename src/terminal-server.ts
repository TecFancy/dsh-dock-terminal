import { WebSocket } from "ws";
import { clampDims, PtyManager, type PtyHandle } from "./pty.js";
import type { TerminalConfig } from "./config.js";

/**
 * Terminal WebSocket server logic: one socket attaches (or re-attaches) to a
 * pty by `${sessionId}:${tabId}`; plain text is keyboard input, JSON frames
 * carry close / park / resize control. Kept separate from the plugin root so
 * the wire behaviour is unit-testable without a real socket.
 */

export interface TrustedRequest {
  headers: Record<string, string | string[] | undefined>;
}

/**
 * Whether one terminal request may reach the bridge: loopback authority, or a
 * same-origin browser request (origin host equals the host header of the page
 * the client came from). Rejects cross-site navigations.
 */
export function isTrustedRequest(req: TrustedRequest): boolean {
  const host = req.headers["host"];
  const hostName = typeof host === "string" ? new URL(`http://${host}`).hostname : "";
  const loopback = hostName === "localhost" || hostName === "127.0.0.1" || hostName === "[::1]";
  if (req.headers["sec-fetch-site"] === "cross-site") return false;
  const origin = req.headers["origin"];
  if (origin === undefined) return loopback;
  if (typeof origin !== "string") return false;
  if (loopback) return true;
  try {
    return new URL(origin).hostname === hostName;
  } catch {
    return false;
  }
}

/** Decode a ws message payload into text (handles all RawData shapes). */
export function toText(data: string | Buffer | ArrayBuffer | Buffer[]): string {
  if (typeof data === "string") return data;
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  return Buffer.from(data).toString("utf8");
}

/** Minimal context surface the server half touches (structural). */
export interface ServerContext {
  get(name: string): unknown;
}

/**
 * Attach one terminal socket. The pty handle is keyed by session+tab; a
 * reconnecting socket replays the transcript and re-attaches the running
 * process.
 */
export function attachTerminal(
  ctx: ServerContext,
  manager: PtyManager | null,
  config: TerminalConfig,
  ws: WebSocket,
  req: { url?: string | undefined },
): void {
  const url = new URL(req.url ?? "/", "http://dsh.internal");
  const sessionId = url.searchParams.get("sessionId");
  const tabId = url.searchParams.get("tab");
  if (sessionId === null || tabId === null) {
    ws.close(1008, "?sessionId and ?tab are required");
    return;
  }
  if (manager === null) {
    ws.close(1011, "node-pty unavailable on this host");
    return;
  }

  const cwd = sessionCwdOf(ctx, sessionId);
  let handle: PtyHandle;
  try {
    handle = manager.open(sessionId, tabId, cwd, 80, 24);
  } catch (error) {
    ws.close(1011, error instanceof Error ? error.message : String(error));
    return;
  }

  if (handle.transcript !== "") ws.send(handle.transcript);
  const onData = (data: string) => {
    if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount < 4 * 1024 * 1024) ws.send(data);
  };
  const onExit = ({ exitCode }: { exitCode?: number }) => {
    onData(`\r\n[process exited with code ${String(exitCode ?? "?")}]\r\n`);
  };
  const dataSub = handle.pty.onData(onData);
  const exitSub = handle.pty.onExit(onExit);

  ws.on("message", (data) => {
    const text = typeof data === "string" ? data : toText(data);
    let control: { type?: unknown; cols?: unknown; rows?: unknown } | null = null;
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed !== null && typeof parsed === "object") {
        const record = parsed as Record<string, unknown>;
        control = { type: record["type"], cols: record["cols"], rows: record["rows"] };
      }
    } catch {
      // Not a control frame: write it as terminal input below.
    }
    if (control !== null && control.type === "close") {
      // User closed the terminal: kill the pty synchronously (no grace). A
      // scheduled grace must never override this (the socket close event
      // fires right after this frame and would otherwise re-arm a 30s timer).
      manager.close(handle.key);
      return;
    }
    if (control !== null && control.type === "park") {
      manager.park(handle.key);
      return;
    }
    if (handle.exited) return;
    if (
      control !== null &&
      control.type === "resize" &&
      typeof control.cols === "number" &&
      typeof control.rows === "number"
    ) {
      const dims = clampDims(control.cols, control.rows);
      handle.pty.resize(dims.cols, dims.rows);
    } else {
      handle.pty.write(text);
    }
  });

  ws.on("close", () => {
    dataSub.dispose();
    exitSub.dispose();
    // Parked ptys survive indefinitely (session switch). A bare drop starts
    // the grace countdown only for a still-live handle: an explicit close
    // frame already removed it, and rescheduling here would revive a dead key.
    if (!manager.isParked(handle.key) && manager.isLive(handle.key)) {
      manager.scheduleClose(handle.key, config.reconnectGraceMs);
    }
  });
}

/** Resolve the session working directory (session header cwd, then cwd). */
function sessionCwdOf(ctx: ServerContext, sessionId: string): string {
  const sessions = ctx.get("sessions") as
    { get(id: string): { header?: { cwd?: string } } | undefined } | undefined;
  const headerCwd = sessions?.get(sessionId)?.header?.cwd;
  if (headerCwd !== undefined && headerCwd !== "") return headerCwd;
  return process.cwd();
}
