import { chmodSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, win32 } from "node:path";

/**
 * PTY lifecycle for dsh-dock-terminal. One node-pty process per
 * `${sessionId}:${tabId}` key; processes survive a socket drop (page refresh)
 * within `reconnectGraceMs`, and survive a session switch forever (park).
 */
export const TRANSCRIPT_LIMIT = 1 << 20;
const DIM_MAX = 1024;

export interface PtyHandle {
  key: string;
  sessionId: string;
  tabId: string;
  cwd: string;
  pty: PtyLike;
  transcript: string;
  exited: boolean;
}

/** Minimal node-pty shape (kept structural so the require stays lazy). */
export interface PtyLike {
  onData(cb: (data: string) => void): { dispose(): void };
  onExit(cb: (info: { exitCode?: number }) => void): { dispose(): void };
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}

export interface PtyModule {
  spawn(file: string, args: string[], options: Record<string, unknown>): PtyLike;
}

export class PtyManager {
  private readonly nodePty: PtyModule;
  private readonly config: {
    shell: string;
    shellArgs: string[];
    maxPerSession: number;
    reconnectGraceMs: number;
  };
  private readonly shell: string;
  private readonly shellArgs: string[];
  private readonly sessions = new Map<string, PtyHandle>();
  private readonly parked = new Set<string>();
  private readonly pendingCloses = new Map<string, NodeJS.Timeout>();

  constructor(
    nodePty: PtyModule,
    config: {
      shell: string;
      shellArgs: string[];
      maxPerSession: number;
      reconnectGraceMs: number;
    },
  ) {
    this.nodePty = nodePty;
    this.config = config;
    const shell = config.shell !== "" ? config.shell : defaultShell();
    this.shell = shell;
    this.shellArgs = config.shellArgs.length > 0 ? config.shellArgs : defaultShellArgs(shell);
  }

  /** Open (or reuse) the pty for a session/tab key. */
  open(sessionId: string, tabId: string, cwd: string, cols: number, rows: number): PtyHandle {
    const key = `${sessionId}:${tabId}`;
    this.parked.delete(key);
    this.cancelClose(key);
    const existing = this.sessions.get(key);
    if (existing !== undefined && !existing.exited && existing.cwd === cwd) return existing;
    if (existing !== undefined) this.closeNow(existing);

    // Reclaim dead handles so a long-lived session does not leak its slots.
    for (const handle of [...this.sessions.values()]) {
      if (handle.sessionId === sessionId && handle.exited) this.closeNow(handle);
    }
    const liveCount = [...this.sessions.values()].filter(
      (h) => h.sessionId === sessionId && !h.exited,
    ).length;
    if (liveCount >= this.config.maxPerSession) {
      throw new Error(`terminal limit reached (${this.config.maxPerSession}) for this session`);
    }

    const pty = this.nodePty.spawn(this.shell, this.shellArgs, {
      name: "xterm-256color",
      cols: clampDim(cols),
      rows: clampDim(rows),
      cwd,
      env: { ...process.env },
    });
    const handle: PtyHandle = { key, sessionId, tabId, cwd, pty, transcript: "", exited: false };
    pty.onData((data) => {
      handle.transcript += data;
      if (handle.transcript.length > TRANSCRIPT_LIMIT) {
        handle.transcript = handle.transcript.slice(handle.transcript.length - TRANSCRIPT_LIMIT);
      }
    });
    pty.onExit(() => {
      handle.exited = true;
      this.sessions.delete(key);
    });
    this.sessions.set(key, handle);
    return handle;
  }

  park(key: string): void {
    if (!this.isLive(key)) return;
    this.parked.add(key);
  }

  isParked(key: string): boolean {
    return this.parked.has(key);
  }

  /** Whether the key still has a live (not exited) pty. */
  isLive(key: string): boolean {
    const handle = this.sessions.get(key);
    return handle !== undefined && !handle.exited;
  }

  /** The resolved shell binary basename, for display (e.g. "bash"). */
  shellName(): string {
    return basename(this.shell);
  }

  /** Close a handle now, canceling any pending grace timer (user close). */
  close(key: string): void {
    this.cancelClose(key);
    this.parked.delete(key);
    const handle = this.sessions.get(key);
    if (handle !== undefined) this.closeNow(handle);
  }

  /** Close every pty of one session (its conversation was disposed). */
  closeSession(sessionId: string): void {
    for (const handle of [...this.sessions.values()]) {
      if (handle.sessionId === sessionId) this.close(handle.key);
    }
    for (const key of [...this.parked]) {
      if (key.startsWith(`${sessionId}:`)) this.close(key);
    }
  }

  /** Schedule a pty close after the grace window (0 = now). */
  scheduleClose(key: string, delayMs: number): void {
    this.cancelClose(key);
    if (!this.isLive(key)) return;
    const timer = setTimeout(
      () => {
        this.pendingCloses.delete(key);
        this.parked.delete(key);
        const handle = this.sessions.get(key);
        if (handle !== undefined) this.closeNow(handle);
      },
      Math.max(0, delayMs),
    );
    this.pendingCloses.set(key, timer);
  }

  private cancelClose(key: string): void {
    const timer = this.pendingCloses.get(key);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.pendingCloses.delete(key);
    }
  }

  private closeNow(handle: PtyHandle): void {
    try {
      handle.pty.kill();
    } catch {
      // The process may already be dead; the exit handler cleans the table.
    }
    this.sessions.delete(handle.key);
    this.parked.delete(handle.key);
  }

  disposeAll(): void {
    for (const handle of [...this.sessions.values()]) this.closeNow(handle);
    for (const timer of this.pendingCloses.values()) clearTimeout(timer);
    this.pendingCloses.clear();
    this.parked.clear();
  }
}

/** Load node-pty lazily; returns null when the native module is unavailable. */
export function loadNodePty(): PtyModule | null {
  try {
    const require = createRequire(import.meta.url);
    return require("node-pty") as PtyModule;
  } catch {
    return null;
  }
}

/** Restore the executable bit pnpm strips from node-pty's spawn-helper. */
export function ensureSpawnHelper(): void {
  if (process.platform === "win32") return;
  try {
    const require = createRequire(import.meta.url);
    const entry = require.resolve("node-pty");
    const packageRoot = dirname(dirname(entry));
    for (const helper of [
      join(packageRoot, "prebuilds", `${process.platform}-${process.arch}`, "spawn-helper"),
      join(packageRoot, "build", "Release", "spawn-helper"),
    ]) {
      if (existsSync(helper)) chmodSync(helper, 0o755);
    }
  } catch {
    // Resolution failure is fine: the next spawn reports the real error.
  }
}

/**
 * Platform default shell, resolved at construction. Windows prefers
 * PowerShell 7 (posh-mocha style profiles only load under pwsh), then
 * Windows PowerShell 5.1, and only falls back to cmd.exe when neither
 * exists. Posix uses $SHELL (login shell, matching a fresh terminal).
 * Dependencies are injectable so the binary/OS matrix stays unit-testable.
 */
export function defaultShell(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  exists: (path: string) => boolean = existsSync,
): string {
  if (platform === "win32") return detectWindowsShell(env, exists);
  return env["SHELL"] ?? "/bin/bash";
}

/**
 * First install that exists wins: the official/winget pwsh 7 location,
 * then the Store app-execution alias, then the in-box Windows PowerShell
 * 5.1. Nothing left means the caller's COMSPEC (cmd.exe).
 */
function detectWindowsShell(env: NodeJS.ProcessEnv, exists: (path: string) => boolean): string {
  const programFiles = env["ProgramFiles"] ?? "C:\\Program Files";
  const systemRoot = env["SystemRoot"] ?? "C:\\Windows";
  // win32 path API on purpose: env values are Windows paths on every host.
  const candidates: string[] = [win32.join(programFiles, "PowerShell", "7", "pwsh.exe")];
  const localAppData = env["LOCALAPPDATA"];
  if (localAppData !== undefined) {
    candidates.push(win32.join(localAppData, "Microsoft", "WindowsApps", "pwsh.exe"));
  }
  candidates.push(
    win32.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
  );
  for (const candidate of candidates) {
    if (exists(candidate)) return candidate;
  }
  return env["COMSPEC"] ?? "cmd.exe";
}

/**
 * Startup args for the resolved shell. Login mode on posix. On Windows the
 * banner is suppressed for PowerShell only; unknown shells (git bash, WSL,
 * a custom binary) get no args so nothing the user configured is clobbered.
 */
export function defaultShellArgs(
  shell: string = defaultShell(),
  platform: NodeJS.Platform = process.platform,
): string[] {
  if (platform === "win32") {
    const base = win32.basename(shell).toLowerCase();
    const isPowerShell =
      base === "pwsh" || base === "pwsh.exe" || base === "powershell" || base === "powershell.exe";
    return isPowerShell ? ["-NoLogo"] : [];
  }
  return ["-l"];
}

function clampDim(value: number): number {
  const dim = Math.floor(value);
  if (Number.isNaN(dim)) return 2;
  return Math.min(DIM_MAX, Math.max(2, dim));
}

export function clampDims(cols: number, rows: number): { cols: number; rows: number } {
  return { cols: clampDim(cols), rows: clampDim(rows) };
}
