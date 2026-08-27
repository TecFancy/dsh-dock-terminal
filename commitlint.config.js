/**
 * Commitlint configuration.
 *
 * Extends @commitlint/config-conventional (Conventional Commits 1.0.0) and
 * pins the allowed type set to keep history scannable. Scope is free-form,
 * conventionally a slice or tooling area (e.g. `entities/greeting`, `build`).
 */
export default {
  extends: ["@commitlint/config-conventional"],
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
    "subject-case": [0],
    "body-max-line-length": [0],
    "footer-max-line-length": [0],
  },
};
