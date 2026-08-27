import { useSyncExternalStore } from "react";
import type { ComposerDockProps } from "../../shared/config/index.ts";
import { subscribeT, t } from "./i18n.ts";
import { popoverStore, type PopoverStore } from "./popover-store.ts";
import { TerminalView } from "./TerminalView.tsx";
import styles from "./terminal.module.css";

export interface TerminalPopoverProps extends ComposerDockProps {
  /** Injectable for tests; defaults to the module-level shared store. */
  store?: PopoverStore;
}

/**
 * The popover mounted into `conversation.composer.dock` (the band under the
 * composer card). Renders nothing until the dock button toggles the shared
 * store; on open it hosts a live terminal bound to the current session.
 */
export function TerminalPopover(props: TerminalPopoverProps) {
  const store = props.store ?? popoverStore;
  const open = useSyncExternalStore(store.subscribe, store.isOpen, () => false);
  useSyncExternalStore(
    subscribeT,
    () => 0,
    () => 0,
  );
  if (!open) return null;

  return (
    <section className={styles["popover"]} data-testid="terminal-popover" aria-label={t("title")}>
      <header className={styles["header"]}>
        <span className={styles["title"]}>{t("title")}</span>
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
      <div className={styles["body"]}>
        <TerminalView sessionId={props.sessionId} />
      </div>
    </section>
  );
}
