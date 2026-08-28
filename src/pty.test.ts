import { describe, expect, it } from "vitest";
import { defaultShell, defaultShellArgs } from "./pty.js";

const PW7 = "C:\\Program Files\\PowerShell\\7\\pwsh.exe";
const STORE_PW7 = "C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps\\pwsh.exe";
const PS51 = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
const CMD = "C:\\Windows\\System32\\cmd.exe";
const BASE_ENV = { ProgramFiles: "C:\\Program Files", SystemRoot: "C:\\Windows" };

describe("defaultShell (win32)", () => {
  it("prefers the pwsh 7 install under Program Files", () => {
    const exists = (p: string) => p === PW7;
    expect(defaultShell("win32", { ...BASE_ENV, COMSPEC: CMD }, exists)).toBe(PW7);
  });

  it("falls back to the Store pwsh alias when Program Files is missing", () => {
    const env = { ...BASE_ENV, LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local" };
    const exists = (p: string) => p === STORE_PW7;
    expect(defaultShell("win32", env, exists)).toBe(STORE_PW7);
  });

  it("falls back to Windows PowerShell 5.1 before cmd.exe", () => {
    const exists = (p: string) => p === PS51;
    expect(defaultShell("win32", { ...BASE_ENV, COMSPEC: CMD }, exists)).toBe(PS51);
  });

  it("only gives up on cmd.exe when no PowerShell exists", () => {
    expect(defaultShell("win32", { ...BASE_ENV, COMSPEC: CMD }, () => false)).toBe(CMD);
    expect(defaultShell("win32", BASE_ENV, () => false)).toBe("cmd.exe");
  });
});

describe("defaultShell (posix)", () => {
  it("uses $SHELL and falls back to /bin/bash", () => {
    expect(defaultShell("linux", { SHELL: "/usr/bin/zsh" }, () => false)).toBe("/usr/bin/zsh");
    expect(defaultShell("darwin", {}, () => false)).toBe("/bin/bash");
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
