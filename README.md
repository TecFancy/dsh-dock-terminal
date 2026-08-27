# dsh-dock-terminal

An **in-place terminal popover** for the [dsh](https://github.com/deepseek-ai/deepseek-harness)
web client, built as a [Feature-Sliced Design](https://feature-sliced.design)
static Cordis plugin. It publishes a `terminal:open` button into the
[dsh-dock-host](../../dsh-dock-host) `dockButtons` registry and mounts the
terminal panel into `conversation.composer.dock` - the band under the
composer card. Clicking the dock button expands the popover; clicking again
(or the close button) collapses it. The popover hosts **one terminal per tab**
(bounded by `maxPerSession`), with a tab bar to open, switch and close shells.

The plugin is deliberately **atomic**: it does terminals only. The shell runs
on the dsh host through node-pty; the browser renders it with xterm.js over a
WebSocket bridge.

## Architecture

```
src/
  index.ts                     host root: /dock-terminal/ws upgrade route, config
  config.ts                    config schema (shell, shellArgs, maxPerSession, ...)
  pty.ts                       PtyManager: one node-pty per session/tab key
  terminal-server.ts           wire protocol: meta frame, transcript replay, trust fence
  client/
    index.tsx                  client root: dock button + composer.dock popover
    shared/config/context.ts   structural contracts (slots, locale, dockButtons)
    features/terminal-popover/
      TerminalPopover.tsx      tabbed panel in conversation.composer.dock
      TerminalView.tsx         xterm view + WebSocket connection lifecycle
      terminal-store.ts        module-level store: visibility + terminal tabs
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
  `{"type":"park"}` marks the terminal across a session switch or tab switch
  (keeps the process alive), `{"type":"close"}` closes it;
- server -> client: first a `{"type":"meta","shell":...,"cwd":...,"maxPerSession":n}`
  frame, then raw pty output. A reconnecting socket replays a bounded
  transcript ring before live data.

One pty per `${sessionId}:${tabId}` key survives page refreshes (grace
window `reconnectGraceMs`, default 30 s) and session switches (parked), is
capped per conversation by `maxPerSession`, and is closed immediately when
its conversation is disposed.

## Install

```sh
npm install @tecfancy/dsh-dock-terminal
dsh plugin --profile web add @tecfancy/dsh-dock-terminal
```

Requires `@deepseek-ai/cordis` `^4.0.1` as a peer dependency and the
`dsh-dock-host` client service `dockButtons` (the popover button is
registered through it).

## Model terminal tools (optional)

The host half also registers six model-facing tools — `terminal_create`,
`terminal_send`, `terminal_read`, `terminal_list`, `terminal_signal`,
`terminal_close` — so an agent can open a persistent interactive shell, run
commands, read bounded scrollback pages and close it. They ride the official
`@deepseek-ai/dsh-terminal` seam: the profile must mount `terminal` and
`terminal-bash` rows (an `insert` patch; no npm install needed, the packages
resolve from the dsh global node_modules). Without the seam the plugin keeps
working for the UI popover and simply skips the tool set.

## Config

| Key                | Default              | Purpose                                     |
| ------------------ | -------------------- | ------------------------------------------- |
| `shell`            | `""` (auto $SHELL)   | Explicit shell binary                       |
| `shellArgs`        | `[]` (`-l` on POSIX) | Shell startup args (replaces default)       |
| `maxPerSession`    | `2`                  | Concurrent terminals per conversation       |
| `reconnectGraceMs` | `30000`              | Grace before a dropped socket kills its pty |

## Commands

| Task          | Command                                            |
| ------------- | -------------------------------------------------- |
| Install       | `npm install`                                      |
| Type-check    | `npm run type-check`                               |
| Lint          | `npm run lint` / `npm run lint:no-emdash`          |
| Format        | `npm run format:check` (fix with `npm run format`) |
| Test          | `npm run test` / `npm run test:coverage`           |
| Aliases drift | `npm run aliases:check`                            |
| Build         | `npm run build` (host tsc + tsdown client bundle)  |
| Bundle verify | `npm run bundle:check`                             |
| Full gate     | `npm run verify` (must stay green)                 |

## Requirements

- Node >= 22.19.0, npm 10.9+
- `node-pty` prebuilt binaries for the host platform

## License

MIT (c) 2026 TecFancy

> This plugin is scaffolded from the [dsh-plugin-framework](../dsh-plugin-framework)
> template (feature-sliced design + host/client isolation + engineering gates).
