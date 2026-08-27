import { useCallback, useState, useSyncExternalStore } from "react";
import type { ComposerDockProps } from "../../shared/config/index.ts";
import { subscribeT, t } from "./i18n.ts";
import { terminalStore, type TerminalStore } from "./terminal-store.ts";
import { TerminalView, type TerminalMeta } from "./TerminalView.tsx";
import styles from "./terminal.module.css";

export interface TerminalPopoverProps extends ComposerDockProps {
  /** Injectable for tests; defaults to the module-level shared store. */
  store?: TerminalStore;
}

/**
 * The popover mounted into `conversation.composer.dock` (the band under the
 * composer card). Renders nothing until the dock button opens the shared
 * store; on open it hosts one live terminal per tab (bounded by the host
 * maxPerSession meta), with a tab bar to switch between them.
 */
export function TerminalPopover(props: TerminalPopoverProps) {
  const store = props.store ?? terminalStore;
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
  if (!open) return null;

  const atLimit = maxPerSession > 0 && tabs.length >= maxPerSession;

  return (
    <section className={styles["popover"]} data-testid="terminal-popover" aria-label={t("title")}>
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
          <div key={tab.id} className={tab.id === activeId ? styles["pane"] : styles["paneHidden"]}>
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
  );
}
