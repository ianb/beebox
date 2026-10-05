/**
 * Preload for tap test processes started from the monorepo root (see the root
 * `.taprc`): report where the test must be run from, and exit, instead of
 * failing in a way that looks like a broken install. Logic: lib/tap-root-guard.ts.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { rootGuardReport } from "./lib/tap-root-guard.ts";

const repoRoot = process.cwd();
const testFile = process.argv[1];
if (testFile !== undefined && existsSync(join(repoRoot, "pnpm-workspace.yaml"))) {
  process.stdout.write(rootGuardReport({ testFile, repoRoot }));
  process.exit(1);
}
