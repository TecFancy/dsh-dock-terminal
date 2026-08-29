#!/usr/bin/env node
// Verifies the FSD slice barrier convention (M2 gate):
// - every slice (features/<name>, entities/<name>, shared/<module>, and their
//   client mirrors) exposes an index.ts/index.tsx barrel as its only import
//   surface for outside code: deep imports into a slice are rejected
// - same-layer slices never import each other, even through barrels
// - the plugin roots (src/index.ts, src/client/index.tsx) also enter slices
//   only through their barrels
// Fail-closed: an import that cannot be resolved fails instead of passing.

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, dirname, relative, basename, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC_DIR = join(ROOT, "src");
const LAYERS = ["features", "entities"];
const ALIAS_PREFIXES = ["client/features", "client/entities", "client/shared"];
const CODE_EXT = /\.(ts|tsx|js)$/;

// path.relative/join return backslash paths on Windows; every path this
// script reasons about is normalized to forward slashes (fs accepts both).
const toPosix = (p) => p.split(sep).join("/");

const errors = [];

function collectTsFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      collectTsFiles(full, out);
      continue;
    }
    if (CODE_EXT.test(name) && !name.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

// FSD area of a repo-relative path. A slice is identified by its barrel: the
// nearest ancestor directory (from the file up) that contains index.ts /
// index.tsx. So features/hello-settings, entities/greeting, shared/config,
// shared/lib/logger and shared/ui/button are all slices. Files directly under
// src/ or src/client/ are composition roots, not slices.
function sliceOf(relPath) {
  relPath = toPosix(relPath);
  const parts = relPath.split("/");
  if (parts[0] !== "src") return null;
  const isClient = parts[1] === "client";
  if (isClient && parts.length < 4) return { layer: "root", name: null };
  if (!isClient && parts.length < 3) return { layer: "root", name: null };
  const layerPart = isClient ? parts[2] : parts[1]; // features | entities | shared
  const layer = isClient ? `client-${layerPart}` : layerPart;
  if (!LAYERS.includes(layerPart) && layerPart !== "shared") return null;
  let dir = dirname(relPath);
  while (dir !== "src" && dir !== "src/client") {
    if (existsSync(join(ROOT, dir, "index.ts")) || existsSync(join(ROOT, dir, "index.tsx"))) {
      return { layer, name: basename(dir), dir };
    }
    dir = dirname(dir);
  }
  errors.push(`${relPath}: 位于 ${layerPart}/ 层但没有可用的 index.ts/index.tsx barrel`);
  return null;
}

// Resolve an import specifier to a repo-relative target path. Returns:
// - "skip" for bare package imports and non-code resources (css modules)
// - null    when the target cannot be resolved (fail-closed)
// - the resolved relative path otherwise
function resolveTarget(parentRel, spec) {
  let rel;
  const alias = ALIAS_PREFIXES.find((p) => spec.startsWith(`${p}/`));
  if (alias) {
    rel = `src/${spec}`;
  } else if (spec.startsWith("./") || spec.startsWith("../")) {
    rel = join(dirname(parentRel), spec);
  } else {
    return "skip"; // bare package import
  }
  const ext = /\.([a-z0-9]+)$/i.exec(rel)?.[1];
  if (ext && !["ts", "tsx", "js"].includes(ext)) return "skip"; // asset / css module
  const candidates = [];
  if (ext) {
    if (ext === "js") {
      candidates.push(rel.replace(/\.js$/, ".ts"), rel.replace(/\.js$/, ".tsx"), rel);
    } else {
      candidates.push(rel);
    }
  } else {
    candidates.push(
      `${rel}.ts`,
      `${rel}.tsx`,
      `${rel}.js`,
      join(rel, "index.ts"),
      join(rel, "index.tsx"),
      join(rel, "index.js"),
    );
  }
  for (const candidate of candidates) {
    const abs = join(ROOT, candidate);
    if (existsSync(abs) && statSync(abs).isFile()) return toPosix(candidate);
  }
  return null;
}

function lineOf(code, index) {
  return code.slice(0, index).split("\n").length;
}

function checkImport(parentRel, spec, target, code, index) {
  const parent = sliceOf(parentRel);
  const via = sliceOf(target);
  if (!parent || !via) {
    errors.push(
      `${parentRel}:${lineOf(code, index)}: 导入 "${spec}" 落在 FSD 区域之外（fail-closed）`,
    );
    return;
  }
  const isBarrel = /^index\.(ts|tsx)$/.test(basename(target));
  const sameSlice = parent.name !== null && parent.name === via.name && parent.layer === via.layer;
  if (sameSlice) return; // deep imports within a slice are free
  if (parent.name !== null && via.name !== null) {
    if (parent.layer === via.layer) {
      errors.push(
        `${parentRel}:${lineOf(code, index)}: 同层 slice 不允许互相导入（${via.dir}/），即使走 barrel`,
      );
    } else if (!isBarrel) {
      errors.push(
        `${parentRel}:${lineOf(code, index)}: 深导入 slice "${via.dir}/"（"${spec}"），跨 slice 只能走其 index.ts barrel`,
      );
    }
    return;
  }
  // One side is a composition root: it may only enter slices through barrels.
  if (via.name !== null && !isBarrel) {
    errors.push(
      `${parentRel}:${lineOf(code, index)}: 根文件深导入 slice "${via.dir}/"（"${spec}"），只能走其 index.ts barrel`,
    );
  }
}

const files = collectTsFiles(SRC_DIR);
const sliceDirs = new Set();
let importCount = 0;

for (const abs of files) {
  const rel = toPosix(relative(ROOT, abs));
  const area = sliceOf(rel);
  if (area && area.name !== null) sliceDirs.add(area.dir);
  const code = readFileSync(abs, "utf8");
  const specs = [];
  const fromRe = /\b(?:import|export)\b[\s\S]*?\bfrom\s*["']([^"']+)["']/g;
  const sideRe = /^\s*import\s*["']([^"']+)["']/gm;
  for (const m of code.matchAll(fromRe)) specs.push({ spec: m[1], index: m.index });
  for (const m of code.matchAll(sideRe)) specs.push({ spec: m[1], index: m.index });
  for (const { spec, index } of specs) {
    importCount++;
    const target = resolveTarget(rel, spec);
    if (target === "skip") continue;
    if (target === null) {
      errors.push(`${rel}:${lineOf(code, index)}: 无法解析导入 "${spec}"（fail-closed）`);
      continue;
    }
    checkImport(rel, spec, target, code, index);
  }
}

for (const dir of [...sliceDirs].sort()) {
  if (!existsSync(join(ROOT, dir, "index.ts")) && !existsSync(join(ROOT, dir, "index.tsx"))) {
    errors.push(`${dir}/: slice 缺少 index.ts/index.tsx barrel`);
  }
}

if (errors.length > 0) {
  console.error(`slice 边界门禁失败（扫描 ${files.length} 个文件 / ${importCount} 个导入）：\n`);
  for (const error of errors) console.error(` - ${error}`);
  process.exit(1);
}

console.log(`slice 边界门禁通过（${files.length} 个文件 / ${importCount} 个导入）。`);
