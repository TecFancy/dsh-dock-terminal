/**
 * xterm palettes and the live theme-scheme bridge.
 *
 * The dsh web client hosts a `theme` service that emits `theme/change` with
 * a snapshot whose `active.colorScheme` says which base palette is on screen.
 * This module mirrors that signal into a tiny store with no @deepseek-ai
 * runtime imports (the shapes live in the shared config segment); every
 * TerminalView instance paints from a Catppuccin palette that follows the
 * scheme: Mocha in dark mode (the posh-mocha kit palette), Latte in light.
 */

/** The xterm ITheme subset this plugin owns. */
export interface XtermPalette {
  background: string;
  foreground: string;
  cursor: string;
  selectionBackground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

/** Catppuccin Mocha, the palette of the posh-mocha kit (official values). */
export const MOCHA_PALETTE: XtermPalette = Object.freeze({
  background: "#1e1e2e",
  foreground: "#cdd6f4",
  cursor: "#f5e0dc",
  selectionBackground: "#585b70",
  black: "#45475a",
  red: "#f38ba8",
  green: "#a6e3a1",
  yellow: "#f9e2af",
  blue: "#89b4fa",
  magenta: "#f5c2e7",
  cyan: "#94e2d5",
  white: "#bac2de",
  brightBlack: "#585b70",
  brightRed: "#f38ba8",
  brightGreen: "#a6e3a1",
  brightYellow: "#f9e2af",
  brightBlue: "#89b4fa",
  brightMagenta: "#f5c2e7",
  brightCyan: "#94e2d5",
  brightWhite: "#a6adc8",
});

/** Catppuccin Latte, the official light-side counterpart of Mocha. */
export const LATTE_PALETTE: XtermPalette = Object.freeze({
  background: "#eff1f5",
  foreground: "#4c4f69",
  cursor: "#dc8a78",
  selectionBackground: "#acb0be",
  black: "#bcc0cc",
  red: "#d20f39",
  green: "#40a02b",
  yellow: "#df8e1d",
  blue: "#1e66f5",
  magenta: "#ea76cb",
  cyan: "#179299",
  white: "#5c5f77",
  brightBlack: "#acb0be",
  brightRed: "#d20f39",
  brightGreen: "#40a02b",
  brightYellow: "#df8e1d",
  brightBlue: "#1e66f5",
  brightMagenta: "#ea76cb",
  brightCyan: "#179299",
  brightWhite: "#6c6f85",
});

export type XtermScheme = "light" | "dark";

/** Live scheme state; defaults to dark until the theme service reports. */
let scheme: XtermScheme = "dark";
const listeners = new Set<() => void>();

export const themeScheme = {
  get: (): XtermScheme => scheme,
  set(next: XtermScheme): void {
    if (next === scheme) return;
    scheme = next;
    for (const fn of listeners) fn();
  },
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

/** Resolve the active scheme from a theme snapshot; dark on any gap. */
export function schemeOf(snapshot: { active?: { colorScheme?: string } } | undefined): XtermScheme {
  return snapshot?.active?.colorScheme === "light" ? "light" : "dark";
}

export function xtermPaletteFor(next: XtermScheme): XtermPalette {
  return next === "light" ? LATTE_PALETTE : MOCHA_PALETTE;
}
