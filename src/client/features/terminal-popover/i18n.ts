/**
 * Minimal i18n for the terminal popover (en + zh), module-state driven so the
 * popover components can translate without holding a locale service. The
 * assembly root feeds the active locale through {@link syncLocale}.
 */

export const LOCALE_NS = "dockTerminal";

/** Dictionaries published through ctx.locale.register (en + zh). */
export const LOCALES: {
  zh: Record<string, string>;
  en: Record<string, string>;
} = {
  zh: {
    title: "终端",
    open: "打开终端",
    close: "收起",
    placeholder: "此主机上 node-pty 不可用，终端无法启动",
  },
  en: {
    title: "Terminal",
    open: "Open terminal",
    close: "Collapse",
    placeholder: "node-pty is unavailable on this host; the terminal cannot start",
  },
};

let current = "en";
const listeners = new Set<() => void>();

/** Read the locale id from a LocaleRuntime snapshot (best-effort). */
export function syncLocale(snapshot: unknown): void {
  if (snapshot !== null && typeof snapshot === "object") {
    const anySnapshot = snapshot as { id?: unknown; locale?: unknown };
    const next = anySnapshot.id ?? anySnapshot.locale;
    if (typeof next === "string") {
      if (next.startsWith("zh")) {
        current = "zh";
      } else {
        current = "en";
      }
    }
  } else if (typeof snapshot === "string") {
    current = snapshot.startsWith("zh") ? "zh" : "en";
  }
  for (const fn of listeners) fn();
}

export function t(key: string): string {
  const id = current === "zh" ? "zh" : "en";
  return LOCALES[id][key] ?? key;
}
export function subscribeT(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
