/**
 * lint-staged configuration.
 *
 * skills/ is the source of truth for agent skills; .claude/skills and
 * .opencode/skills are mirrors. The skills rule uses a function (not a glob
 * of files) to invoke the sync script once per run - passing the staged file
 * list as arguments would hit Windows command-line length limits on larger
 * changes and would re-run needlessly per file.
 */
export default {
  "*.{ts,tsx,js,mjs,cjs,json,md,yml,yaml}": ["prettier --write"],
  "*.{ts,tsx}": ["eslint --fix"],
  "skills/**/*": () => ["node scripts/sync-skills.mjs"],
};
