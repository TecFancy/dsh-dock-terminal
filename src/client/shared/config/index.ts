/**
 * Client shared config segment barrel. Import types through this barrel, never
 * directly from ./context.ts outside this segment.
 */
export type {
  ComposerDockProps,
  DockButton,
  DockButtonRunCtx,
  DockButtonsRegistry,
  DockLogger,
  LocaleService,
  SlotRegisterOptions,
  SlotsService,
  TerminalClientContext,
  ThemeServiceLite,
  ThemeSnapshotLite,
} from "./context.ts";
export { COMPOSER_DOCK_SLOT, POPOVER_SLOT_ID, TERMINAL_BUTTON_ID } from "./context.ts";
