// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { syncLocale, t } from "./i18n.ts";
import { createTerminalStore, terminalStore } from "./terminal-store.ts";
import { TerminalView } from "./TerminalView.tsx";
import { TerminalPopover } from "./TerminalPopover.tsx";
import { themeScheme } from "./xterm-theme.ts";

/** Captured xterm instances so tests can inspect options.theme. */
const xtermState = vi.hoisted(() => ({
  instances: [] as { options: Record<string, unknown> }[],
}));

/** jsdom has no usable WebSocket; the view only needs construction + events. */
class MockWebSocket {
  static OPEN = 1;
  static instances: MockWebSocket[] = [];
  static frames: string[] = [];
  readyState = 0;
  bufferedAmount = 0;
  readonly url: string;
  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }
  send(data: string): void {
    MockWebSocket.frames.push(data);
  }
  close(): void {
    this.readyState = 3;
  }
  /** Simulate the browser opening the socket (readyState flips to OPEN). */
  fireOpen(): void {
    this.readyState = 1;
    (this as unknown as { onopen: (() => void) | null }).onopen?.();
  }
}
vi.stubGlobal("WebSocket", MockWebSocket);
vi.mock("@xterm/xterm", () => {
  class Terminal {
    cols = 80;
    rows = 24;
    options: Record<string, unknown>;
    constructor(options?: Record<string, unknown>) {
      this.options = options ?? {};
      xtermState.instances.push(this);
    }
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
  }
  return { Terminal };
});
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit(): void {
      return;
    }
  },
}));

describe("terminal store", () => {
  it("opens with one tab, collapses without losing it, and closes on the last tab close", () => {
    const store = createTerminalStore();
    const seen: boolean[] = [];
    const unsubscribe = store.subscribe(() => seen.push(store.isOpen()));

    expect(store.isOpen()).toBe(false);
    expect(store.tabs()).toHaveLength(0);
    store.open();
    expect(store.isOpen()).toBe(true);
    expect(store.tabs()).toHaveLength(1);
    const first = store.tabs()[0]!.id;
    expect(store.activeId()).toBe(first);

    store.toggle();
    expect(store.isOpen()).toBe(false);
    // Collapse keeps the tabs alive (the ptys keep running, parked).
    expect(store.tabs()).toHaveLength(1);
    expect(store.tabs()[0]!.id).toBe(first);
    expect(store.activeId()).toBe(first);
    store.toggle();
    expect(store.isOpen()).toBe(true);
    // Reopening resumes the same tab, not a fresh one.
    expect(store.tabs()).toHaveLength(1);
    expect(store.tabs()[0]!.id).toBe(first);

    // Closing the last tab collapses the popover and tears the tab down.
    store.closeTab(first);
    expect(store.isOpen()).toBe(false);
    expect(store.tabs()).toHaveLength(0);
    expect(store.activeId()).toBeNull();
    unsubscribe();
  });

  it("adds tabs, activates and closes one without collapsing the popover", () => {
    const store = createTerminalStore();
    store.open();
    const a = store.activeId()!;
    const b = store.addTab()!;
    expect(store.activeId()).toBe(b);
    expect(store.tabs()).toHaveLength(2);

    store.activate(a);
    expect(store.activeId()).toBe(a);
    store.closeTab(b);
    expect(store.isOpen()).toBe(true);
    expect(store.tabs()).toHaveLength(1);
    expect(store.activeId()).toBe(a);
  });

  it("enforces maxPerSession once the host meta frame reports it", () => {
    const store = createTerminalStore();
    store.open();
    store.setMaxPerSession(2);
    store.addTab();
    expect(store.addTab()).toBeNull();
    expect(store.tabs()).toHaveLength(2);
    expect(store.maxPerSession()).toBe(2);
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
});

describe("TerminalView", () => {
  afterEach(cleanup);

  function renderView(sessionId: string, tabId = "t1") {
    return render(<TerminalView sessionId={sessionId} tabId={tabId} />);
  }

  it("connects a socket per session and writes terminal output", () => {
    MockWebSocket.instances = [];
    const { container } = renderView("s1");
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0]!.url).toContain("sessionId=s1");
    expect(MockWebSocket.instances[0]!.url).toContain("tab=t1");

    const socket = MockWebSocket.instances[0]!;
    act(() => {
      socket.fireOpen();
      const onmessage = (socket as unknown as { onmessage: ((e: { data: string }) => void) | null })
        .onmessage;
      onmessage?.({ data: "hi" });
    });
    expect(container.firstChild).not.toBeNull();
  });

  it("consumes the meta frame: reports it and caps the store", () => {
    MockWebSocket.instances = [];
    const store = createTerminalStore();
    store.open();
    const onMeta = vi.fn();
    const { container } = render(
      <TerminalView sessionId="s1" tabId={store.activeId()!} onMeta={onMeta} store={store} />,
    );
    const socket = MockWebSocket.instances[0]!;
    act(() => {
      socket.fireOpen();
      const onmessage = (socket as unknown as { onmessage: ((e: { data: string }) => void) | null })
        .onmessage;
      onmessage?.({
        data: JSON.stringify({ type: "meta", shell: "bash", cwd: "/tmp", maxPerSession: 3 }),
      });
    });
    expect(onMeta).toHaveBeenCalledWith({
      type: "meta",
      shell: "bash",
      cwd: "/tmp",
      maxPerSession: 3,
    });
    expect(store.maxPerSession()).toBe(3);
    expect(container.firstChild).not.toBeNull();
  });

  it("shows the failure banner with repair hint and retry on a 1011 close", () => {
    MockWebSocket.instances = [];
    const { container, unmount } = renderView("s2");
    const socket = MockWebSocket.instances[0]!;
    act(() => {
      (
        socket as unknown as {
          onclose: ((e: { code: number; reason: string }) => void) | null;
        }
      ).onclose?.({ code: 1011, reason: "node-pty unavailable on this host" });
    });
    expect(container.textContent).toContain("node-pty unavailable on this host");
    expect(container.textContent).toContain("pnpm");
    unmount();
  });

  it("reconnects when the user clicks retry after a failed attach", () => {
    MockWebSocket.instances = [];
    const { container } = renderView("s3");
    const first = MockWebSocket.instances[0]!;
    act(() => {
      (
        first as unknown as {
          onclose: ((e: { code: number; reason: string }) => void) | null;
        }
      ).onclose?.({ code: 1011, reason: "boom" });
    });
    expect(container.textContent).toContain("boom");

    const retry = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.toLowerCase().includes("retry"),
    );
    act(() => {
      retry?.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    });
    expect(MockWebSocket.instances).toHaveLength(2);
    expect(container.textContent).not.toContain("boom");
  });

  it("writes non-meta JSON output verbatim without breaking", () => {
    MockWebSocket.instances = [];
    const { container } = renderView("s4", "t9");
    const socket = MockWebSocket.instances[0]!;
    act(() => {
      socket.fireOpen();
      const onmessage = (socket as unknown as { onmessage: ((e: { data: string }) => void) | null })
        .onmessage;
      onmessage?.({ data: '{"some":"pty-output"}' });
    });
    expect(container.firstChild).not.toBeNull();
  });

  it("sends exactly one park frame on a session switch while the popover is open", () => {
    MockWebSocket.instances = [];
    MockWebSocket.frames = [];
    const store = createTerminalStore();
    store.open();
    const first = store.tabs()[0]!.id;
    const { rerender } = render(<TerminalView sessionId="s1" tabId={first} store={store} />);
    const socket = MockWebSocket.instances[0]!;
    act(() => {
      socket.fireOpen();
    });
    MockWebSocket.frames = [];

    // The user switched to another conversation: park the pty, do not close.
    act(() => {
      rerender(<TerminalView sessionId="s2" tabId={first} store={store} />);
    });

    const parked = MockWebSocket.frames.filter((frame) => frame.includes('"type":"park"'));
    const closed = MockWebSocket.frames.filter((frame) => frame.includes('"type":"close"'));
    expect(parked).toHaveLength(1);
    expect(closed).toHaveLength(0);
    expect(store.hasTab(first)).toBe(true);
    store.close();
  });

  it("sends a close frame when its tab is closed while another stays open", () => {
    MockWebSocket.instances = [];
    MockWebSocket.frames = [];
    const store = createTerminalStore();
    store.open();
    const first = store.tabs()[0]!.id;
    const added = store.addTab()!;
    const activeFirst = render(<TerminalView sessionId="s1" tabId={first} store={store} />);
    act(() => {
      MockWebSocket.instances[0]!.fireOpen();
    });
    MockWebSocket.frames = [];
    store.closeTab(first);
    act(() => {
      activeFirst.unmount();
    });

    const closed = MockWebSocket.frames.filter((frame) => frame.includes('"type":"close"'));
    expect(closed).toHaveLength(1);
    expect(store.hasTab(added)).toBe(true);
    store.close();
  });

  it("parks the pty when the popover collapses instead of killing it", () => {
    MockWebSocket.instances = [];
    MockWebSocket.frames = [];
    const store = createTerminalStore();
    store.open();
    const first = store.tabs()[0]!.id;
    const view = render(<TerminalView sessionId="s1" tabId={first} store={store} />);
    act(() => {
      MockWebSocket.instances[0]!.fireOpen();
    });
    MockWebSocket.frames = [];

    // Collapse: the tab stays in the store, so the teardown frame is park
    // (the pty keeps running) and reopening resumes the same shell.
    act(() => {
      store.close();
    });
    expect(store.hasTab(first)).toBe(true);
    act(() => {
      view.unmount();
    });

    const parked = MockWebSocket.frames.filter((frame) => frame.includes('"type":"park"'));
    const closed = MockWebSocket.frames.filter((frame) => frame.includes('"type":"close"'));
    expect(parked).toHaveLength(1);
    expect(closed).toHaveLength(0);
    store.closeTab(first);
  });

  it("repaints the xterm palette when the theme scheme changes", () => {
    MockWebSocket.instances = [];
    xtermState.instances = [];
    themeScheme.set("dark");
    renderView("s3");
    const xterm = xtermState.instances.at(-1)!;
    expect(xterm.options["theme"]).toMatchObject({ background: "#1e1e2e" });

    act(() => {
      themeScheme.set("light");
    });
    expect(xterm.options["theme"]).toMatchObject({ background: "#eff1f5" });
    themeScheme.set("dark");
  });
});

describe("TerminalPopover", () => {
  afterEach(cleanup);

  it("renders nothing when the store is closed and the tabbed panel when open, animating the collapse", async () => {
    const store = createTerminalStore();
    const { container, rerender } = render(<TerminalPopover sessionId="s1" store={store} />);
    expect(container.querySelector('[data-testid="terminal-popover"]')).toBeNull();
    act(() => {
      store.open();
    });
    rerender(<TerminalPopover sessionId="s1" store={store} />);
    await waitFor(() => {
      expect(container.querySelector('[data-testid="terminal-popover"]')).not.toBeNull();
    });

    // The header close button collapses the panel; the wrapper stays for
    // the transition and then unmounts.
    act(() => {
      const closeButton = container.querySelector(
        '[data-testid="terminal-popover"] button[aria-label="Collapse"]',
      );
      closeButton?.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    });
    expect(container.querySelector('[data-testid="terminal-popover-wrap"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="terminal-popover-wrap"]')?.className).toContain(
      "wrapCollapsed",
    );
    await new Promise((resolve) => setTimeout(resolve, 260));
    rerender(<TerminalPopover sessionId="s1" store={store} />);
    expect(container.querySelector('[data-testid="terminal-popover"]')).toBeNull();
  });

  it("shows the header meta once the host meta frame arrives", () => {
    const store = createTerminalStore();
    store.open();
    const { container, rerender } = render(<TerminalPopover sessionId="s1" store={store} />);
    const socket = MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
    act(() => {
      socket.fireOpen();
      const onmessage = (socket as unknown as { onmessage: ((e: { data: string }) => void) | null })
        .onmessage;
      onmessage?.({
        data: JSON.stringify({ type: "meta", shell: "zsh", cwd: "/srv/a", maxPerSession: 3 }),
      });
    });
    rerender(<TerminalPopover sessionId="s1" store={store} />);
    expect(container.textContent).toContain("zsh");
    expect(container.textContent).toContain("/srv/a");
    store.close();
  });

  it("closing the middle of three tabs leaves the other panes untouched", () => {
    const store = createTerminalStore();
    store.open();
    const first = store.tabs()[0]!.id;
    const second = store.addTab()!;
    const third = store.addTab()!;
    store.activate(second);
    const { container, rerender } = render(<TerminalPopover sessionId="s1" store={store} />);
    rerender(<TerminalPopover sessionId="s1" store={store} />);

    MockWebSocket.frames = [];
    act(() => {
      for (const socket of MockWebSocket.instances) socket.fireOpen();
    });
    MockWebSocket.frames = [];

    const closeSpans = (): HTMLElement[] =>
      [...container.querySelectorAll<HTMLElement>('[role="button"]')].filter(
        (b) => b.getAttribute("aria-label") === "Close terminal",
      );
    act(() => {
      closeSpans()[1]!.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    });
    rerender(<TerminalPopover sessionId="s1" store={store} />);

    // Only the closed tab's close frame is sent: survivors neither close nor
    // park (their sockets keep serving the same ptys).
    expect(store.tabs().map((tab) => tab.id)).toEqual([first, third]);
    expect(store.hasTab(second)).toBe(false);
    expect(store.isOpen()).toBe(true);
    const closeFrames = MockWebSocket.frames.filter((f) => f.includes('"type":"close"'));
    const parkFrames = MockWebSocket.frames.filter((f) => f.includes('"type":"park"'));
    expect(closeFrames).toHaveLength(1);
    expect(parkFrames).toHaveLength(0);
    store.close();
  });

  it("adds and closes tabs through the tab bar and disables + at the cap", () => {
    const store = createTerminalStore();
    store.open();
    store.setMaxPerSession(2);
    const { container, rerender } = render(<TerminalPopover sessionId="s1" store={store} />);
    rerender(<TerminalPopover sessionId="s1" store={store} />);

    const addButton = (): HTMLButtonElement =>
      [...container.querySelectorAll("button")].find(
        (b) => b.getAttribute("aria-label") === "New terminal",
      )!;
    const tabCloseButtons = (): HTMLElement[] =>
      [...container.querySelectorAll<HTMLElement>('[role="button"]')].filter(
        (b) => b.getAttribute("aria-label") === "Close terminal",
      );

    // "+" adds a second tab (third is disabled at maxPerSession=2).
    act(() => {
      addButton().dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    });
    rerender(<TerminalPopover sessionId="s1" store={store} />);
    expect(store.tabs()).toHaveLength(2);
    expect(addButton().disabled).toBe(true);

    // Closing one tab keeps the popover open, re-activates the other, and
    // sends the final close frame for the removed tab's pane (its view
    // unmounts because the tab no longer exists in the store).
    const closed = store.tabs()[0]!.id;
    MockWebSocket.frames = [];
    act(() => {
      for (const socket of MockWebSocket.instances) socket.fireOpen();
    });
    MockWebSocket.frames = [];
    act(() => {
      tabCloseButtons()[0]!.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    });
    rerender(<TerminalPopover sessionId="s1" store={store} />);
    expect(store.tabs()).toHaveLength(1);
    expect(store.hasTab(closed)).toBe(false);
    expect(store.isOpen()).toBe(true);
    expect(MockWebSocket.frames.some((f) => f.includes('"type":"close"'))).toBe(true);
    store.close();
  });
});

/** Keep the shared singleton store closed at the end of every run. */
afterEach(() => {
  terminalStore.close();
});
