// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { apply } from "./index.tsx";
import {
  COMPOSER_DOCK_SLOT,
  POPOVER_SLOT_ID,
  TERMINAL_BUTTON_ID,
  type DockButton,
  type TerminalClientContext,
} from "./shared/config/index.ts";

/** xterm is a DOM-heavy library; the view is exercised via its mock here. */
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
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

function fakeContext() {
  const registrations: { options: unknown; view: (props: unknown) => unknown }[] = [];
  const localeCalls: unknown[][] = [];
  const effects: (() => unknown)[] = [];
  const buttons: DockButton[] = [];
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
  };
  return { ctx, registrations, localeCalls, effects, buttons };
}

describe("apply (client root)", () => {
  afterEach(cleanup);

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

  it("renders nothing while closed and mounts the popover on toggle", () => {
    const { ctx, registrations, buttons } = fakeContext();
    apply(ctx);
    const view = registrations[0]!.view;

    const { container } = render(view({ sessionId: "s1" }) as ReactNode);
    expect(container.querySelector('[data-testid="terminal-popover"]')).toBeNull();

    act(() => {
      void buttons[0]!.run({});
    });
    expect(container.querySelector('[data-testid="terminal-popover"]')).not.toBeNull();

    act(() => {
      void buttons[0]!.run({});
    });
    expect(container.querySelector('[data-testid="terminal-popover"]')).toBeNull();
  });
});
