/**
 * Module-level popover visibility store shared between the dock button (the
 * registry's run callback) and the composer.dock slot view. A plain emitter
 * keeps both halves independent of each other; React subscribes through
 * useSyncExternalStore.
 */

export interface PopoverStore {
  open: () => void;
  close: () => void;
  toggle: () => void;
  isOpen: () => boolean;
  subscribe: (fn: () => void) => () => void;
}

export function createPopoverStore(): PopoverStore {
  let open = false;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const fn of listeners) fn();
  };
  return {
    open: () => {
      if (!open) {
        open = true;
        notify();
      }
    },
    close: () => {
      if (open) {
        open = false;
        notify();
      }
    },
    toggle: () => {
      open = !open;
      notify();
    },
    isOpen: () => open,
    subscribe: (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}

export const popoverStore = createPopoverStore();
