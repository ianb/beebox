/**
 * Listing the paths staged in git's index.
 *
 * One definition of the diff invocation the commit-time checks share.
 * `--relative` is the load-bearing flag: it reports paths relative to (and
 * scoped to) `dir` instead of the repository root, which matters because a v2
 * box's root (`content/`) is not the repo root — the package root is, and git
 * runs hooks from there (see "THE TRAP" in `core/install-validation-hooks.ts`).
 */

import { execFile } from "node:child_process";
import * as path from "node:path";
import { promisify } from "node:util";
import { isTrashedCard } from "./paths.js";

const execFileP = promisify(execFile);

/**
 * Paths staged in `dir`'s index, relative to `dir`, filtered by git's
 * `--diff-filter` letters (e.g. `"ACMR"` for added/copied/modified/renamed,
 * `"DR"` for deletes and renames). A rename reports its destination path.
 */
export async function listStagedRelPaths(
  dir: string,
  { diffFilter }: { diffFilter: string }
): Promise<string[]> {
  // `-z` (NUL separators) is load-bearing for correctness, not a nicety:
  // without it git C-quotes any path with non-ASCII or special characters
  // (core.quotePath), and a quoted name silently matches nothing downstream —
  // in the staged-unlisted guard it would make `git cat-file` report the blob
  // "missing" and a >1MB binary with a unicode filename would pass unchecked.
  const { stdout } = await execFileP(
    "git",
    ["diff", "--cached", "--name-only", "-z", `--diff-filter=${diffFilter}`, "--relative"],
    { cwd: dir, maxBuffer: 10 * 1024 * 1024 }
  );
  return stdout.split("\0").filter((line) => line !== "");
}

/**
 * Absolute paths of the git-staged `.card` files in `boxRoot`, skipping trashed
 * cards (an implicit scan never lints the trash — see `isTrashedCard`).
 */
export async function listStagedCards(boxRoot: string): Promise<string[]> {
  const staged = await listStagedRelPaths(boxRoot, { diffFilter: "ACMR" });
  return staged
    .filter((rel) => rel.endsWith(".card") && !isTrashedCard(rel))
    .map((rel) => path.join(boxRoot, rel));
}
