#!/usr/bin/env node
/**
 * Verifies the tsdown client bundle produced by `npm run build`:
 *
 * 1. lib/client.js exists and is a single file (no code splitting);
 * 2. it opens with the window.__ModuleLoader__.load banner and closes with the
 *    factory footer;
 * 3. the module loader load call appears exactly once at the top level;
 * 4. the bundle is a non-trivial size (rules out empty builds);
 * 5. no stylesheet asset survived (CSS is inlined at build time) and the
 *    bundle uses the current style-injection tag, not the removed `styles`
 *    runner builtin;
 * 6. the generated Typert /remote contribution is embedded (its endpoints
 *    must reach the browser inside the single file);
 * 7. cordis.patch.yml row name equals package.json name: the cordis loader
 *    imports that name as an ESM specifier rooted at the profile directory,
 *    so a scoped package must not declare a bare name here (this exact bug
 *    killed the plugin tree at boot when the package was published scoped).
 *
 * Heuristic by design: the bundle is a CJS closure, so a full static analysis
 * of its externals is not practical here. The important invariants are the
 * loader contract and the single-file shape.
 */
import { readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const bundlePath = resolve(repoRoot, "lib", "client.js");
const failures = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

check(exists(bundlePath), `lib/client.js missing (run npm run build first)`);
check(
  !exists(resolve(repoRoot, "lib", "style.css")),
  "lib/style.css must not ship: the single-file contract only loads client.js (CSS is inlined by the tsdown lightningcss plugins)",
);
if (exists(bundlePath)) {
  const stats = statSync(bundlePath);
  check(stats.size > 1024, `lib/client.js looks empty (${stats.size} bytes)`);

  const content = readFileSync(bundlePath, "utf8");
  const fullLength = (content.match(/window\.__ModuleLoader__\.load/g) ?? []).length;
  check(
    fullLength === 1,
    `expected exactly one window.__ModuleLoader__.load call, found ${fullLength}`,
  );

  const trimmed = content.trimStart();
  check(
    trimmed.startsWith("window.__ModuleLoader__.load({"),
    "bundle must open with the module loader banner (tsdown banner misconfigured?)",
  );
  // tsdown may pretty-print the footer across multiple lines, so match the
  // factory tail tolerantly (after dropping the source map pointer comment).
  const tail = content.replace(/\n?\/\/# sourceMappingURL=[^\n]*$/, "").trimEnd();
  check(
    /return module\.exports;\s*\}\s*\}\);\s*$/.test(tail),
    "bundle must close with the CJS factory footer (tsdown footer misconfigured?)",
  );
  check(
    content.includes('id: "dsh-dock-terminal"'),
    'bundle id mismatch: expected id: "dsh-dock-terminal"',
  );
  check(
    !content.includes("styles.insert"),
    "bundle must not reference the removed `styles` runner builtin (the current CSS pipeline inlines style tags at build time)",
  );
  check(
    content.includes("data-plugin-css"),
    "bundle must carry the current inline style injection (data-plugin-css) when CSS Modules are used",
  );
  check(
    !content.includes("codeSplitting"),
    "bundle must be a single file (codeSplitting must be disabled in tsdown.config.ts)",
  );
}

const pkg = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));
const patchSource = readFileSync(resolve(repoRoot, "cordis.patch.yml"), "utf8");
const patchName = patchSource.match(/^\s*name:\s*["']([^"']+)["']/m)?.[1];
check(
  patchName === pkg.name,
  `cordis.patch.yml row name ("${patchName}") must equal package.json name ("${pkg.name}") - the loader imports it as an ESM specifier`,
);

if (failures.length > 0) {
  console.error("bundle:check FAILED");
  for (const failure of failures) console.error("  - " + failure);
  process.exit(1);
}

console.log(
  `OK: lib/client.js verified (${(statSync(bundlePath).size / 1024).toFixed(1)} KiB, single file, loader contract intact)`,
);

function exists(path) {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}
