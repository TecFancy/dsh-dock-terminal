import { TerminalPopover } from "./features/terminal-popover/TerminalPopover.tsx";
import { LOCALES, LOCALE_NS, syncLocale } from "./features/terminal-popover/i18n.ts";
import { terminalStore } from "./features/terminal-popover/terminal-store.ts";
import {
  COMPOSER_DOCK_SLOT,
  POPOVER_SLOT_ID,
  TERMINAL_BUTTON_ID,
  type ComposerDockProps,
  type TerminalClientContext,
} from "./shared/config/index.ts";

/**
 * dsh-dock-terminal client half: publishes a `terminal:open` button into the
 * dock-host's dockButtons registry and mounts the terminal popover into
 * `conversation.composer.dock` (the band under the composer card).
 *
 * The button toggles the terminal store; the popover renders nothing while
 * closed, and hosts one live xterm per tab otherwise.
 */
export const name = "dsh-dock-terminal";
export const inject = ["slots", "locale", "dockButtons"] as const;

export function apply(ctx: TerminalClientContext): void {
  // Own the plugin dictionaries (en + zh) for this run.
  ctx.effect(() => ctx.locale.register(LOCALE_NS, "zh", LOCALES.zh), "dsh-dock-terminal: zh");
  ctx.effect(() => ctx.locale.register(LOCALE_NS, "en", LOCALES.en), "dsh-dock-terminal: en");

  // Mirror the active locale into the popover's module state.
  const syncNow = () => syncLocale(ctx.locale.getSnapshot?.() ?? "en");
  ctx.effect(() => ctx.locale.subscribe(syncNow), "dsh-dock-terminal: locale subscription");
  syncNow();

  const bind = ctx.locale.bind(LOCALE_NS);
  ctx.effect(
    () =>
      ctx.dockButtons.register({
        id: TERMINAL_BUTTON_ID,
        order: 10,
        label: () => bind("open"),
        icon: "\u25B8",
        primary: true,
        run: () => terminalStore.toggle(),
      }),
    "dsh-dock-terminal: dock button",
  );

  ctx.slots.inject(COMPOSER_DOCK_SLOT, () =>
    ctx.slots.register({ name: COMPOSER_DOCK_SLOT, id: POPOVER_SLOT_ID, order: 0 }, (slotProps) => (
      <TerminalPopover {...(slotProps as ComposerDockProps)} />
    )),
  );
}
