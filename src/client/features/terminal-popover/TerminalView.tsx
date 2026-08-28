import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef, useState } from "react";
import { t } from "./i18n.ts";
import { terminalStore, type TerminalStore } from "./terminal-store.ts";
import styles from "./terminal.module.css";

/** Host metadata frame content (sent first on every attach). */
export interface TerminalMeta {
  shell: string;
  cwd: string;
  maxPerSession: number;
}

export interface TerminalViewProps {
  sessionId?: string | undefined;
  /** The store-owned tab id; the host keys its pty on `${sessionId}:${tabId}`. */
  tabId: string;
  /** Receives the host meta frame (shell/cwd/cap) for the popover header. */
  onMeta?: (meta: TerminalMeta) => void;
  /** Injectable for tests; defaults to the module-level shared store. */
  store?: TerminalStore;
}

/**
 * One xterm view bound to the host pty bridge.
 *
 * The WebSocket uses a relative URL (same origin as the page, resolved by the
 * browser); the host keeps the pty alive across a session switch (the view
 * sends a park frame) and across page refreshes (grace window). The wire
 * frame on teardown is decided from the store: a tab that still exists and
 * the popover that is still open mean a switch (park); anything else means a
 * close (kill).
 */
export function TerminalView({ sessionId, tabId, onMeta, store }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const mountedRef = useRef(true);
  const closedRef = useRef(false);
  const [phase, setPhase] = useState<"connecting" | "open" | "failed">("connecting");
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // When this tab is removed from the store, its pane unmounts next render.
  // Send the final close frame HERE (the socket is still fully open) instead
  // of relying on the cleanup below: a synchronous send-then-close race in
  // the browser's WebSocket may drop the frame, and the host would only
  // reclaim the pty after the reconnect grace window.
  useEffect(() => {
    const viewStore = store ?? terminalStore;
    const unsubscribe = viewStore.subscribe(() => {
      if (closedRef.current) return;
      if (!viewStore.hasTab(tabId) && viewStore.isOpen()) {
        const ws = wsRef.current;
        if (ws !== null && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "close" }));
          closedRef.current = true;
        }
      }
    });
    return unsubscribe;
  }, [tabId, store]);

  // One xterm instance per view lifetime.
  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    const term = new Terminal({
      convertEol: false,
      cursorBlink: true,
      fontSize: 13,
      // Nerd Font first so posh-mocha style prompts (oh-my-posh, eza icons)
      // align; the CSS stack falls back per installed family, so machines
      // without a Nerd Font keep working with a system monospace.
      fontFamily:
        "'Maple Mono NF CN', 'CaskaydiaCove NFM', 'CaskaydiaCove Nerd Font', 'JetBrainsMono Nerd Font', 'Cascadia Code', 'Consolas', 'SFMono-Regular', 'Liberation Mono', Menlo, monospace",
      scrollback: 5000,
      // Catppuccin Mocha, the same palette as the posh-mocha kit, so ANSI
      // colors in pwsh (PSReadLine, eza, oh-my-posh) match Windows Terminal.
      theme: Object.freeze({
        background: "#1e1e2e",
        foreground: "#cdd6f4",
        cursor: "#f5e0dc",
        selectionBackground: "#585b70",
        black: "#45475a",
        red: "#f38ba8",
        green: "#a6e3a1",
        yellow: "#f9e2af",
        blue: "#89b4fa",
        magenta: "#f5c2e7",
        cyan: "#94e2d5",
        white: "#bac2de",
        brightBlack: "#585b70",
        brightRed: "#f38ba8",
        brightGreen: "#a6e3a1",
        brightYellow: "#f9e2af",
        brightBlue: "#89b4fa",
        brightMagenta: "#f5c2e7",
        brightCyan: "#94e2d5",
        brightWhite: "#a6adc8",
      }),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    const fitNow = () => {
      try {
        fit.fit();
      } catch {
        // The container may be hidden during a layout pass; retry on next tick.
      }
    };
    fitNow();
    // Re-measure when the popover goes from hidden to visible (a layout
    // change), then keep the pty dimensions in sync with the viewport.
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => fitNow());
    observer?.observe(container);
    term.onData((data) => {
      wsRef.current?.send(data);
    });
    term.onResize(({ cols, rows }) => {
      const ws = wsRef.current;
      if (ws !== null && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols, rows }));
      }
    });
    setTimeout(fitNow, 0);
    termRef.current = term;
    return () => {
      mountedRef.current = false;
      observer?.disconnect();
      // The WebSocket lifecycle belongs to the connect effect below: its
      // cleanup decides the wire frame (park on a session switch while the
      // popover stays open, close when the popover collapses). Sending any
      // frame here would race that cleanup - React runs this mount cleanup
      // FIRST, so a close frame sent from here always wins and kills a pty
      // that should have been parked.
      term.dispose();
      termRef.current = null;
    };
  }, []);

  // Connect (or re-connect to) the terminal of the current session. `attempt`
  // re-runs this effect when the user clicks "retry" after a failed attach.
  useEffect(() => {
    const viewStore = store ?? terminalStore;
    const term = termRef.current;
    if (term === null || sessionId === undefined) return;
    const ws = new WebSocket(
      `/dock-terminal/ws?sessionId=${encodeURIComponent(sessionId)}&tab=${encodeURIComponent(tabId)}`,
    );
    wsRef.current = ws;
    setPhase("connecting");
    setError(null);
    let opened = false;
    ws.onopen = () => {
      if (!mountedRef.current) return;
      opened = true;
      setPhase("open");
      // Sync the xterm size with the pty after (re)connect.
      const { cols, rows } = term;
      ws.send(JSON.stringify({ type: "resize", cols, rows }));
    };
    ws.onmessage = (event) => {
      if (typeof event.data !== "string") return;
      let meta: TerminalMeta | null = null;
      try {
        const parsed: unknown = JSON.parse(event.data);
        if (
          parsed !== null &&
          typeof parsed === "object" &&
          (parsed as Record<string, unknown>)["type"] === "meta"
        ) {
          meta = parsed as TerminalMeta;
        }
      } catch {
        // Not a control frame: it is raw pty output.
      }
      if (meta !== null) {
        viewStore.setMaxPerSession(meta.maxPerSession);
        onMeta?.(meta);
      } else {
        term.write(event.data);
      }
    };
    ws.onclose = (event) => {
      if (!mountedRef.current) return;
      if (!opened && event.code === 1011) {
        setPhase("failed");
        setError(event.reason || t("unavailable"));
      } else if (!opened) {
        setPhase("failed");
        setError(event.reason || "connection closed");
      } else {
        setPhase("connecting");
      }
    };
    ws.onerror = () => {
      if (!mountedRef.current) return;
    };
    return () => {
      // The store-subscription effect above already sent the final close
      // frame when this tab was removed; only close the socket then. For a
      // session/tab switch (park frame) give the frame a beat to leave the
      // browser queue before closing: a synchronous close() may race the
      // outbound frame and the host would fall back to the grace window.
      if (ws.readyState !== WebSocket.OPEN) {
        wsRef.current = null;
        ws.close();
        return;
      }
      if (closedRef.current) {
        wsRef.current = null;
        ws.close();
        return;
      }
      const stillOpen = viewStore.isOpen() && viewStore.hasTab(tabId);
      ws.send(JSON.stringify({ type: stillOpen ? "park" : "close" }));
      wsRef.current = null;
      setTimeout(() => ws.close(), 50);
    };
    // onMeta is the popover's stable setState; attempt drives the retry button.
  }, [sessionId, tabId, attempt, onMeta, store]);

  return (
    <div className={styles["terminal"]}>
      {phase === "failed" ? (
        <div className={styles["fallback"]}>
          <div className={styles["fallbackText"]}>{error ?? t("unavailable")}</div>
          <div className={styles["fallbackHint"]}>{t("repairHint")}</div>
          <button
            type="button"
            className={styles["retry"]}
            onClick={() => setAttempt((v) => v + 1)}
          >
            {t("retry")}
          </button>
        </div>
      ) : null}
      <div ref={containerRef} className={styles["host"]} />
    </div>
  );
}
