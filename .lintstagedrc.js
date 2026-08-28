/**
 * lint-staged configuration.
 *
 * Agent skills live directly in .agents/skills/ (the single source, consumed
 * by dsh out of the box); there is no mirroring to maintain.
 */
export default {
  "*.{ts,tsx,js,mjs,cjs,json,md,yml,yaml}": ["prettier --write"],
  "*.{ts,tsx}": ["eslint --fix"],
};
