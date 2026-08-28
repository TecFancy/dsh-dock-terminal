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
    open: "终端",
    close: "收起",
    newTab: "新建终端",
    closeTab: "关闭终端",
    retry: "重试",
    unavailable: "此主机上 node-pty 不可用，终端无法启动",
    repairHint:
      "修复方法：在 dsh 环境的 profile 目录执行 pnpm approve-builds --all && pnpm rebuild node-pty，然后重启 dsh",
    limitReached: "已达到本会话终端上限",
  },
  en: {
    title: "Terminal",
    open: "Terminal",
    close: "Collapse",
    newTab: "New terminal",
    closeTab: "Close terminal",
    retry: "Retry",
    unavailable: "node-pty is unavailable on this host; the terminal cannot start",
    repairHint:
      "To fix: run pnpm approve-builds --all && pnpm rebuild node-pty in the dsh profile directory, then restart dsh",
    limitReached: "Terminal limit reached for this conversation",
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
