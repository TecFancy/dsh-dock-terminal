import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, resolve } from "node:path";
import type { UserConfig } from "tsdown";
import { transform } from "lightningcss";

/**
 * dsh-dock-terminal client half build: src/client/index.tsx -> lib/client.js
 * (window.__ModuleLoader__.load({ id, factory }) format, CJS closure).
 *
 * Mirrors the official client bundle preset (packages/client/tsdown.client.ts
 * in deepseek-harness):
 * - react / react/jsx-runtime are externalized against the web app's module
 *   table; everything else is inlined (the plugin's own /remote contribution
 *   and its zod codec ship inside the single file);
 * - CSS is compiled by lightningcss inside the bundle: `x.module.css` yields
 *   its hashed class map and injects a tagged style element at factory
 *   execution (`data-plugin-css`), while `x.css?inline` exports compiled text
 *   and plain `.css` injects itself the same way - so no stylesheet asset is
 *   ever fetched separately (the loader serves ONLY the factory script);
 * - single-file output (codeSplitting: false). The CJS closure format is
 *   REQUIRED by the dsh client-modules loader contract, so the "prefer ESM"
 *   tsdown warning is expected and must stay.
 */
const CLIENT_EXTERNALS = ["react", "react/jsx-runtime"];

const ID = "dsh-dock-terminal";

/**
 * Virtual-id wrapper keeping module CSS away from tsdown's own css pipeline
 * (which requires @tsdown/css). The suffix matters: tsdown's guard matches ids
 * ending in `.css`, so the virtual id must not.
 */
const CSS_VIRTUAL_PREFIX = "\0dsh-css:";
const GLOBAL_CSS_VIRTUAL_PREFIX = "\0dsh-global-css:";
const INLINE_CSS_VIRTUAL_PREFIX = "\0dsh-inline-css:";
const CSS_VIRTUAL_SUFFIX = ".mjs";
const INLINE_CSS_QUERY = "?inline";

/** Emit one plugin-owned style injector and an optional CSS Modules export. */
function styleInjectionModule(
  id: string,
  fileId: string,
  css: string,
  classMap?: Readonly<Record<string, string>>,
): string {
  const source = [
    `const css = ${JSON.stringify(css)};`,
    `const tagId = ${JSON.stringify(`${id}/${basename(fileId)}`)};`,
    "if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {",
    "  const tag = document.createElement('style');",
    `  tag.dataset.plugin = ${JSON.stringify(id)};`,
    "  tag.dataset.pluginCss = tagId;",
    "  tag.textContent = css;",
    "  document.head.appendChild(tag);",
    "}",
  ];
  source.push(
    classMap === undefined ? "export {};" : `export default ${JSON.stringify(classMap)};`,
  );
  return source.join("\n");
}

/** Resolve one import specifier against the importing module's physical path. */
function sourceAssetPath(source: string, importer: string): string {
  return resolve(importer, "..", source);
}

/**
 * Resolve a CSS import to a physical path: relative imports anchor at the
 * importer (the template default), bare specifiers resolve through node
 * modules (third-party css such as `@xterm/xterm/css/xterm.css`).
 */
const require = createRequire(import.meta.url);
function resolveCssPath(source: string, importer: string | undefined): string {
  if (source.startsWith(".") || source.startsWith("/")) {
    return importer !== undefined ? sourceAssetPath(source, importer) : source;
  }
  return require.resolve(source);
}

export default [
  {
    entry: { client: "src/client/index.tsx" },
    outDir: "lib",
    format: "cjs",
    platform: "browser",
    dts: false,
    sourcemap: true,
    clean: false,
    deps: {
      neverBundle: CLIENT_EXTERNALS,
      alwaysBundle: (id: string) => !CLIENT_EXTERNALS.includes(id),
    },
    define: {
      "process.env.NODE_ENV": JSON.stringify(process.env["NODE_ENV"] ?? "production"),
    },
    plugins: [
      {
        name: "dsh-css-modules-inline",
        resolveId(source: string, importer: string | undefined) {
          if (!source.endsWith(".module.css")) return null;
          const abs = importer !== undefined ? sourceAssetPath(source, importer) : source;
          return CSS_VIRTUAL_PREFIX + abs + CSS_VIRTUAL_SUFFIX;
        },
        async load(virtualId: string) {
          if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null;
          const fileId = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length);
          this.addWatchFile(fileId);
          const source = await readFile(fileId);
          const { code, exports: cssExports } = transform({
            filename: fileId,
            code: source,
            cssModules: { pattern: "[hash]_[local]" },
            minify: true,
          });
          const classMap: Record<string, string> = {};
          for (const [local, exported] of Object.entries(cssExports ?? {})) {
            classMap[local] = String(exported.name);
          }
          return styleInjectionModule(ID, fileId, code.toString(), classMap);
        },
      },
      {
        name: "dsh-css-text-inline",
        resolveId(source: string, importer: string | undefined) {
          if (!source.endsWith(`.css${INLINE_CSS_QUERY}`)) return null;
          const stylesheet = source.slice(0, -INLINE_CSS_QUERY.length);
          const abs = importer !== undefined ? sourceAssetPath(stylesheet, importer) : stylesheet;
          return INLINE_CSS_VIRTUAL_PREFIX + abs + CSS_VIRTUAL_SUFFIX;
        },
        async load(virtualId: string) {
          if (!virtualId.startsWith(INLINE_CSS_VIRTUAL_PREFIX)) return null;
          const fileId = virtualId.slice(
            INLINE_CSS_VIRTUAL_PREFIX.length,
            -CSS_VIRTUAL_SUFFIX.length,
          );
          this.addWatchFile(fileId);
          const source = await readFile(fileId);
          const { code } = transform({ filename: fileId, code: source, minify: true });
          return `export default ${JSON.stringify(code.toString())};`;
        },
      },
      {
        name: "dsh-css-global-inline",
        resolveId(source: string, importer: string | undefined) {
          if (!source.endsWith(".css") || source.endsWith(".module.css")) return null;
          const abs = resolveCssPath(source, importer);
          return GLOBAL_CSS_VIRTUAL_PREFIX + abs + CSS_VIRTUAL_SUFFIX;
        },
        async load(virtualId: string) {
          if (!virtualId.startsWith(GLOBAL_CSS_VIRTUAL_PREFIX)) return null;
          const fileId = virtualId.slice(
            GLOBAL_CSS_VIRTUAL_PREFIX.length,
            -CSS_VIRTUAL_SUFFIX.length,
          );
          this.addWatchFile(fileId);
          const source = await readFile(fileId);
          const { code } = transform({ filename: fileId, code: source, minify: true });
          return styleInjectionModule(ID, fileId, code.toString());
        },
      },
    ],
    outputOptions: {
      entryFileNames: "client.js",
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
      footer: "return module.exports; } });",
      intro: "var module = { exports: {} }; var exports = module.exports;",
      codeSplitting: false,
    },
  },
] satisfies UserConfig[];
