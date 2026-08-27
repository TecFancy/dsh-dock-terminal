#!/usr/bin/env node
/**
 * Scaffolds a new FSD slice on disk. Usage:
 *
 *   node scripts/create-slice.mjs --side host --layer features --name my-feature
 *   node scripts/create-slice.mjs --side client --layer features --name my-feature --ui
 *   node scripts/create-slice.mjs --side host --layer entities --name my-entity
 *   node scripts/create-slice.mjs --side host --layer shared --name my-lib --segment lib
 *
 * Layers: features | entities | shared (shared slices take a segment argument,
 * e.g. --segment lib|ui|config, because shared is segmented).
 *
 * Generated code follows the framework conventions: kebab-case slice names, a
 * public-API barrel (index.ts) as the ONLY import surface, implementations in
 * api/ / model/ / segment files, tests next to the code. The placeholder code
 * is lint/type-check/test compliant so a fresh slice never breaks the gates.
 * New logic should live in an existing slice first; only extract a new slice
 * when a module is genuinely reused by 2+ consumers.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

function usage() {
  console.error(
    "usage: node scripts/create-slice.mjs --side host|client --layer features|entities|shared --name <kebab-case> [--ui] [--segment lib|ui|config]",
  );
  process.exit(1);
}

function parseArgs(argv) {
  const args = {
    side: undefined,
    layer: undefined,
    name: undefined,
    ui: false,
    segment: undefined,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === "--side") {
      args.side = value;
      i += 1;
    } else if (key === "--layer") {
      args.layer = value;
      i += 1;
    } else if (key === "--name") {
      args.name = value;
      i += 1;
    } else if (key === "--segment") {
      args.segment = value;
      i += 1;
    } else if (key === "--ui") {
      args.ui = true;
    } else usage();
  }
  if (!["host", "client"].includes(args.side)) usage();
  if (!["features", "entities", "shared"].includes(args.layer)) usage();
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(args.name ?? "")) {
    console.error("slice name must be kebab-case (lowercase letters, digits, single hyphens)");
    process.exit(1);
  }
  if (args.layer === "shared") {
    if (!args.segment) usage();
    if (!["lib", "ui", "config"].includes(args.segment)) usage();
  } else if (args.segment) {
    usage(); // --segment is only meaningful for shared layers
  }
  if (args.ui && (args.layer !== "features" || args.side !== "client")) {
    usage(); // --ui only applies to client features
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const prefix = args.side === "host" ? "src" : "src/client";
const root = resolve(repoRoot, prefix);

const sliceDir =
  args.layer === "shared"
    ? join(root, "shared", args.segment, args.name)
    : join(root, args.layer, args.name);

const files = [];
const barrel = [
  "/**",
  ` * ${args.name} slice.`,
  " *",
  " * Every slice exposes a public API barrel as its only legal import",
  " * surface for other slices; nothing outside may reach into internal files.",
  " */",
];

if (args.layer === "features" && args.side === "host") {
  // api/ implementation + co-located test + barrel
  files.push([join(sliceDir, "api", `${args.name}.ts`), placeholder("api", args)]);
  files.push([
    join(sliceDir, "api", `${args.name}.test.ts`),
    testPlaceholder(`./${args.name}.js`, args),
  ]);
  barrel.push(`export { placeholder } from "./api/${args.name}.js";`);
} else if (args.layer === "features" && args.side === "client" && args.ui) {
  // ui/ component + css module + test + barrel
  const namePascal = pascalCase(args.name);
  files.push([join(sliceDir, "ui", `${namePascal}.tsx`), uiPlaceholder(namePascal, args)]);
  files.push([
    join(sliceDir, "ui", `${namePascal}.module.css`),
    "/* styles for the slice UI (CSS Modules, embedded into the client bundle) */\n",
  ]);
  files.push([join(sliceDir, "ui", `${namePascal}.test.tsx`), uiTestPlaceholder(namePascal, args)]);
  barrel.push(`export { ${namePascal} } from "./ui/${namePascal}.js";`);
} else if (args.layer === "features" && args.side === "client") {
  // client feature without UI: model logic slice + test + barrel
  files.push([join(sliceDir, "model", `${args.name}.ts`), placeholder("model", args)]);
  files.push([
    join(sliceDir, "model", `${args.name}.test.ts`),
    testPlaceholder(`./${args.name}.js`, args),
  ]);
  barrel.push(`export { placeholder } from "./model/${args.name}.js";`);
} else if (args.layer === "entities") {
  files.push([join(sliceDir, "model", `${args.name}.ts`), placeholder("model", args)]);
  files.push([
    join(sliceDir, "model", `${args.name}.test.ts`),
    testPlaceholder(`./${args.name}.js`, args),
  ]);
  barrel.push(`export { placeholder } from "./model/${args.name}.js";`);
} else if (args.side === "client" && args.segment === "ui") {
  // client shared ui component: tsx + css module + test + barrel, matching the
  // framework's shared/ui/<component>/ convention
  const namePascal = pascalCase(args.name);
  files.push([join(sliceDir, `${namePascal}.tsx`), uiPlaceholder(namePascal, args)]);
  files.push([
    join(sliceDir, `${namePascal}.module.css`),
    "/* styles for the shared UI component (CSS Modules, embedded into the client bundle) */\n",
  ]);
  files.push([join(sliceDir, `${namePascal}.test.tsx`), uiTestPlaceholder(namePascal, args)]);
  barrel.push(`export { ${namePascal} } from "./${namePascal}.js";`);
} else {
  // shared segment slice: implementation file + test + barrel (index.ts)
  files.push([join(sliceDir, `${args.name}.ts`), placeholder("index", args)]);
  files.push([join(sliceDir, `${args.name}.test.ts`), testPlaceholder(`./${args.name}.js`, args)]);
  barrel.push(`export { placeholder } from "./${args.name}.js";`);
}

// The barrel is always a separate file appended last; it never collides with
// an implementation file (each branch above places implementations elsewhere).
files.push([join(sliceDir, "index.ts"), barrel.join("\n") + "\n"]);

for (const [path, content] of files) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
  console.log("created", relative(repoRoot, path));
}

function pascalCase(name) {
  return name
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function placeholder(kind, a) {
  const what = a.name;
  return [
    "/**",
    ` * TODO(${what}): implement this ${kind} placeholder for the ${a.layer} slice.`,
    " */",
    `export function placeholder(): void { /* TODO(${what}) */ }`,
    "",
  ].join("\n");
}

function testPlaceholder(importPath, a) {
  return [
    `import { describe, expect, it } from "vitest";`,
    `import { placeholder } from "${importPath}";`,
    "",
    `describe("${a.name}", () => {`,
    `  it("placeholder behavior", () => {`,
    `    expect(() => placeholder()).not.toThrow();`,
    "  });",
    "});",
    "",
  ].join("\n");
}

function uiPlaceholder(name, a) {
  return [
    `import { useState } from "react";`,
    `import css from "./${name}.module.css";`,
    "",
    `export interface ${name}Props {`,
    `  /** TODO(${a.name}) */`,
    "}",
    "",
    `export function ${name}(_props: ${name}Props): JSX.Element {`,
    `  const [state, setState] = useState<string>("");`,
    "  return (",
    `    <div className={css["root"]}>`,
    "      <input",
    `        data-testid="${a.name}-input"`,
    "        value={state}",
    "        onChange={(event) => setState(event.target.value)}",
    "      />",
    "    </div>",
    "  );",
    "}",
    "",
  ].join("\n");
}

function uiTestPlaceholder(name, a) {
  return [
    "// @vitest-environment jsdom",
    `import { cleanup, render, screen } from "@testing-library/react";`,
    `import { afterEach, describe, expect, it } from "vitest";`,
    `import { ${name} } from "./${name}.js";`,
    "",
    `describe("${name}", () => {`,
    "  afterEach(cleanup);",
    `  it("renders without crashing", () => {`,
    `    render(<${name} />);`,
    `    expect(screen.getByTestId("${a.name}-input")).toBeTruthy();`,
    "  });",
    "});",
    "",
  ].join("\n");
}
