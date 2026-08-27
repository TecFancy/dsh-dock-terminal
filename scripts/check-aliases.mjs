#!/usr/bin/env node
/**
 * Validates that the client-side path aliases are consistent across the three
 * places that define them:
 *
 *   - aliases.json                        (single source of truth)
 *   - tsconfig.client.json paths          (type checking)
 *   - vitest.config.ts resolve.alias      (test imports)
 *
 * Design note: the HOST side intentionally does NOT use path aliases. Host
 * code is emitted by tsc as Node ESM, and tsc does not rewrite path-mapped
 * specifiers at emit time, so an alias import would break at runtime unless it
 * carries an explicit .js suffix on every use. Relative imports with .js
 * suffixes are short at plugin depth and always runtime-correct. aliases.json
 * therefore only covers client/ keys. See docs/decisions.md.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import stripJsonComments from "strip-json-comments";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

function readJson(relativePath) {
  return JSON.parse(stripJsonComments(readFileSync(resolve(repoRoot, relativePath), "utf8")));
}

const aliases = readJson("aliases.json");
const clientTsconfig = readJson("tsconfig.client.json");

/**
 * Extract the resolve.alias target for an alias key from vitest.config.ts.
 *
 * CAUTION: this regex depends on the exact spelling used in vitest.config.ts
 * (`"client/...": fileURLToPath(new URL("./src/client/..."))`). If that file
 * changes spelling (single quotes, a helper, a different URL form), update
 * this regex too - it fails closed (blocks CI) rather than passing silently.
 */
function readVitestAlias() {
  const source = readFileSync(resolve(repoRoot, "vitest.config.ts"), "utf8");
  const out = {};
  for (const key of Object.keys(aliases)) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = source.match(
      new RegExp(
        `["']${escaped}["']\\s*:\\s*fileURLToPath\\(new URL\\(["'](\\./src/client/[^"']+)`,
      ),
    );
    // Preserve the alias as resolved path WITHOUT the "./" prefix for
    // comparison with aliases.json values.
    out[key] = match ? match[1].replace(/^\.\//, "") : undefined;
  }
  return out;
}

const failures = [];

// 1. tsconfig.client.json paths vs aliases.json
const declaredPaths = clientTsconfig.compilerOptions?.paths ?? {};
const clientKeys = Object.keys(aliases).filter((key) => key.startsWith("client/"));

// tsconfig path keys carry the "/*" pattern suffix; normalize for comparison.
const declared = Object.fromEntries(
  Object.entries(declaredPaths).map(([key, value]) => [key.replace(/\/\*$/, ""), value]),
);

const missing = clientKeys.filter((key) => !(key in declared));
const extra = Object.keys(declared).filter((key) => !clientKeys.includes(key));
const mismatched = clientKeys.filter((key) => {
  const expected = ["./" + aliases[key].replace(/^\.?\//, "") + "/*"];
  const actual = declared[key];
  return !Array.isArray(actual) || JSON.stringify(actual) !== JSON.stringify(expected);
});
if (missing.length > 0) failures.push(`tsconfig.client.json missing: ${missing.join(", ")}`);
if (extra.length > 0) failures.push(`tsconfig.client.json extra: ${extra.join(", ")}`);
for (const key of mismatched) {
  failures.push(`tsconfig.client.json mismatch "${key}": expected ./${aliases[key]}/*`);
}

// 2. vitest.config.ts resolve.alias vs aliases.json
const vitestAliases = readVitestAlias();
const vitestMissing = clientKeys.filter((key) => vitestAliases[key] === undefined);
const vitestMismatched = clientKeys.filter((key) => {
  const expected = aliases[key].replace(/^\.?\//, "");
  return vitestAliases[key] !== undefined && vitestAliases[key] !== expected;
});
if (vitestMissing.length > 0)
  failures.push(`vitest.config.ts missing: ${vitestMissing.join(", ")}`);
for (const key of vitestMismatched) {
  failures.push(`vitest.config.ts mismatch "${key}": expected ${aliases[key]}`);
}

if (failures.length === 0) {
  console.log("OK: aliases consistent across aliases.json, tsconfig.client.json, vitest.config.ts");
  process.exit(0);
}

console.error("FAIL: alias drift detected");
for (const failure of failures) console.error("  - " + failure);
console.error(
  "  aliases.json is the single source of truth; sync tsconfig.client.json paths and vitest.config.ts resolve.alias.",
);
process.exit(1);
