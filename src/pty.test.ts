import { describe, expect, it } from "vitest";
import { defaultShell, defaultShellArgs, PtyManager } from "./pty.js";

const PW7 = "C:\\Program Files\\PowerShell\\7\\pwsh.exe";
const STORE_PW7 = "C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps\\pwsh.exe";
const PS51 = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
const CMD = "C:\\Windows\\System32\\cmd.exe";
const BASE_ENV = { ProgramFiles: "C:\\Program Files", SystemRoot: "C:\\Windows" };
const no = () => false;

describe("defaultShell (win32)", () => {
  it("resolves pwsh.exe from PATH, ahead of the default location", () => {
    const env = { ...BASE_ENV, PATH: "C:\\Portable\\pwsh; C:\\Windows\\System32" };
    const exists = (p: string) => p === "C:\\Portable\\pwsh\\pwsh.exe";
    expect(defaultShell("win32", env, exists)).toBe("C:\\Portable\\pwsh\\pwsh.exe");
  });

  it("strips quotes from PATH entries", () => {
    const env = { ...BASE_ENV, PATH: '"C:\\Portable\\pwsh";C:\\Windows' };
    const exists = (p: string) => p === "C:\\Portable\\pwsh\\pwsh.exe";
    expect(defaultShell("win32", env, exists)).toBe("C:\\Portable\\pwsh\\pwsh.exe");
  });

  it("prefers the pwsh 7 install under Program Files when PATH has none", () => {
    const exists = (p: string) => p === PW7;
    expect(defaultShell("win32", { ...BASE_ENV, COMSPEC: CMD }, exists)).toBe(PW7);
  });

  it("reads ProgramW6432 so a 32-bit Node process still finds pwsh 7", () => {
    const env = {
      ProgramFiles: "C:\\Program Files (x86)",
      ProgramW6432: "C:\\Program Files",
      SystemRoot: "C:\\Windows",
    };
    const exists = (p: string) => p === "C:\\Program Files\\PowerShell\\7\\pwsh.exe";
    expect(defaultShell("win32", env, exists)).toBe(PW7);
  });

  it("checks the preview channel after the stable install", () => {
    const env = { ProgramFiles: "C:\\Program Files", SystemRoot: "C:\\Windows" };
    const preview = "C:\\Program Files\\PowerShell\\7-preview\\pwsh.exe";
    const exists = (p: string) => p === preview;
    expect(defaultShell("win32", env, exists)).toBe(preview);
  });

  it("falls back to the Store pwsh alias when PATH and Program Files are empty", () => {
    const env = { ...BASE_ENV, LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local" };
    const exists = (p: string) => p === STORE_PW7;
    expect(defaultShell("win32", env, exists)).toBe(STORE_PW7);
  });

  it("falls back to Windows PowerShell 5.1 before cmd.exe", () => {
    const exists = (p: string) => p === PS51;
    expect(defaultShell("win32", { ...BASE_ENV, COMSPEC: CMD }, exists)).toBe(PS51);
  });

  it("only gives up on cmd.exe when no PowerShell exists", () => {
    expect(defaultShell("win32", { ...BASE_ENV, COMSPEC: CMD }, no)).toBe(CMD);
    expect(defaultShell("win32", BASE_ENV, no)).toBe("cmd.exe");
  });
});

describe("defaultShell (posix)", () => {
  it("uses $SHELL first", () => {
    expect(defaultShell("linux", { SHELL: "/usr/bin/zsh" }, no, null)).toBe("/usr/bin/zsh");
  });

  it("uses the passwd login shell when $SHELL is unset", () => {
    expect(defaultShell("darwin", {}, no, "/usr/bin/zsh")).toBe("/usr/bin/zsh");
  });

  it("falls back to /bin/bash with no $SHELL and no login shell", () => {
    expect(defaultShell("darwin", {}, no, null)).toBe("/bin/bash");
  });
});

describe("defaultShellArgs", () => {
  it("uses login mode for posix shells", () => {
    expect(defaultShellArgs("/bin/bash", "linux")).toEqual(["-l"]);
    expect(defaultShellArgs("pwsh", "linux")).toEqual(["-l"]);
  });

  it("suppresses the banner for PowerShell on win32 only", () => {
    expect(defaultShellArgs(PW7, "win32")).toEqual(["-NoLogo"]);
    expect(defaultShellArgs(PS51, "win32")).toEqual(["-NoLogo"]);
    expect(defaultShellArgs("pwsh.exe", "win32")).toEqual(["-NoLogo"]);
  });

  it("passes no args to cmd or unknown shells on win32", () => {
    expect(defaultShellArgs(CMD, "win32")).toEqual([]);
    expect(defaultShellArgs("C:\\Program Files\\Git\\bin\\bash.exe", "win32")).toEqual([]);
  });
});

describe("PtyManager.shellName", () => {
  const noopPty = () => ({
    onData: () => ({ dispose: () => undefined }),
    onExit: () => ({ dispose: () => undefined }),
    write: () => undefined,
    resize: () => undefined,
    kill: () => undefined,
  });
  const module = { spawn: noopPty };

  function managerWith(shell: string, shellArgs: string[]) {
    return new PtyManager(module, {
      shell,
      shellArgs,
      maxPerSession: 2,
      reconnectGraceMs: 30000,
    });
  }

  it("strips the .exe suffix for display", () => {
    expect(managerWith("C:\\Program Files\\PowerShell\\7\\pwsh.exe", []).shellName()).toBe("pwsh");
    expect(managerWith(PS51, []).shellName()).toBe("powershell");
    expect(managerWith("/bin/bash", []).shellName()).toBe("bash");
  });
});
