/** Which paths a repository's ignore rules exclude, asked of git itself. */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { gitWithInput } from "./internal.js";
import { repoRootOf } from "./repo.js";

/** `git check-ignore` exits 1 when no path is ignored; that is an answer, not a failure. */
const NONE_IGNORED_EXIT = 1;

/**
 * The subset of `relPaths` (relative to `cwd`) that git ignores, in one git
 * process. A tracked path is never reported, matching what `git add` would do.
 * Outside any repository nothing is ignored, so the result is empty.
 *
 * `-z` makes input and output NUL-delimited, so a path containing a newline
 * survives the round trip; git echoes each ignored path exactly as given.
 */
export async function ignoredPaths(
  cwd: string,
  relPaths: readonly string[],
): Promise<Set<string>> {
  if (relPaths.length === 0) return new Set();
  if ((await repoRootOf(cwd)) === null) return new Set();
  const out = await gitWithInput({
    cwd,
    args: ["check-ignore", "--stdin", "-z"],
    input: relPaths.map((p) => `${p}\0`).join(""),
    okExitCodes: [NONE_IGNORED_EXIT],
  });
  return new Set(out.split("\0").filter((p) => p !== ""));
}

/**
 * The subset of `relPaths` that `git add` can take: not ignored, and either on
 * disk or tracked. A file that moved out of an ignored folder (a page sent from
 * the Clerk, docs/plans/clerk-quick-send.md) has an old path that is neither,
 * and naming it would make `git add` fail after the move happened.
 */
export async function stageablePaths(cwd: string, relPaths: string[]): Promise<string[]> {
  if (relPaths.length === 0) return [];
  if ((await repoRootOf(cwd)) === null) return relPaths;
  const ignored = await ignoredPaths(cwd, relPaths);
  const listed = await gitWithInput({ cwd, args: ["ls-files", "-z", "--", ...relPaths], input: "" });
  const tracked = new Set(listed.split("\0").filter((p) => p !== ""));
  const result: string[] = [];
  for (const rel of relPaths) {
    if (ignored.has(rel)) continue;
    if (tracked.has(rel) || await fs.access(path.join(cwd, rel)).then(() => true, () => false)) result.push(rel);
  }
  return result;
}
