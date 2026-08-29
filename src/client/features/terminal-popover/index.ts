export { TerminalPopover } from "./TerminalPopover.tsx";
export { TerminalView, type TerminalMeta } from "./TerminalView.tsx";
export { TerminalIcon } from "./TerminalIcon.tsx";
export { LOCALES, LOCALE_NS, syncLocale, t } from "./i18n.ts";
export {
  createTerminalSessionStores,
  createTerminalStore,
  terminalStore,
  terminalStores,
  type TerminalSessionStores,
  type TerminalStore,
} from "./terminal-store.ts";
export { schemeOf, themeScheme } from "./xterm-theme.ts";
