/** Which paths a repository's ignore rules exclude, asked of git itself. */

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
