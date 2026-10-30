/**
 * The node arguments that run a `bin/*.ts` entry under tsx, for any spawn API:
 *
 *   spawnSync(process.execPath, binTsArgs("bin/finish-preflight.ts", ["--json"]), { cwd: fixture })
 *
 * tsx is resolved from this repository. A bare `--import tsx` resolves against
 * the child's cwd, so it fails when that is a fixture repo or a checkout
 * without `node_modules`.
 */

import { isAbsolute, join, resolve } from "node:path";

/** The tsx loader as a file URL, for `node --import`; also usable in a shell hook. */
export const TSX_IMPORT = import.meta.resolve("tsx");

const REPO_ROOT = resolve(import.meta.dirname, "../..");

/** `entry` is absolute, or relative to this repository's root. */
export function binTsArgs(entry: string, args: readonly string[]): string[] {
  return ["--import", TSX_IMPORT, isAbsolute(entry) ? entry : join(REPO_ROOT, entry), ...args];
}
