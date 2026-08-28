/**
 * Module-level terminal popover state shared between the dock button (the
 * registry's run callback) and the composer.dock slot view.
 *
 * The store owns the popover visibility AND its terminal tabs: each tab is a
 * stable id the host keys its pty on (`${sessionId}:${tabId}`). A view that
 * stops rendering a tab because the user switched to another tab parks the
 * pty on the host (the process survives); closing the tab sends a close frame
 * instead. `maxPerSession` is learned from the host meta frame and caps the
 * "+" button once known.
 */

export interface TerminalTab {
  id: string;
}

/** Function-property signatures (not method syntax): the store is passed
 * around by reference (useSyncExternalStore, callbacks) and must not carry a
 * this-context hazard. */
export interface TerminalStore {
  open: () => void;
  close: () => void;
  toggle: () => void;
  isOpen: () => boolean;
  tabs: () => TerminalTab[];
  activeId: () => string | null;
  hasTab: (id: string) => boolean;
  activate: (id: string) => void;
  addTab: () => string | null;
  closeTab: (id: string) => void;
  setMaxPerSession: (count: number) => void;
  maxPerSession: () => number;
  subscribe: (fn: () => void) => () => void;
}

export function createTerminalStore(): TerminalStore {
  let opened = false;
  let tabs: TerminalTab[] = [];
  let activeId: string | null = null;
  /** 0 = unknown; the host enforces the cap until the meta frame arrives. */
  let maxPerSession = 0;
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const fn of listeners) fn();
  };

  const api: TerminalStore = {
    open() {
      if (!opened) {
        opened = true;
        if (tabs.length === 0) {
          const tab = { id: createTabId() };
          tabs = [tab];
          activeId = tab.id;
        }
        notify();
      }
    },
    close() {
      if (opened) {
        // Collapse only: tabs stay alive so the ptys keep running (the view
        // parks them) and reopening resumes the same tabs. Real teardown
        // happens per tab via closeTab (or when the session is disposed).
        opened = false;
        notify();
      }
    },
    toggle() {
      if (opened) {
        api.close();
      } else {
        api.open();
      }
    },
    isOpen: () => opened,
    tabs: () => tabs,
    activeId: () => activeId,
    hasTab: (id: string) => tabs.some((tab) => tab.id === id),
    activate(id: string) {
      if (activeId !== id && tabs.some((tab) => tab.id === id)) {
        activeId = id;
        notify();
      }
    },
    addTab() {
      if (maxPerSession > 0 && tabs.length >= maxPerSession) return null;
      const tab = { id: createTabId() };
      tabs = [...tabs, tab];
      activeId = tab.id;
      notify();
      return tab.id;
    },
    closeTab(id: string) {
      if (!tabs.some((tab) => tab.id === id)) return;
      const remaining = tabs.filter((tab) => tab.id !== id);
      if (remaining.length === 0) {
        tabs = [];
        activeId = null;
        opened = false;
      } else {
        tabs = remaining;
        if (activeId === id) activeId = remaining[remaining.length - 1]!.id;
      }
      notify();
    },
    setMaxPerSession(count: number) {
      if (count > 0 && count !== maxPerSession) {
        maxPerSession = count;
        notify();
      }
    },
    maxPerSession: () => maxPerSession,
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
  return api;
}

/** One tab id, stable for the lifetime of the store (its pty key). */
function createTabId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export const terminalStore = createTerminalStore();
