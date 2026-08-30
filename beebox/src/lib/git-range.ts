/**
 * Ranged git helpers — the diff/log queries the existing `git.ts` helpers
 * can't express. `getDiff` has no baseline ref and `getLogPaginated` takes no
 * commit range, so the `bbx chat whats-changed` command (which reports what
 * changed `marker.head..HEAD` plus the uncommitted tree) needs these.
 *
 * Split into a sibling module so `git.ts` stays under the 300-line cap.
 */

import { simpleGit } from "simple-git";

/**
 * Resolve HEAD to a full commit sha, or null when the repo has no commits yet.
 * Used to anchor the chat turn marker (see `chat-turn-marker.ts`).
 */
export async function getHeadSha(boxRoot: string): Promise<string | null> {
  try {
    return (await simpleGit(boxRoot).revparse(["HEAD"])).trim();
  } catch (_e) {
    // revparse HEAD fails when there are no commits — null is the answer.
    return null;
  }
}

/**
 * One-line commit log. `base` scopes to the `base..HEAD` range (commits since
 * a marker); `count` caps to the last N; the two combine. `paths` scopes to
 * specific files. Returns "" when nothing matches or the range is unresolvable.
 */
export async function getOnelineLog(
  boxRoot: string,
  { base, count, paths }: { base?: string; count?: number; paths?: string[] },
): Promise<string> {
  const args = ["log", "--oneline"];
  if (count !== undefined) args.push("-n", String(count));
  if (base !== undefined) args.push(`${base}..HEAD`);
  if (paths && paths.length > 0) args.push("--", ...paths);
  try {
    return (await simpleGit(boxRoot).raw(args)).trim();
  } catch (_e) {
    // Unresolvable range (e.g. a marker sha no longer reachable) → empty.
    return "";
  }
}

/**
 * `git diff <range> --stat` summary, optionally scoped to `paths`. `range` is
 * a single ref (`HEAD` → uncommitted working tree vs HEAD) or a range
 * (`<base>..HEAD` → committed changes). Returns "" when there are no changes
 * or the range can't be resolved.
 */
export async function getDiffStat(
  boxRoot: string,
  { range, paths }: { range: string; paths?: string[] },
): Promise<string> {
  const args = [range, "--stat"];
  if (paths && paths.length > 0) args.push("--", ...paths);
  try {
    return (await simpleGit(boxRoot).diff(args)).trim();
  } catch (_e) {
    return "";
  }
}

/**
 * Full `git diff <range>` patch (not `--stat`), optionally scoped to `paths`.
 * `range` is a single ref or a `<base>..<head>` range. Used by the procedure
 * engine to hand a step's complete change to the instruction-validation judge —
 * a range (`baseline..finalRef`) so a multi-commit step is captured whole, not
 * just its last commit. Returns "" when there are no changes or the range can't
 * be resolved.
 */
export async function getRangeDiff(
  boxRoot: string,
  { range, paths }: { range: string; paths?: string[] },
): Promise<string> {
  const args = [range];
  if (paths && paths.length > 0) args.push("--", ...paths);
  try {
    return (await simpleGit(boxRoot).diff(args)).trim();
  } catch (_e) {
    return "";
  }
}
