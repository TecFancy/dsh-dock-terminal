/**
 * Structural type contracts for the dsh-dock-terminal client half.
 *
 * Plain structural mirrors of the dsh web client services the plugin touches.
 * The client bundle is built as a single externalized file whose only externals
 * are react / react/jsx-runtime (see tsdown.config.ts), so this file must
 * NEVER import any @deepseek-ai/* runtime value: everything here is a shape,
 * and the real objects are injected by the dsh web host at runtime.
 */

export interface SlotRegisterOptions {
  name: string;
  id: string;
  order?: number;
  label?: string | (() => string);
}

export interface SlotsService {
  inject(slotName: string, register: () => void): void;
  register(options: SlotRegisterOptions, view: (props: unknown) => unknown): unknown;
}

export interface LocaleService {
  register(namespace: string, lang: string, dictionary: Readonly<Record<string, string>>): unknown;
  bind(namespace: string): (key: string) => string;
  subscribe(fn: () => void): () => void;
  /** Optional runtime API the real LocaleRuntime provides (snapshot read). */
  getSnapshot?(): unknown;
}

/** A registered dock button (published into the dock host's registry). */
export interface DockButton {
  id: string;
  order?: number;
  label: string | (() => string);
  /**
   * Optional leading glyph. A string renders as a text prefix; an element
   * (inline SVG) renders as a standalone glyph inheriting the button color
   * (dock-host 0.2.1+; older hosts render it as a text prefix).
   */
  icon?: string | import("react").ReactElement;
  enabled?: boolean | ((ctx: DockButtonRunCtx) => boolean);
  primary?: boolean;
  run(ctx: DockButtonRunCtx): void | Promise<void>;
}

/** What the dock-host row passes into `run()` (sessionId is absent on hero). */
export interface DockButtonRunCtx {
  sessionId?: string;
}

/** The client `dockButtons` service published by dsh-dock-host. */
export interface DockButtonsRegistry {
  register(button: DockButton): () => void;
  list(): DockButton[];
  subscribe(fn: () => void): () => void;
}

/** A minimal cordis logger shape (ctx.logger(namespace)). */
export interface DockLogger {
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

/**
 * Conversation composer share the `conversation.composer.dock` slot owner
 * passes (a minimal projection of the real InputZone + framework session kit).
 */
export interface ComposerDockProps {
  sessionId?: string;
  input?: unknown;
  session?: unknown;
  useSession?: unknown;
  useProjection?: unknown;
}

/** Minimal shape of the client `theme` service snapshot (`theme/change`). */
export interface ThemeSnapshotLite {
  preference?: string;
  active: { id: string; colorScheme: "light" | "dark" };
  revision?: number;
}

/** Minimal shape of the client `theme` service (optional service). */
export interface ThemeServiceLite {
  getTheme(): ThemeSnapshotLite;
  setTheme(id: string): void;
}

/** The cordis client context shape this plugin relies on. */
export interface TerminalClientContext {
  slots: SlotsService;
  locale: LocaleService;
  dockButtons: DockButtonsRegistry;
  logger: (namespace: string) => DockLogger;
  effect: (fn: () => unknown, label?: string) => unknown;
  /** Optional cordis lookup for optional services (the theme service). */
  get?(key: string): unknown;
  /** Client event bus (theme/change); returns the disposer. */
  on?(this: void, name: string, listener: (payload: unknown) => void): unknown;
}

/** The `conversation.composer.dock` slot key. */
export const COMPOSER_DOCK_SLOT = "conversation.composer.dock";
/** Dock button id this plugin publishes. */
export const TERMINAL_BUTTON_ID = "terminal:open";
/** Slot id of the popover view. */
export const POPOVER_SLOT_ID = "dock-terminal-popover";
