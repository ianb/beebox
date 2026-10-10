/**
 * Build the plugin bundles (`dist/plugins/<name>/{plugin,view}.js`) into the
 * engine's `dist/` the way `build:cli` does: staged under `dist/`, then renamed
 * into place so a concurrent reader (another test resolving
 * `beebox/plugins/<name>/view` through a box's `node_modules/beebox` symlink)
 * never sees a half-written file. A doctest that imports a plugin view through
 * the package `exports` map calls this first, so it does not depend on
 * `pretest` having run.
 */

import { execFile } from "node:child_process";
import { mkdir, readdir, rename, rm } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { promisify } from "node:util";
import { PACKAGE_ROOT } from "../../src/lib/package-root.js";

const execFileAsync = promisify(execFile);

/** Runs the build script as `pnpm build` does, so this helper is not a second importer of it. */
async function buildPluginBundles(params: { root: string; outDir: string }): Promise<void> {
  const script = join(params.root, "src/scripts/build-cli/build/plugins.ts");
  await execFileAsync(process.execPath, [script, params.outDir], { cwd: params.root });
}

export async function buildPluginBundlesIntoDist(): Promise<void> {
  const distDir = join(PACKAGE_ROOT, "dist");
  const tmpDir = join(distDir, `.plugins-${String(process.pid)}`);
  try {
    await buildPluginBundles({ root: PACKAGE_ROOT, outDir: tmpDir });
    const staged = (await readdir(tmpDir, { recursive: true, withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => relative(tmpDir, join(entry.parentPath, entry.name)))
      .toSorted((a, b) => Number(b.endsWith(".map")) - Number(a.endsWith(".map")));
    for (const relPath of staged) {
      await mkdir(dirname(join(distDir, relPath)), { recursive: true });
      await rename(join(tmpDir, relPath), join(distDir, relPath));
    }
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}
