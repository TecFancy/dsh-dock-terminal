import { z } from "zod";

/**
 * Terminal host configuration (plugin Config schema surface).
 *
 * The cordis loader validates the plugin row's config against the exported
 * Config schema even when the row carries no `config:` block (bundle patches
 * insert only id/name). A bare z.object() rejects undefined on newer cordis
 * builds with "invalid config: Required", so the schema carries a root
 * default: an empty row resolves to every field's default.
 */
export type TerminalConfig = z.infer<typeof Config>;

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

/** Root default: an absent config block boots with all field defaults. */
export const Config = ConfigSchema.default({});
