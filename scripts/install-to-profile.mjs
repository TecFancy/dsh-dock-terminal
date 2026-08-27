#!/usr/bin/env node
/**
 * Smoke-install helper for a locally built plugin.
 *
 * Prints the exact commands to mount this plugin in a dsh profile and (when
 * the profile lives on this machine) copies the built artifacts into the
 * profile's node_modules so a restart can pick them up.
 *
 * Usage:
 *   npm run build
 *   node scripts/install-to-profile.mjs [--profile web] [--copy]
 *
 * --copy  also copies lib/ and cordis.patch.yml into the profile's
 *         node_modules (falls back to printing commands if the profile or its
 *         node_modules directory is missing).
 *
 * Restarting the dsh web server is left to the user: it terminates the
 * currently running GUI session, so this script never restarts it by itself.
 */
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const profileArg = process.argv.indexOf("--profile");
const profile = profileArg >= 0 ? process.argv[profileArg + 1] : "web";
const copy = process.argv.includes("--copy");

const dshHome = process.env.DSH_HOME ?? join(homedir(), ".dsh");
const profileDir = join(dshHome, "profiles", profile);

console.log(`target profile: ${profileDir}`);

if (copy) {
  const targetPackageDir = join(profileDir, "node_modules", "@tecfancy", "dsh-dock-terminal");
  if (!existsSync(profileDir) || !existsSync(join(profileDir, "node_modules"))) {
    console.error("profile or its node_modules is missing; falling back to printed commands");
  } else {
    mkdirSync(targetPackageDir, { recursive: true });
    for (const file of ["lib/index.js", "lib/client.js", "cordis.patch.yml"]) {
      const src = join(repoRoot, file);
      if (!existsSync(src)) {
        console.error(`missing built artifact ${file} (run npm run build first)`);
        process.exit(1);
      }
      const dest = join(targetPackageDir, file);
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(src, dest);
      console.log(`copied ${file}`);
    }
    console.log("done. Restart the dsh web server to load the plugin.");
    process.exit(0);
  }
}

console.log(`
Manual install commands (copy the artifacts as above, or use the CLI which
also reconciles dsh.profile.bundles; a restart is required either way):

  dsh plugin --profile ${profile} add <path-or-package>

Deployment config overrides go into the USER layer, not the bundle patch:
see deploy/cordis.patch.yml.
`);
