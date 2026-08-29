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

## Branch model

Development happens on `development`; `main` only receives merges from
`development` (squash PRs, one conventional commit per PR, so release-please
emits one CHANGELOG entry per change). CI runs on both branches. Never commit
or push to `main` directly - release-please watches `main` pushes, and
`feat`/`fix` commits there would trigger release PRs before the work is
ready. Always work on `development` unless the user says otherwise.

## Commands

| Task             | Command                                                                     |
| ---------------- | --------------------------------------------------------------------------- |
| Type-check       | `npm run type-check` (host + client tsconfigs)                              |
| Lint             | `npm run lint` / `npm run lint:no-emdash`                                   |
| Format           | `npm run format:check` (fix with `npm run format`)                          |
| Test             | `npm run test` / `npm run test:coverage` (v8, 70% floor)                    |
| Aliases drift    | `npm run aliases:check`                                                     |
| Slice boundaries | `npm run slice:check`                                                       |
| Lockfile hosts   | `npm run lock:check`                                                        |
| Build            | `npm run build` (host tsc, tsdown client bundle, client d.ts)               |
| Bundle contract  | `npm run bundle:check`                                                      |
| Scenario gates   | `npm run gates` (auto-detects the change surface; pre-push runs this)       |
| Full gate        | `npm run verify` (full set - CI and release; not every local run)           |
| New slice        | `node scripts/create-slice.mjs --side host --layer features --name <kebab>` |

## The two iron laws

1. Host code (`src/**` excluding `src/client/**`) never uses JSX/React.
2. Client code (`src/client/**`) never touches `window`/`document` directly.

## Layer rules

- Host: `src/features` > `src/entities` > `src/shared`; client mirrors under
  `src/client/`. A layer imports only lower layers; host and client never
  import each other (eslint no-restricted-paths zones).
- Every slice exposes an `index.ts` barrel as its only import surface;
  same-layer slices never import each other, even through barrels
  (scripts/verify-slice-boundaries.mjs, fail-closed).
- Imports are relative: host with the `.js` suffix, client with the
  `.ts`/`.tsx` suffix. The `client/*` aliases (aliases.json +
  tsconfig.client.json + vitest resolve.alias, checked by
  scripts/check-aliases.mjs) are available if a plugin prefers alias imports.
- Coupling host<->client only via structural type contracts
  (`src/client/shared/config/context.ts`). This plugin has no Typert Remote:
  host capabilities go through `ctx.webServer.registerUpgrade`.

## Conventions

- **No Typert Remote**: this plugin has no host Remote RPC. Host capabilities
  go through `ctx.webServer.registerUpgrade` (the /dock-terminal/ws bridge);
  keep it that way unless a feature genuinely needs typed RPC.
- Config: schemastery schema exported as `Config` from the plugin root
  (`src/shared/config/plugin-config.ts`); deployment overrides live in the
  USER patch layer, never in the bundle patch.
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
  feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert, subject in
  English (commitlint, fails closed), no AI-author trailers (`.husky/commit-msg`
  strips known AI tools; human co-authors are kept).
- **Stage atomically**: one commit = one change, and only its files. Never
  `git add -A` / `git add .` - untracked stray files (logs, tmp dumps,
  screenshots) must not ride along. List the exact paths (`git add src/... README.md`),
  and double-check `git status` before committing.

## Verification discipline

- **Report only commands actually run.** Gates cover the mechanical checks;
  for anything outside them (smoke-install into a real profile, browser UI,
  the ws bridge), say exactly what was run. A bare "verified" without a command
  is a red flag in review.
- **Environment problems get retries before code changes.** Blocked by
  permissions, registry, sandbox or profile state? Retry as-is, escalate
  permissions, and gather evidence first - only then diagnose the logic.
- **Tests describe behavior, not correctness.** When a behavior changes
  deliberately, change its tests with it and say why in the PR; never weaken
  assertions just to satisfy the 70% coverage floor.
- **Every exception is signed.** `eslint-disable`, coverage exemptions and
  skipped tests carry an in-place reason (e.g. `-- reason` on the suppression
  comment). Review checks that the reason stands, not just that one exists.

## Gate coverage map

Every rule above is either enforced by a machine or explicitly relies on
humans — nothing is a deaf "suggestion". Violations fail `npm run verify`,
lint-staged (staged files) and CI.

| Rule                                              | Gate                                   |
| ------------------------------------------------- | -------------------------------------- |
| FSD layer direction; host/client boundary         | eslint no-restricted-paths zones       |
| Iron law 1: no JSX/React in host                  | eslint no-restricted-syntax            |
| Iron law 2: no window/document in client          | eslint no-restricted-globals           |
| Slice barrels; no same-layer slice imports        | scripts/verify-slice-boundaries.mjs    |
| No em-dash in `src/**`                            | scripts/check-no-emdash.mjs            |
| `client/*` aliases in sync                        | scripts/check-aliases.mjs              |
| Lockfile registry hosts                           | scripts/check-lockfile-registry.mjs    |
| Bundle contract                                   | scripts/verify-bundle.mjs              |
| Import suffixes (host `.js`, client `.ts`/`.tsx`) | tsc (NodeNext / Bundler)               |
| Coverage ≥ 70%                                    | vitest v8 thresholds                   |
| Conventional Commits + English subject            | commitlint (`commit-msg`, fail-closed) |
| No AI-author trailers in history                  | `.husky/commit-msg` (auto-strip)       |

Relies on humans (checked in code review, not mechanically enforced):

- Lifecycle: contributions via `ctx.effect` with retained disposers; nothing
  at module scope.
- Static bundles receive cordis services; no `harness`/`host`/`styles`
  builtins.
- Config exported as schemastery `Config` from the plugin root.
- Tests sit next to code; client UI tests carry the jsdom docblock.
- Verification claims: report only commands actually run; environment or
  permission blocks get as-is retry before code changes.
- Tests describe behavior, not correctness; assertion changes are explained
  in the PR.
- Exceptions are signed in place (`eslint-disable` / coverage exemptions /
  skipped tests carry a reason); review checks the reason stands.
- No Typert Remote unless a feature genuinely needs typed RPC.

## Skills

Agent skills live in `.agents/skills/` (single source; dsh discovers them out
of the box, no mirroring). `.agents/skills/dsh-plugin-development/SKILL.md`
is the deep-dive for plugin work.
