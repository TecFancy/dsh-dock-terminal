# dsh-dock-terminal

An **in-place terminal popover** for the [dsh](https://github.com/deepseek-ai/deepseek-harness)
web client, built as a [Feature-Sliced Design](https://feature-sliced.design)
static Cordis plugin. It publishes a `terminal:open` button into the
[dsh-dock-host](../../dsh-dock-host) `dockButtons` registry and mounts the
terminal panel into `conversation.composer.dock` - the band under the
composer card. Clicking the dock button expands the popover; clicking again
(or the close button) collapses it.

The plugin is deliberately **atomic**: it does terminals only. The shell runs
on the dsh host through node-pty; the browser renders it with xterm.js over a
WebSocket bridge.

## Architecture

```
src/
  index.ts                     host root: /dock-terminal/ws upgrade route, config
  config.ts                    config schema (shell, shellArgs, maxPerSession, ...)
  pty.ts                       PtyManager: one node-pty per session/tab key
  terminal-server.ts           wire protocol: transcript replay, frames, trust fence
  client/
    index.tsx                  client root: dock button + composer.dock popover
    shared/config/context.ts   structural contracts (slots, locale, dockButtons)
    features/terminal-popover/
      TerminalPopover.tsx      open/close panel in conversation.composer.dock
      TerminalView.tsx         xterm view + WebSocket connection lifecycle
      popover-store.ts         module-level visibility store (button <-> panel)
      i18n.ts                  en/zh dictionaries for the popover
```

Host and client are physically isolated: host never uses JSX/React, client
never touches `window`/`document` directly (the popover renders through
slots; the terminal needs only its container element).

## Wire protocol

Client opens `wss://<host>/dock-terminal/ws?sessionId=<id>&tab=<tabId>`:

- keyboard input: any text message that is not valid JSON is written to the
  pty stdin;
- control frames: `{"type":"resize","cols":n,"rows":n}` resizes the shell,
  `{"type":"park"}` marks the terminal across a session switch (keeps the
  process alive), `{"type":"close"}` closes it;
- server -> client: raw pty output. A reconnecting socket replays a bounded
  transcript ring before live data.

One pty per `${sessionId}:${tabId}` key survives page refreshes (grace
window `reconnectGraceMs`, default 30 s) and session switches (parked), and
is capped per conversation by `maxPerSession`.

## Install

```sh
npm install @tecfancy/dsh-dock-terminal
dsh plugin --profile web add @tecfancy/dsh-dock-terminal
```

Requires `@deepseek-ai/cordis` `^4.0.1` as a peer dependency and the
`dsh-dock-host` client service `dockButtons` (the popover button is
registered through it).

## Config

| Key               | Default               | Purpose                                    |
| ----------------- | --------------------- | ------------------------------------------ |
| `shell`           | `""` (auto $SHELL)    | Explicit shell binary                      |
| `shellArgs`       | `[]` (`-l` on POSIX)  | Shell startup args (replaces default)      |
| `maxPerSession`   | `2`                   | Concurrent terminals per conversation      |
| `reconnectGraceMs`| `30000`               | Grace before a dropped socket kills its pty|

## Commands

| Task          | Command                                                      |
| ------------- | ------------------------------------------------------------ |
| Install       | `npm install`                                                |
| Type-check    | `npm run type-check`                                         |
| Lint          | `npm run lint` / `npm run lint:no-emdash`                    |
| Format        | `npm run format:check` (fix with `npm run format`)           |
| Test          | `npm run test` / `npm run test:coverage`                     |
| Aliases drift | `npm run aliases:check`                                      |
| Build         | `npm run build` (host tsc + tsdown client bundle)            |
| Bundle verify | `npm run bundle:check`                                       |
| Full gate     | `npm run verify` (must stay green)                           |

## Requirements

- Node >= 22.19.0, npm 10.9+
- `node-pty` prebuilt binaries for the host platform

## License

MIT (c) 2026 TecFancy

> This plugin is scaffolded from the [dsh-plugin-framework](../dsh-plugin-framework)
> template (feature-sliced design + host/client isolation + engineering gates).
