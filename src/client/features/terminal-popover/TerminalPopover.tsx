import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { ComposerDockProps } from "../../shared/config/index.ts";
import { subscribeT, t } from "./i18n.ts";
import { terminalStores, type TerminalStore } from "./terminal-store.ts";
import { TerminalView, type TerminalMeta } from "./TerminalView.tsx";
import styles from "./terminal.module.css";

export interface TerminalPopoverProps extends ComposerDockProps {
  /** Injectable for tests; defaults to the store for `sessionId`. */
  store?: TerminalStore;
}

/** Closed stand-in when the slot has no session yet (hero / new conversation). */
const CLOSED_STORE: TerminalStore = {
  open: () => undefined,
  close: () => undefined,
  toggle: () => undefined,
  isOpen: () => false,
  tabs: () => [],
  activeId: () => null,
  hasTab: () => false,
  activate: () => undefined,
  addTab: () => null,
  closeTab: () => undefined,
  setMaxPerSession: () => undefined,
  maxPerSession: () => 0,
  subscribe: () => () => undefined,
};

/** Must match the wrap transition duration in terminal.module.css. */
const ANIM_MS = 200;
/** Extra beat before the first-frame expansion class flips (transition kick). */
const EXPAND_KICK_MS = 16;

/**
 * The popover mounted into `conversation.composer.dock` (the band under the
 * composer card). Renders nothing until the dock button opens this session's
 * store; on open it hosts one live terminal per tab (capped only when the
 * host configures a positive maxPerSession), with a tab bar to switch
 * between them. A different conversation reads a different store, so an
 * open panel in A does not appear in B.
 *
 * Open and close animate: the wrapper stays mounted through the collapse
 * transition (grid-template-rows 1fr -> 0fr plus a fade), then unmounts, so
 * the popover never pops in or out without motion.
 */
export function TerminalPopover(props: TerminalPopoverProps) {
  const sessionId = props.sessionId;
  const store =
    props.store ??
    (sessionId !== undefined && sessionId !== ""
      ? terminalStores.storeFor(sessionId)
      : CLOSED_STORE);
  const open = useSyncExternalStore(store.subscribe, store.isOpen, () => false);
  useSyncExternalStore(
    subscribeT,
    () => 0,
    () => 0,
  );
  const tabs = useSyncExternalStore(store.subscribe, store.tabs, () => []);
  const activeId = useSyncExternalStore(store.subscribe, store.activeId, () => null);
  const maxPerSession = useSyncExternalStore(store.subscribe, store.maxPerSession, () => 0);
  const [meta, setMeta] = useState<TerminalMeta | null>(null);
  const handleMeta = useCallback((next: TerminalMeta) => setMeta(next), []);

  // Mount gate: keep the wrapper alive past the close tick so the collapse
  // transition plays, then unmount for real. All flips go through timers
  // (no sync setState in effects): the open beat restores a previously
  // unmounted popover, the close beat unmounts after ANIM_MS.
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) {
      if (mounted) return;
      const timer = setTimeout(() => setMounted(true), 0);
      return () => clearTimeout(timer);
    }
    if (!mounted) return;
    const timer = setTimeout(() => setMounted(false), ANIM_MS);
    return () => clearTimeout(timer);
  }, [open, mounted]);

  // Expansion kick: arrive at 0fr for one frame so the grid-template-rows
  // transition animates on open as well as close.
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setExpanded(open), open ? EXPAND_KICK_MS : 0);
    return () => clearTimeout(timer);
  }, [open]);

  if (!mounted) return null;

  const atLimit = maxPerSession > 0 && tabs.length >= maxPerSession;
  const wrapClass = !open || !expanded ? styles["wrapCollapsed"] : styles["wrap"];

  return (
    <div className={wrapClass} data-testid="terminal-popover-wrap">
      <div className={styles["wrapInner"]}>
        <section
          className={styles["popover"]}
          data-testid="terminal-popover"
          aria-label={t("title")}
        >
          <header className={styles["header"]}>
            <span className={styles["title"]}>{t("title")}</span>
            {meta !== null ? (
              <span className={styles["meta"]}>
                {meta.shell} · {meta.cwd}
              </span>
            ) : null}
            <button
              type="button"
              className={styles["close"]}
              onClick={() => store.close()}
              title={t("close")}
              aria-label={t("close")}
            >
              ×
            </button>
          </header>
          <div className={styles["tabbar"]}>
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={tab.id === activeId ? styles["tabActive"] : styles["tab"]}
                onClick={() => store.activate(tab.id)}
                title={t("title")}
              >
                <span className={styles["tabLabel"]}>{meta?.shell ?? t("title")}</span>
                <span
                  role="button"
                  className={styles["tabClose"]}
                  aria-label={t("closeTab")}
                  title={t("closeTab")}
                  onClick={(event) => {
                    event.stopPropagation();
                    store.closeTab(tab.id);
                  }}
                >
                  ×
                </span>
              </button>
            ))}
            <button
              type="button"
              className={styles["tabAdd"]}
              disabled={atLimit}
              onClick={() => store.addTab()}
              title={atLimit ? t("limitReached") : t("newTab")}
              aria-label={t("newTab")}
            >
              +
            </button>
          </div>
          <div className={styles["body"]}>
            {/* Every tab stays mounted (inactive ones hidden): switching tabs
             * keeps each pty socket live, and unmount (close tab / collapse)
             * sends the final close frame for that tab. */}
            {tabs.map((tab) => (
              <div
                key={tab.id}
                className={tab.id === activeId ? styles["pane"] : styles["paneHidden"]}
              >
                <TerminalView
                  sessionId={props.sessionId}
                  tabId={tab.id}
                  onMeta={handleMeta}
                  store={store}
                />
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
