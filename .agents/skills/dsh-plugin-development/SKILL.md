---
name: dsh-plugin-development
description: Develop, modify, debug, or verify static dsh (DeepSeek Harness) Cordis plugins built on the dsh-dock-terminal scaffold: FSD three-layer host slices, mirrored single-file client bundles, slot registration, host/client RPC, lifecycle and gating rules. Use this skill before adding features, slices, tools, or client UI to a framework-based plugin.
---

# Develop dsh plugins on the dsh-dock-terminal scaffold

This skill covers STATIC npm-package plugins built on this framework. Dynamic
plugins (created at runtime via cordis_define/cordis_run) are plain sandboxed
JavaScript with no build step and are OUT OF SCOPE: they have no tsc/tsdown/npm
concepts, and framework rules do not apply to them. The dynamic evaluators
inject `harness` (host) and `host`/`styles` (client) builtins; static bundles
DO NOT have those - see Runtime services below.

## The two halves

- HOST half: Node ESM compiled by tsc (`src/`, excluding `src/client`). A
  plain Cordis plugin: `name`, `inject`, `Config` (schemastery), `apply(ctx,
config)`. No JSX, ever.
- CLIENT half: `src/client/`, type-checked with its own tsconfig and bundled
  by tsdown into ONE file `lib/client.js` in the
  `window.__ModuleLoader__.load({ id, factory })` CJS closure format. Only
  externals are `react` / `react/jsx-runtime`. No `@deepseek-ai/*` runtime
  imports on the client (types are structural mirrors).

## Layer rules (enforced by ESLint no-restricted-paths)

Host: features > entities > shared. Client mirror: client/features >
client/entities > client/shared. A layer imports only strictly lower layers;
same-layer slices never import each other (merge slices instead). Host and
client never import each other: coupling is limited to type contracts
(`src/client/shared/config/context.ts`) and Typert Remote RPC (host
`TypertRemoteService`, client `ctx.remote.$mount` + the generated `/remote`
contribution; see scripts/generate-typert.mjs). Bars and barrels: every slice exposes index.ts as its
only import surface; imports are relative (host with the `.js` suffix, client
with the `.ts`/`.tsx` suffix); the `client/...` aliases are also wired up if a
plugin prefers them.

## Iron laws

1. Host code never uses JSX/React.
2. Client code never touches window/document directly; styles go through CSS
   Modules (inlined at build time by the lightningcss tsdown plugins) and
   colors come from host theme variables.
3. Every contribution is disposable: use ctx.effect with a disposer-returning
   callback; retain and return disposers from registration APIs. Nothing at
   module scope.
4. Remote payloads are JSON and validated by generated strict codecs; never
   pass functions, elements, classes, or services.

## Runtime services

- Host: cordis services through ctx (`tools`, `apiProxy`, `typertGateway`,
  `settings`, ...). No `harness` builtin.
- Client: cordis services (`slots`, `remote`, `connection`, ...) plus the
  module-table externals (`react`, `react/jsx-runtime`). No `host` or
  `styles` builtin.

## RPC recipe (host <-> client)

1. Host slice: class extends `TypertRemoteService` (service key = wire
   namespace), methods marked with `@Remote("endpoint")`; mount it in the
   host assembly root.
2. Run `npm run generate:typert` (wired into type-check and build): it emits
   `lib/typert.host.js` + `lib/typert.remote-client.js` in the official
   generator format and fails on drift with the source markers.
3. Client: `inject: ["slots", "remote"]`; in the assembly root
   `await ctx.remote.$mount(greetingRemote)`; then call
   `ctx.remote.<namespace>.<method>` from the UI. Results are the Remote
   envelope (`{ ok: true, value } | { ok: false, error }`).## Slots

Query the live slot tree before choosing a target (Slots.listSubTree on the
client, or the official cordis-plugin-development skill). Prefer additive
inner slots (settings.section, sidebar.footer.action, tool.view.*) over
structural ones; replacing an occupant removes its descendants.

## Gating

`npm run verify` runs format:check, lint, lint:no-emdash, slice:check,
aliases:check, lock:check, type-check (host+client), test:coverage (v8, 70%
floor), build, bundle:check. Keep it green. Client UI tests carry a
`// @vitest-environment jsdom` docblock.

This plugin has **no Typert Remote**: host capabilities go through
`ctx.webServer.registerUpgrade` (`/dock-terminal/ws`). Do not add a Remote
unless a feature genuinely needs typed RPC.

## Verification discipline

- Report only commands actually run: smoke-install into a real profile,
  browser-UI and ws-bridge checks are manual verification - say exactly what
  was run, never a blanket "verified". Profile restarts are manual by design
  (they terminate the GUI session).
- Blocked by permissions, registry, sandbox or profile state? Retry as-is and
  escalate before touching logic; gather environment evidence first.
- Tests describe behavior, not correctness: a deliberate behavior change
  updates its tests in the same change and explains why in the PR; never
  weaken assertions to hit the coverage floor.
- Exceptions are signed in place: e.g.
  `// eslint-disable-next-line <rule> -- <reason>` or equivalent, and skipped
  tests / coverage exemptions carry a reason. Review checks that the reason
  stands.

## Workflow

1. Read docs/architecture.md and docs/slice-guide.md first.
2. Create/place code per the decision tree: feature (capability entry point),
   entity (domain state, reused), shared (pure infra), root (one-off wiring).
3. Scaffold with `node scripts/create-slice.mjs --side host|client --layer
features|entities|shared --name <kebab> [--ui] [--segment ...]`.
4. Implement, then verify: npm run type-check && npm run lint && npm run
   test:coverage && npm run verify.
5. Build and smoke-install: npm run build, then
   `dsh plugin --profile web add <spec>` and restart the profile by hand (a
   restart terminates the running GUI session; never trigger it from a
   script). `node scripts/install-to-profile.mjs --copy` remains an
   iteration shortcut for already-link-installed profiles.
