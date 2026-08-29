import z from "@deepseek-ai/schemastery";

/**
 * Terminal host configuration (plugin Config schema surface).
 *
 * Cordis plugins declare their configurable surface as a schemastery schema
 * (exported as `Config` from the plugin root). The cordis loader validates
 * the plugin row's config even when the row carries no `config:` block
 * (bundle patches insert only id/name). Field defaults fill an empty row;
 * the schema is callable with `undefined` / `{}` and still resolves.
 */
export interface TerminalConfig {
  /** Explicit shell binary; empty resolves $SHELL (posix) or powershell.exe. */
  shell: string;
  /** Explicit shell startup args; empty uses the platform default (-l posix). */
  shellArgs: string[];
  /**
   * Concurrent pty processes per conversation. The default caps the "+" tab
   * bar at 3; set 0 for an unlimited tab bar, or a different positive value
   * for another guard.
   */
  maxPerSession: number;
  /** Grace window a bare socket drop waits before its pty dies, in ms. */
  reconnectGraceMs: number;
}

export const Config = z.object({
  shell: z.string().default(""),
  shellArgs: z.array(z.string()).default([]),
  maxPerSession: z.natural().max(16).default(3),
  reconnectGraceMs: z.natural().default(30000),
});
