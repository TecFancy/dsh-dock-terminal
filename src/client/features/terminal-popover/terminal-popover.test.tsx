// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPopoverStore } from "./popover-store.ts";
import { syncLocale, t, subscribeT } from "./i18n.ts";
import { TerminalView } from "./TerminalView.tsx";
import { TerminalPopover } from "./TerminalPopover.tsx";

/** jsdom has no usable WebSocket; the view only needs construction + events. */
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

describe("popover store", () => {
  afterEach(cleanup);

  it("toggles and notifies subscribers; unsubscribe works", () => {
    const store = createPopoverStore();
    const seen: boolean[] = [];
    const unsubscribe = store.subscribe(() => seen.push(store.isOpen()));

    expect(store.isOpen()).toBe(false);
    store.open();
    store.open(); // no double notify
    expect(seen).toEqual([true]);
    store.toggle();
    expect(store.isOpen()).toBe(false);
    expect(seen).toEqual([true, false]);
    store.toggle();
    expect(store.isOpen()).toBe(true);

    unsubscribe();
    store.close();
    expect(seen).toEqual([true, false, true]);
  });
});

describe("i18n", () => {
  afterEach(() => {
    syncLocale("en");
  });

  it("resolves keys in zh and en and falls back to the key", () => {
    syncLocale("zh-CN");
    expect(t("title")).toBe("终端");
    syncLocale("en-US");
    expect(t("title")).toBe("Terminal");
    expect(t("missing")).toBe("missing");
  });

  it("keeps subscribers in sync with locale changes", () => {
    const seen: string[] = [];
    const unsubscribe = subscribeT(() => seen.push(t("open")));
    syncLocale("zh");
    expect(seen).toEqual(["打开终端"]);
    syncLocale({ id: "en" });
    expect(seen).toEqual(["打开终端", "Open terminal"]);
    syncLocale({ locale: "zh" });
    expect(seen).toHaveLength(3);
    unsubscribe();
    syncLocale("en");
    expect(seen).toHaveLength(3);
  });
});

describe("TerminalView", () => {
  afterEach(cleanup);

  it("connects a socket per session and writes terminal output", () => {
    MockWebSocket.instances = [];
    const { container } = render(<TerminalView sessionId="s1" />);
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0]!.url).toContain("sessionId=s1");

    const socket = MockWebSocket.instances[0]!;
    act(() => {
      (socket as unknown as { onopen: (() => void) | null }).onopen?.();
      const onmessage = (socket as unknown as { onmessage: ((e: { data: string }) => void) | null })
        .onmessage;
      onmessage?.({ data: "hi" });
    });
    expect(container.firstChild).not.toBeNull();
  });

  it("reports a failed connect and a dropped socket", () => {
    MockWebSocket.instances = [];
    const { container } = render(<TerminalView sessionId="s2" />);
    const socket = MockWebSocket.instances[0]!;

    act(() => {
      (
        socket as unknown as {
          onclose: ((e: { code: number; reason: string }) => void) | null;
        }
      ).onclose?.({ code: 1011, reason: "node-pty unavailable" });
    });
    expect(container.textContent).toContain("node-pty unavailable");

    act(() => {
      (
        socket as unknown as {
          onopen: (() => void) | null;
        }
      ).onopen?.();
      (
        socket as unknown as {
          onerror: (() => void) | null;
        }
      ).onerror?.();
    });
    expect(container.firstChild).not.toBeNull();
  });
});

describe("TerminalPopover", () => {
  afterEach(cleanup);

  it("renders nothing when the store is closed and the panel when open", () => {
    const store = createPopoverStore();
    const { container, rerender } = render(<TerminalPopover sessionId="s1" store={store} />);
    expect(container.querySelector('[data-testid="terminal-popover"]')).toBeNull();
    act(() => store.open());
    rerender(<TerminalPopover sessionId="s1" store={store} />);
    expect(container.querySelector('[data-testid="terminal-popover"]')).not.toBeNull();

    // The close button collapses the panel again (click the button).
    const closeButton = container.querySelector("button");
    act(() => {
      closeButton?.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    });
    expect(container.querySelector('[data-testid="terminal-popover"]')).toBeNull();
  });
});
