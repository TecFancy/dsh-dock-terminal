# Agent Instructions

Repo-specific rules for any agent (Claude Code, DeepSeek Harness, Codex, ...)
working _on_ this repository. Auto-discovered from the project root.

## What this repo is

`dsh-dock-terminal` - an **in-place terminal popover** for a dsh (DeepSeek
Harness) web client, built as a Feature-Sliced Design static Cordis plugin.
It publishes a `terminal:open` button into the dsh-dock-host `dockButtons`
registry and mounts the terminal panel into `conversation.composer.dock`
(the band under the composer card). The host half (`src/index.ts`) owns the
node-pty processes and the `/dock-terminal/ws` upgrade route; the client half
renders xterm.js and the popover.

It is an instance of the [dsh-plugin-framework](../dsh-plugin-framework)
scaffold, so the same architecture, layering, and gates apply. The generic
scaffold docs live in that repository (architecture, slice guide, decisions).

## Commands

| Task            | Command                                                                       |
| --------------- | ----------------------------------------------------------------------------- |
| Type-check      | `npm run type-check` (host + client tsconfigs)                                |
| Lint            | `npm run lint` / `npm run lint:no-emdash`                                     |
| Format          | `npm run format:check` (fix with `npm run format`)                            |
| Test            | `npm run test` / `npm run test:coverage` (v8, 70% floor)                      |
| Aliases drift   | `npm run aliases:check`                                                       |
| Build           | `npm run build` (host tsc, tsdown client bundle, client d.ts)                 |
| Bundle contract | `npm run bundle:check`                                                        |
| Skills sync     | `npm run skills:sync` / `npm run skills:check`                                |
| Full gate       | `npm run verify` (must stay green)                                            |
| New slice       | `node scripts/create-slice.mjs --side client --layer features --name <kebab>` |

## The two iron laws

1. Host code (`src/**` excluding `src/client/**`) never uses JSX/React.
2. Client code (`src/client/**`) never touches `window`/`document` directly.

## Layer rules (enforced by ESLint no-restricted-paths)

- Host: `src/features` > `src/entities` > `src/shared`; client mirrors under
  `src/client/`. A layer imports only lower layers; same-layer slices never
  import each other; host and client never import each other.
- Every slice exposes an `index.ts` barrel as its only import surface.
- Imports are relative: host with the `.js` suffix, client with the
  `.ts`/`.tsx` suffix. The `client/*` aliases (aliases.json +
  tsconfig.client.json + vitest resolve.alias, checked by
  scripts/check-aliases.mjs) are available if a plugin prefers alias imports.
- Coupling host<->client only via structural type contracts
  (`src/client/shared/config/context.ts`) and Typert Remote RPC (host
  `TypertRemoteService` + `@Remote`, generated `lib/typert.*` artifacts,
  client `ctx.remote.$mount`), payloads validated by strict codecs.

## Conventions

- **No Typert Remote**: this plugin has no host Remote RPC. Host capabilities
  go through `ctx.webServer.registerUpgrade` (the /dock-terminal/ws bridge);
  keep it that way unless a feature genuinely needs typed RPC.
- Lifecycle: every contribution goes through `ctx.effect` with retained
  disposers; nothing at module scope.
- Tests sit next to code (`<file>.test.ts`); client UI tests carry a
  `// @vitest-environment jsdom` docblock and use explicit vitest imports.
- Static bundles receive cordis services on both halves (`tools`,
  `typertGateway`, `slots`, `remote`, `connection`, ...); there are NO
  `harness`/`host`/`styles` builtins for static bundles - those exist only in
  the dynamic plugin evaluators.
- No em-dash characters in `src/**` (scripts/check-no-emdash.mjs).
- Commit messages: Conventional Commits, types
  feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert (commitlint),
  subject in English, no AI-author trailers.

## Skills

Agent skills live in `skills/` (source of truth) and are mirrored to
`.claude/skills/` and `.opencode/skills/` by `npm run skills:sync`.
`skills/dsh-plugin-development/SKILL.md` is the deep-dive for plugin work.
