import { readFileSync } from "node:fs";

/**
 * Assert every `resolved` URL in package-lock.json points at the public npm
 * registry. Internal-mirror hosts (Nexus) make `npm ci` fail on GitHub-hosted
 * runners, which cannot reach them. Run in CI and as part of `npm run verify`.
 */
const lock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
const packages = lock.packages ?? {};
const bad = [];
for (const [key, entry] of Object.entries(packages)) {
  if (typeof entry?.resolved !== "string") continue;
  let host = entry.resolved;
  try {
    host = new URL(entry.resolved).host;
  } catch {
    // keep the raw string for the report
  }
  if (host !== "registry.npmjs.org") bad.push(`${key} -> ${entry.resolved}`);
}
if (bad.length > 0) {
  console.error(`lockfile references non-public registry hosts (${bad.length}):`);
  for (const line of bad.slice(0, 20)) console.error(`  ${line}`);
  process.exit(1);
}
console.log("lockfile registry hosts OK (all registry.npmjs.org)");
