#!/usr/bin/env node
/**
 * Mirrors skills/ (source of truth) into per-agent skill directories:
 *   .claude/skills/ and .opencode/skills/
 * Run `npm run skills:sync` to sync, `npm run skills:check` to verify drift.
 * The TARGETS map is intentionally extensible: add another agent directory
 * here instead of hand-maintaining it.
 *
 * Drift detection is per-file byte comparison: a file is out of sync if it is
 * missing in a target, stale (present in a target but not in skills/), or
 * byte-different from the source.
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const TARGETS = [
  { name: "claude", dir: ".claude/skills" },
  { name: "opencode", dir: ".opencode/skills" },
];

const checkMode = process.argv.includes("--check");
const srcDir = join(repoRoot, "skills");

function collectFiles(dir, base = dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectFiles(full, base));
    } else {
      // relative() is cross-platform; a hard-coded separator here breaks on
      // POSIX (CI) and would make sync delete the mirror files.
      out.push({ relative: relative(base, full), full });
    }
  }
  return out;
}

const drift = [];
for (const target of TARGETS) {
  const targetDir = join(repoRoot, target.dir);
  const targetFiles = collectFiles(targetDir, targetDir);
  const srcFiles = collectFiles(srcDir, srcDir);

  // Files present in target but missing in source (stale copies)
  for (const file of targetFiles) {
    const srcPath = join(srcDir, file.relative);
    if (!existsSync(srcPath)) {
      if (checkMode) drift.push(`${target.name}: stale file ${file.relative}`);
      else rmSync(file.full, { force: true });
    }
  }

  // Files to (re)write
  for (const file of srcFiles) {
    const dest = join(targetDir, file.relative);
    const content = readFileSync(file.full, "utf8");
    if (existsSync(dest) && readFileSync(dest, "utf8") === content) continue;
    if (checkMode) {
      drift.push(`${target.name}: out of sync ${file.relative}`);
    } else {
      mkdirSync(dirname(dest), { recursive: true });
      cpSync(file.full, dest);
    }
  }
}

if (checkMode) {
  if (drift.length > 0) {
    console.error("skills:check FAILED (run npm run skills:sync)");
    for (const line of drift) console.error("  " + line);
    process.exit(1);
  }
  console.log(`OK: skills synced to ${TARGETS.length} targets`);
  process.exit(0);
}

console.log(`skills synced to ${TARGETS.length} targets`);
