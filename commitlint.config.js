/**
 * Commitlint configuration.
 *
 * Extends @commitlint/config-conventional (Conventional Commits 1.0.0) and
 * pins the allowed type set to keep history scannable. Scope is free-form,
 * conventionally a slice or tooling area (e.g. `features/pty-bridge`, `build`).
 *
 * `subject-english` is a custom function rule: subjects must stay English
 * (ASCII-only, issue references and punctuation allowed). Unlike the
 * AI-trailer strip in `.husky/commit-msg`, this one fails closed — a
 * non-ASCII subject is rejected, not silently rewritten.
 */
export default {
  extends: ["@commitlint/config-conventional"],
  // Custom rules must be registered through a plugin: commitlint treats
  // unknown rule names in `rules` as "no implementation" and crashes.
  plugins: [
    {
      rules: {
        "subject-english": ({ subject }) => {
          if (!subject) return [true]; // subject-empty reports separately
          if (/[^\x00-\x7F]/.test(subject)) {
            return [false, "subject must be English (ASCII only)"];
          }
          return [true];
        },
      },
    },
  ],
  rules: {
    "type-enum": [
      2,
      "always",
      [
        "feat", // user-facing feature
        "fix", // user-facing bug fix
        "docs", // documentation only
        "style", // formatting, no code change
        "refactor", // neither feat nor fix
        "perf", // performance improvement
        "test", // adding/fixing tests
        "build", // build system, deps
        "ci", // CI configuration
        "chore", // tooling, no src change
        "revert", // revert a previous commit
      ],
    ],
    "subject-english": [2, "always"],
    "subject-case": [0],
    "body-max-line-length": [0],
    "footer-max-line-length": [0],
  },
};
