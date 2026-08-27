import ts from "typescript";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const decoratorSyntax = /^\s*@[A-Za-z_$][\w$]*/m;

/**
 * Transform standard TypeScript decorators before Vite's default parser sees
 * source files. Same pre-transform the deepseek-harness repo uses
 * (vitest.shared.ts) for test suites that import decorated sources.
 * @returns a pre-transform Vite plugin.
 */
function standardDecoratorPlugin() {
  return {
    name: "dsh-standard-decorators",
    enforce: "pre" as const,
    transform(code: string, id: string) {
      const file = id.split("?")[0] ?? id;
      if (!/\.[cm]?tsx?$/.test(file) || !decoratorSyntax.test(code)) return;
      const compilerOptions = {
        target: ts.ScriptTarget.ES2024,
        module: ts.ModuleKind.ESNext,
        sourceMap: true,
        ...(file.endsWith("x") ? { jsx: ts.JsxEmit.ReactJSX } : {}),
      };
      const result = ts.transpileModule(code, {
        fileName: file,
        compilerOptions,
      });
      return {
        code: result.outputText
          .replace(
            /^(\s*)(__esDecorate\()/gmu,
            "$1/* v8 ignore next -- compiler-synthetic decorator accessors have no source behavior */ $2",
          )
          .replace(/\n?\/\/# sourceMappingURL=.*$/u, "\n"),
        map: result.sourceMapText,
      };
    },
  };
}

/**
 * Vitest configuration.
 *
 * Node environment by default; client UI tests opt into jsdom with a
 * `// @vitest-environment jsdom` docblock. v8 coverage enforces the same red
 * line as the dsh-auth-gate baseline. `client/*` path aliases mirror
 * tsconfig.client.json so tests can use the same import specifiers as source.
 */
export default defineConfig({
  plugins: [standardDecoratorPlugin()],
  resolve: {
    alias: {
      "client/features": fileURLToPath(new URL("./src/client/features", import.meta.url)),
      "client/entities": fileURLToPath(new URL("./src/client/entities", import.meta.url)),
      "client/shared": fileURLToPath(new URL("./src/client/shared", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.d.ts"],
      thresholds: {
        branches: 70,
        functions: 70,
        lines: 70,
        statements: 70,
      },
    },
    testTimeout: 10_000,
    hookTimeout: 10_000,
  },
});
