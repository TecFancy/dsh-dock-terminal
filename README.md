# dsh-dock-terminal

An **in-place terminal popover** for the [dsh](https://github.com/deepseek-ai/deepseek-harness)
web client, built as a [Feature-Sliced Design](https://feature-sliced.design)
static Cordis plugin. It publishes a `terminal:open` button into the
[dsh-dock-host](../../dsh-dock-host) `dockButtons` registry and mounts the
terminal panel into `conversation.composer.dock` - the band under the
composer card. Clicking the dock button expands the popover; clicking again
(or the close button) collapses it while the shells keep running (the tab ×
closes a shell for real). The popover hosts **one terminal per tab**
(capped per conversation; the default cap is 3 tabs, configurable through
`maxPerSession`, 0 for unlimited),
with a tab bar to open, switch and close shells.

The plugin is deliberately **atomic**: it does terminals only. The shell runs
on the dsh host through node-pty; the browser renders it with xterm.js over a
WebSocket bridge.

## Architecture

```
src/
  index.ts                     host root: /dock-terminal/ws upgrade, session/disposed, tools
  shared/config/               Config schema (shell, shellArgs, maxPerSession, ...)
  features/pty-bridge/         PtyManager + /dock-terminal/ws wire protocol
  features/agent-terminal/     optional model terminal tools (official seam)
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
  `{"type":"park"}` marks the terminal across a session switch, tab switch
  or popover collapse (keeps the process alive), `{"type":"close"}` closes
  it;
- server -> client: first a `{"type":"meta","shell":...,"cwd":...,"maxPerSession":n}`
  frame, then raw pty output. A reconnecting socket replays a bounded
  transcript ring before live data.

One pty per `${sessionId}:${tabId}` key survives page refreshes (grace
window `reconnectGraceMs`, default 30 s) and session switches (parked); the
default `maxPerSession` of 3 caps the concurrent terminals per conversation
(0 disables the cap), and a conversation is closed immediately when it is
disposed. The panel is sized by its dock band, so side panels (e.g. a right
sidebar) never cover terminal output.

## Install

```sh
npm install @tecfancy/dsh-dock-terminal
dsh plugin --profile web add @tecfancy/dsh-dock-terminal
```

> **pnpm 11 原生构建批准（首个安装必做）**：`node-pty`（宿主 shell 桥）的
> install script 需要显式批准，否则 `dsh plugin add` 报
> `[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: node-pty@1.1.0`。
> 在 profile 目录（如 `$DSH_HOME/profiles/web`）的 `pnpm-workspace.yaml` 末尾加：
>
> ```yaml
> allowBuilds:
>   node-pty: true
> ```
>
> 或在该目录跑一次交互式 `pnpm approve-builds`（选中 node-pty）后再重跑
> `dsh plugin --profile web add @tecfancy/dsh-dock-terminal`。
> Windows 新机器上 profile 由官方模板初始化（模板不含 allowBuilds），必踩此步。

### Default shell and look (Windows)

On Windows the default shell chain is **PowerShell 7** (`pwsh` found on
`PATH` first, then the official/winget install, the preview channel, the
per-user MSI/portable layouts and the Store alias), then Windows PowerShell
5.1, and only when neither exists does it fall back to `cmd.exe`. On POSIX
it is `$SHELL`, then the account login shell from passwd (service managers
often start dsh without `$SHELL`), then `/bin/bash`. That ordering matters
for posh-mocha style setups: oh-my-posh and the profile customizations live
under the pwsh 7 `$PROFILE` path, so spawning `cmd.exe` (or 5.1) starts with
none of the prompt, font or color customization.

The popover terminal renders with a Nerd Font stack
(`Maple Mono NF CN` → `CaskaydiaCove NFM` → JetBrainsMono Nerd Font → system
monospace, dropping whichever family is not installed) and the
**Catppuccin Mocha** 16-color palette, matching the posh-mocha kit so
oh-my-posh prompts, PSReadLine colors and eza icons look identical to
Windows Terminal. To force another shell, configure it explicitly:

```yaml
config:
  shell: C:\Program Files\Git\bin\bash.exe
```

No `shellArgs` needed for explicit shells: the plugin only adds `-NoLogo`
when the resolved shell is PowerShell, and `-l` on POSIX.

### Theme, icon and motion

The popover shell follows the dsh theme tokens (`--dsw-alias-bg-layer-1`,
`--dsw-alias-label-primary`, `--dsw-alias-border-l1`, `--dsw-shadow-lv2`), so
it matches the composer card in both light and dark themes. The xterm surface
follows the active theme scheme through the client `theme` service
(`theme/change`): **Catppuccin Mocha** in dark mode (matching the posh-mocha
kit) and **Catppuccin Latte** in light mode, so the terminal is never a dark
box floating in a light UI. The panel fills the whole composer dock band (the
app layout keeps the band inside the visible content column, so right-side
panels never cover it and terminal output gets the full width). Expand rises
from below and collapse sinks downward (grid rows + opacity + a vertical slide
over 200 ms, honoring `prefers-reduced-motion`). The dock button carries an
inline SVG terminal glyph and the label `Terminal`/`终端`; rendering the SVG
glyph requires **dsh-dock-host >= 0.2.1** (older hosts show it as a text
prefix).

Collapse keeps the ptys running: the popover × only hides the panel (each
tab sends a `park` frame), so a build or long command keeps executing and
reopening resumes the same tab with its scrollback. The tab × is the real
teardown (kills that pty).

Requires `@deepseek-ai/cordis` `^4.0.1` as a peer dependency and the
`dsh-dock-host` (>= 0.2.1) client service `dockButtons` (the popover button
is registered through it).

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

| Key                | Default                                                           | Purpose                                                |
| ------------------ | ----------------------------------------------------------------- | ------------------------------------------------------ |
| `shell`            | `""` (auto: $SHELL on POSIX, PowerShell 7 > 5.1 > cmd on Windows) | Explicit shell binary                                  |
| `shellArgs`        | `[]` (`-l` POSIX, `-NoLogo` for PowerShell)                       | Shell startup args (replaces default)                  |
| `maxPerSession`    | `3` (a 4th tab shows the cap banner)                              | Concurrent terminals per conversation; `0` = unlimited |
| `reconnectGraceMs` | `30000`                                                           | Grace before a dropped socket kills its pty            |

## Release flow (test from the repo before publishing)

Publishing is **tag-triggered** (`.github/workflows/publish.yml` pushes `v*`
tags to npm after the CI gate). Nothing on `main` is published by a push, so
the safe order is:

1. `git push origin main` - the code, not a release;
2. install the branch into a test profile and verify:
   `dsh plugin --profile web-test add -w "github:TecFancy/dsh-dock-terminal#main"`,
   restart the test instance and run the end-to-end checks;
3. only once the checks pass, tag and publish:
   `git tag v0.5.0 && git push origin v0.5.0` (the tag must equal `package.json`'s version);
4. after the publish lands, point the test profile back at the registry version.

This keeps a broken build from ever reaching npm: a npm version exists only
after the tag, so `latest` always refers to a verified release.

## Commands

| Task             | Command                                            |
| ---------------- | -------------------------------------------------- |
| Install          | `npm install`                                      |
| Type-check       | `npm run type-check`                               |
| Lint             | `npm run lint` / `npm run lint:no-emdash`          |
| Format           | `npm run format:check` (fix with `npm run format`) |
| Test             | `npm run test` / `npm run test:coverage`           |
| Aliases drift    | `npm run aliases:check`                            |
| Slice boundaries | `npm run slice:check`                              |
| Lockfile hosts   | `npm run lock:check`                               |
| Build            | `npm run build` (host tsc + tsdown client bundle)  |
| Bundle verify    | `npm run bundle:check`                             |
| Full gate        | `npm run verify` (must stay green)                 |

## Requirements

- Node >= 22.19.0, npm 10.9+
- `node-pty` prebuilt binaries for the host platform

## License

MIT (c) 2026 TecFancy

> This plugin is scaffolded from the [dsh-plugin-framework](../dsh-plugin-framework)
> template (feature-sliced design + host/client isolation + engineering gates).
