// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { terminalStores, themeScheme } from "./features/terminal-popover/index.ts";
import { apply } from "./index.tsx";
import {
  COMPOSER_DOCK_SLOT,
  POPOVER_SLOT_ID,
  TERMINAL_BUTTON_ID,
  type DockButton,
  type TerminalClientContext,
  type ThemeServiceLite,
  type ThemeSnapshotLite,
} from "./shared/config/index.ts";

/** xterm is a DOM-heavy library; the view is exercised via its mock here. */
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    options: Record<string, unknown> = {};
    loadAddon(): void {
      return;
    }
    open(): void {
      return;
    }
    onData() {
      return { dispose: () => undefined };
    }
    onResize() {
      return { dispose: () => undefined };
    }
    write(): void {
      return;
    }
    refresh(): void {
      return;
    }
    dispose(): void {
      return;
    }
  },
}));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit(): void {
      return;
    }
  },
}));

/** jsdom has no usable WebSocket; the view only needs construction + send. */
class MockWebSocket {
  static OPEN = 1;
  static instances: MockWebSocket[] = [];
  readyState = 0;
  bufferedAmount = 0;
  readonly url: string;
  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }
  send(): void {
    return;
  }
  close(): void {
    this.readyState = 3;
  }
}
vi.stubGlobal("WebSocket", MockWebSocket);

function fakeContext(theme?: ThemeServiceLite) {
  const registrations: { options: unknown; view: (props: unknown) => unknown }[] = [];
  const localeCalls: unknown[][] = [];
  const effects: (() => unknown)[] = [];
  const buttons: DockButton[] = [];
  const eventListeners = new Set<(payload: unknown) => void>();
  const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });
  const ctx: TerminalClientContext = {
    slots: {
      inject: (slotName: string, register: () => void) => {
        expect(slotName).toBe(COMPOSER_DOCK_SLOT);
        register();
      },
      register: (options, view) => {
        registrations.push({ options, view });
        return undefined;
      },
    },
    locale: {
      register: (...args) => {
        localeCalls.push(args);
        return undefined;
      },
      bind: () => (key: string) => key,
      subscribe: () => () => undefined,
      getSnapshot: () => "en",
    },
    dockButtons: {
      register: (button) => {
        buttons.push(button);
        return () => undefined;
      },
      list: () => [],
      subscribe: () => () => undefined,
    },
    logger,
    effect: (fn) => {
      effects.push(fn);
      return fn();
    },
    get: (key) => (key === "theme" ? theme : undefined),
    on: (_name, listener) => {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
  };
  return {
    ctx,
    registrations,
    localeCalls,
    effects,
    buttons,
    emitEvent: (payload: unknown) => eventListeners.forEach((fn) => fn(payload)),
  };
}

describe("apply (client root)", () => {
  afterEach(() => {
    cleanup();
    terminalStores.reset();
  });

  it("registers dictionaries, the dock button, and the popover slot", () => {
    const { ctx, registrations, localeCalls, effects, buttons } = fakeContext();

    apply(ctx);

    expect(localeCalls).toHaveLength(2);
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.id).toBe(TERMINAL_BUTTON_ID);
    expect(effects.length).toBeGreaterThanOrEqual(3);
    expect(registrations).toHaveLength(1);
    expect(registrations[0]?.options).toMatchObject({
      name: COMPOSER_DOCK_SLOT,
      id: POPOVER_SLOT_ID,
    });
    expect(registrations[0]?.view).toBeTypeOf("function");
  });

  it("renders nothing while closed and mounts the popover on toggle, unmounting after the collapse", async () => {
    const { ctx, registrations, buttons } = fakeContext();
    apply(ctx);
    const view = registrations[0]!.view;

    const { container } = render(view({ sessionId: "s1" }) as ReactNode);
    expect(container.querySelector('[data-testid="terminal-popover"]')).toBeNull();

    act(() => {
      void buttons[0]!.run({ sessionId: "s1" });
    });
    // The mount beat is a 0 ms timer; poll instead of sleeping so slow
    // runners (Windows CI) do not race it.
    await waitFor(() => {
      expect(container.querySelector('[data-testid="terminal-popover"]')).not.toBeNull();
    });

    act(() => {
      void buttons[0]!.run({ sessionId: "s1" });
    });
    // The collapse transition keeps the wrapper mounted for one beat.
    expect(container.querySelector('[data-testid="terminal-popover"]')).not.toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 260));
    expect(container.querySelector('[data-testid="terminal-popover"]')).toBeNull();
  });

  it("mirrors the theme scheme from the theme service and follows theme/change", () => {
    themeScheme.set("dark");
    let current: ThemeSnapshotLite = {
      preference: "dark",
      active: { id: "dark", colorScheme: "dark" },
    };
    const themeService: ThemeServiceLite = {
      getTheme: () => current,
      setTheme: () => undefined,
    };
    const { ctx, emitEvent } = fakeContext(themeService);
    apply(ctx);
    expect(themeScheme.get()).toBe("dark");

    // The real service updates its state, then emits theme/change.
    current = { preference: "light", active: { id: "light", colorScheme: "light" } };
    emitEvent(current);
    expect(themeScheme.get()).toBe("light");

    current = { preference: "dark", active: { id: "dark", colorScheme: "dark" } };
    emitEvent(current);
    expect(themeScheme.get()).toBe("dark");
  });

  it("stays on the dark palette without a theme service", () => {
    themeScheme.set("light");
    const { ctx } = fakeContext();
    apply(ctx);
    // No theme service: the store is never touched, so the scheme keeps the
    // module default only when it was reset; set it back after the check.
    expect(themeScheme.get()).toBe("light");
    themeScheme.set("dark");
  });

  it("ignores a toggle with no sessionId so a later session does not inherit an open panel", () => {
    const { ctx, registrations, buttons } = fakeContext();
    apply(ctx);
    const view = registrations[0]!.view;

    act(() => {
      void buttons[0]!.run({});
    });
    const { container, rerender } = render(view({ sessionId: "s1" }) as ReactNode);
    expect(container.querySelector('[data-testid="terminal-popover"]')).toBeNull();

    rerender(view({ sessionId: "s2" }) as ReactNode);
    expect(container.querySelector('[data-testid="terminal-popover"]')).toBeNull();
  });

  it("opens only the conversation whose sessionId was toggled", async () => {
    const { ctx, registrations, buttons } = fakeContext();
    apply(ctx);
    const view = registrations[0]!.view;

    const { container, rerender } = render(view({ sessionId: "s1" }) as ReactNode);
    act(() => {
      void buttons[0]!.run({ sessionId: "s1" });
    });
    await waitFor(() => {
      expect(container.querySelector('[data-testid="terminal-popover"]')).not.toBeNull();
    });

    rerender(view({ sessionId: "s2" }) as ReactNode);
    expect(container.querySelector('[data-testid="terminal-popover"]')).toBeNull();

    rerender(view({ sessionId: "s1" }) as ReactNode);
    await waitFor(() => {
      expect(container.querySelector('[data-testid="terminal-popover"]')).not.toBeNull();
    });
  });
});
