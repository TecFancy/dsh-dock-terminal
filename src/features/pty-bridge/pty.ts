import { chmodSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { userInfo } from "node:os";
import { dirname, join, win32 } from "node:path";

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
  /** Attached sockets per key, so a stale socket close never re-arms a grace
   * timer for a key that a newer socket already re-attached to. */
  private readonly socketCounts = new Map<string, number>();

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
    if (this.config.maxPerSession > 0 && liveCount >= this.config.maxPerSession) {
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

  /** Register one attached socket for a key (a re-attach must not count as
   * a drop in the key's grace bookkeeping). */
  attach(key: string): void {
    this.socketCounts.set(key, (this.socketCounts.get(key) ?? 0) + 1);
  }

  /** Unregister a detached socket. */
  detach(key: string): void {
    const count = this.socketCounts.get(key) ?? 1;
    if (count <= 1) {
      this.socketCounts.delete(key);
    } else {
      this.socketCounts.set(key, count - 1);
    }
  }

  /** Whether another socket is still attached to the key. */
  hasSockets(key: string): boolean {
    return (this.socketCounts.get(key) ?? 0) > 0;
  }

  /** The resolved shell binary basename, for display (e.g. "bash", "pwsh"). */
  shellName(): string {
    const normalized = this.shell.replace(/\\/g, "/");
    const base = normalized.slice(normalized.lastIndexOf("/") + 1);
    return base.replace(/\.(exe|cmd|bat|com)$/i, "");
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
    this.socketCounts.delete(handle.key);
  }

  disposeAll(): void {
    for (const handle of [...this.sessions.values()]) this.closeNow(handle);
    for (const timer of this.pendingCloses.values()) clearTimeout(timer);
    this.pendingCloses.clear();
    this.parked.clear();
    this.socketCounts.clear();
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
 * exists. Posix uses $SHELL when set, then the account login shell from
 * passwd (service managers often start dsh without $SHELL), then /bin/bash.
 * Dependencies are injectable so the binary/OS matrix stays unit-testable.
 */
export function defaultShell(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  exists: (path: string) => boolean = existsSync,
  loginShell: string | null = readLoginShell(),
): string {
  if (platform === "win32") return detectWindowsShell(env, exists);
  const envShell = env["SHELL"];
  if (envShell !== undefined && envShell.trim() !== "") return envShell;
  if (loginShell !== null && loginShell.trim() !== "") return loginShell;
  return "/bin/bash";
}

/** The account login shell from passwd; null when the uid has no entry. */
function readLoginShell(): string | null {
  try {
    const shell = userInfo().shell;
    return typeof shell === "string" && shell.trim() !== "" ? shell : null;
  } catch {
    return null;
  }
}

/**
 * Candidate directories that may contain a pwsh.exe on Windows: PATH
 * entries first, then the machine install locations (including the preview
 * channel and the 32-bit-process ProgramW6432 case), then per-user layouts
 * (Store alias, MSI/portable installs). De-duped while preserving order.
 */
function windowsPwshCandidateDirs(env: NodeJS.ProcessEnv): string[] {
  const dirs: string[] = [];
  const path = env["PATH"];
  if (path !== undefined) {
    // The win32 branch always uses the Windows PATH separator; hardcoding it
    // keeps the resolver testable from POSIX runners.
    for (const entry of path.split(";")) {
      const trimmed = entry.trim().replace(/^"|"$/g, "");
      if (trimmed !== "") dirs.push(trimmed);
    }
  }
  for (const programFiles of [env["ProgramW6432"], env["ProgramFiles"]]) {
    if (programFiles === undefined || programFiles.trim() === "") continue;
    dirs.push(win32.join(programFiles, "PowerShell", "7"));
    dirs.push(win32.join(programFiles, "PowerShell", "7-preview"));
  }
  const localAppData = env["LOCALAPPDATA"];
  if (localAppData !== undefined && localAppData.trim() !== "") {
    dirs.push(win32.join(localAppData, "Microsoft", "WindowsApps"));
    dirs.push(win32.join(localAppData, "Microsoft", "PowerShell", "7"));
    dirs.push(win32.join(localAppData, "Microsoft", "PowerShell", "7-preview"));
    dirs.push(win32.join(localAppData, "Programs", "PowerShell", "7"));
  }
  return [...new Set(dirs)];
}

/**
 * First pwsh.exe found wins (PATH first so portable/custom installs beat
 * the default location), then the in-box Windows PowerShell 5.1, then the
 * caller's COMSPEC (cmd.exe). win32 path API on purpose: env values are
 * Windows paths on every host.
 */
function detectWindowsShell(env: NodeJS.ProcessEnv, exists: (path: string) => boolean): string {
  for (const dir of windowsPwshCandidateDirs(env)) {
    const candidate = win32.join(dir, "pwsh.exe");
    if (exists(candidate)) return candidate;
  }
  const systemRoot = env["SystemRoot"] ?? "C:\\Windows";
  const powerShell51 = win32.join(
    systemRoot,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  if (exists(powerShell51)) return powerShell51;
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
