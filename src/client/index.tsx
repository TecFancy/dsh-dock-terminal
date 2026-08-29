import {
  LOCALES,
  LOCALE_NS,
  schemeOf,
  syncLocale,
  TerminalIcon,
  TerminalPopover,
  terminalStores,
  themeScheme,
} from "./features/terminal-popover/index.ts";
import {
  COMPOSER_DOCK_SLOT,
  POPOVER_SLOT_ID,
  TERMINAL_BUTTON_ID,
  type ComposerDockProps,
  type TerminalClientContext,
  type ThemeServiceLite,
} from "./shared/config/index.ts";

/**
 * dsh-dock-terminal client half: publishes a `terminal:open` button into the
 * dock-host's dockButtons registry and mounts the terminal popover into
 * `conversation.composer.dock` (the band under the composer card).
 *
 * The button toggles the store for the current conversation; the popover
 * renders nothing while that session's store is closed. A new-session /
 * hero screen has no sessionId and no composer.dock band, so the toggle
 * is a no-op there.
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

  // Mirror the active theme scheme into the terminal palette store so every
  // xterm view repaints on light/dark switches. The theme service is
  // optional (older dsh web hosts lack it); without it the terminal stays
  // on the dark Catppuccin Mocha palette.
  const theme = ctx.get?.("theme") as ThemeServiceLite | undefined;
  const onEvent = ctx.on;
  if (theme !== undefined && onEvent !== undefined) {
    const syncTheme = () => themeScheme.set(schemeOf(theme.getTheme()));
    syncTheme();
    ctx.effect(() => onEvent("theme/change", () => syncTheme()), "dsh-dock-terminal: theme sync");
  }

  const bind = ctx.locale.bind(LOCALE_NS);
  ctx.effect(
    () =>
      ctx.dockButtons.register({
        id: TERMINAL_BUTTON_ID,
        order: 10,
        label: () => bind("open"),
        icon: <TerminalIcon />,
        primary: true,
        enabled: (buttonCtx) =>
          typeof buttonCtx.sessionId === "string" && buttonCtx.sessionId !== "",
        run: (buttonCtx) => terminalStores.toggle(buttonCtx.sessionId),
      }),
    "dsh-dock-terminal: dock button",
  );

  ctx.slots.inject(COMPOSER_DOCK_SLOT, () =>
    ctx.slots.register({ name: COMPOSER_DOCK_SLOT, id: POPOVER_SLOT_ID, order: 0 }, (slotProps) => {
      const props = slotProps as ComposerDockProps;
      return <TerminalPopover key={props.sessionId ?? "none"} {...props} />;
    }),
  );
}
