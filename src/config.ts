import { z } from "zod";

/** Terminal host configuration (plugin Config schema surface). */
export type TerminalConfig = z.infer<typeof ConfigSchema>;

const ConfigSchema = z.object({
  /** Explicit shell binary; empty resolves $SHELL (posix) or powershell.exe. */
  shell: z.string().default(""),
  /** Explicit shell startup args; empty uses the platform default (-l posix). */
  shellArgs: z.array(z.string()).default([]),
  /** Concurrent pty processes per conversation. */
  maxPerSession: z.number().int().min(1).max(16).default(2),
  /** Grace window a bare socket drop waits before its pty dies, in ms. */
  reconnectGraceMs: z.number().int().min(0).default(30000),
});

export const Config = ConfigSchema;
