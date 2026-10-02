/**
 * What a tap test process started from the monorepo root reports (preloaded
 * by `bin/tap-root-guard.ts` through the root `.taprc`). The root is not a
 * test root: each package's `.taprc` carries the loaders and helpers its tests
 * need (the doctest loader, home isolation). Run from the root, a doctest failed with a bare `not ok` or
 * "Unknown file extension .md", and agents read that as a broken install —
 * test subjects went on to delete node_modules. This reports the failure as
 * a TAP result that names the package and the command to run instead.
 */

import { existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

/** The directory of the nearest `.taprc` above `testFile`, below `repoRoot`. */
function owningPackage(testFile: string, repoRoot: string): string | null {
  let dir = dirname(resolve(testFile));
  while (dir.startsWith(repoRoot) && dir !== repoRoot) {
    if (existsSync(join(dir, ".taprc"))) return dir;
    dir = dirname(dir);
  }
  return null;
}

/** The TAP document a root-started test process prints instead of running. */
export function rootGuardReport(opts: { testFile: string; repoRoot: string }): string {
  const pkg = owningPackage(opts.testFile, opts.repoRoot);
  const reason = pkg
    ? `run this test from its package: cd ${relative(opts.repoRoot, pkg)} && pnpm exec tap ${relative(pkg, resolve(opts.testFile))}`
    : "tap is not configured at the monorepo root; run tests from the package that owns them";
  return `TAP version 14\n1..1\nnot ok 1 - ${reason}\n`;
}
