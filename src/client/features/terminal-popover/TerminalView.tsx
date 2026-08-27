import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef, useState } from "react";
import { t } from "./i18n.ts";
import styles from "./terminal.module.css";

/**
 * One xterm view bound to the host pty bridge.
 *
 * The WebSocket uses a relative URL (same origin as the page, resolved by the
 * browser); the host keeps the pty alive across a session switch (the view
 * sends a park frame) and across page refreshes (grace window).
 */
export function TerminalView({ sessionId }: { sessionId?: string | undefined }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const tabRef = useRef<string>(createTabId());
  const mountedRef = useRef(true);
  const [phase, setPhase] = useState<"connecting" | "open" | "failed">("connecting");
  const [error, setError] = useState<string | null>(null);

  // One xterm instance per view lifetime.
  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    const term = new Terminal({
      convertEol: false,
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace",
      scrollback: 5000,
      theme: Object.freeze({ background: "#16171d", foreground: "#e6e6e6" }),
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
      const ws = wsRef.current;
      if (ws !== null && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "close" }));
        ws.close();
      }
      wsRef.current = null;
      term.dispose();
      termRef.current = null;
    };
  }, []);

  // Connect (or re-connect to) the terminal of the current session.
  useEffect(() => {
    const term = termRef.current;
    if (term === null || sessionId === undefined) return;
    const ws = new WebSocket(
      `/dock-terminal/ws?sessionId=${encodeURIComponent(sessionId)}&tab=${encodeURIComponent(tabRef.current)}`,
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
      if (typeof event.data === "string") term.write(event.data);
    };
    ws.onclose = (event) => {
      if (!mountedRef.current) return;
      if (!opened && event.code === 1011) {
        setPhase("failed");
        setError(event.reason || "terminal unavailable");
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
      wsRef.current = null;
      ws.close();
    };
  }, [sessionId]);

  return (
    <div className={styles["terminal"]}>
      {phase === "failed" ? (
        <div className={styles["fallback"]}>{error ?? t("placeholder")}</div>
      ) : null}
      <div ref={containerRef} className={styles["host"]} />
    </div>
  );
}

/** Per-view tab id, stable across reconnects and session switches. */
function createTabId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
