/**
 * Verify that the desktop profile composes this plugin, using DSH's own
 * profile loader rather than a hand-rolled approximation.
 *
 * Must run inside the Desktop runtime (Electron in Node mode), because the
 * loader lives in `app.asar`:
 *
 *   $env:ELECTRON_RUN_AS_NODE='1'
 *   & "<DeepSeek Harness.exe>" --expose-internals <this file>
 *
 * It reports, from the loader's own output: whether the bundle resolved, which
 * patch rows it contributed, and every bundle the loader skipped.
 */

import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const APP = process.env.LOCALAPPDATA
  ? join(process.env.LOCALAPPDATA, "Programs", "DeepSeek Harness", "resources", "app.asar")
  : null;
if (APP === null) throw new Error("LOCALAPPDATA is not set");
const ASAR_DSH = join(APP, "dsh");
const PROFILE = process.env.DSH_PROFILE_DIR ?? join(process.env.USERPROFILE ?? "", ".dsh", "profiles", "desktop");
const PLUGIN = "dsh-boot-animation";

const { loadProfileDirectory } = await import(
  pathToFileURL(join(ASAR_DSH, "node_modules", "@deepseek-ai", "dsh-app-boot", "lib", "index.js")).href
);

const profile = loadProfileDirectory("dsh", PROFILE, join(ASAR_DSH, "package.json"), { userLayer: false });

const layer = profile.layers.find((entry) => entry.packageName === PLUGIN);
const skipped = profile.skippedBundles.find((entry) => entry.packageName === PLUGIN);

console.log(`profile            ${profile.dir}`);
console.log(`bundles loaded     ${profile.layers.length}`);
console.log(`bundles skipped    ${profile.skippedBundles.length}`);
for (const entry of profile.skippedBundles) console.log(`  skipped: ${entry.packageName} — ${entry.reason}`);
console.log(`layer for ${PLUGIN}: ${layer === undefined ? "MISSING" : layer.packageDir}`);
if (layer !== undefined) {
  console.log(`  patch files      ${layer.patchPaths.length}`);
  for (const row of layer.patches) {
    console.log(`  row              ${JSON.stringify({ id: row.id, name: row.name, insert: row.insert === undefined ? undefined : row.insert.map((i) => i.id) })}`);
  }
}
if (skipped !== undefined) console.log(`  skip reason      ${skipped.reason}`);

// Resolve and load the Host half exactly as the loader would.
const require = createRequire(join(PROFILE, "package.json"));
const entry = require.resolve(PLUGIN);
const host = await import(pathToFileURL(entry).href);
console.log(`resolved entry     ${entry}`);
console.log(`host exports       apply=${typeof host.apply}, inject=${JSON.stringify(host.inject)}, default=${typeof host.default}`);

const ok = layer !== undefined && skipped === undefined && typeof host.apply === "function";
console.log(ok ? "\nVERIFIED: the desktop profile composes dsh-boot-animation" : "\nNOT VERIFIED");
process.exitCode = ok ? 0 : 1;
