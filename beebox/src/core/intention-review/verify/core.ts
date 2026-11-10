/**
 * `bbx engine intentions verify`, the validate of the stock
 * `refresh-intentions` procedure (docs/implemented-plans/place-intention.md, Track D).
 *
 * The procedure's own commits are those in `<baseline>..HEAD` carrying
 * `Created-By: refresh-intentions`; other commits there (a chat working at the
 * same time) are not judged. The run fails, and the places stay listed for
 * the next day, when a listed landmark is left modified, when a procedure
 * commit touches any path but a listed landmark, or when it changes a listed
 * landmark anywhere but `intention`. This detects an out-of-scope edit after
 * the commit; it does not prevent one.
 *
 * On success every listed place is recorded as reviewed at `HEAD`, changed or
 * not, and the run is cleared. A place another commit changed during the run
 * is recorded at the baseline instead, so the next run looks at that change.
 */

import { boxGit } from "../../../lib/git/env.js";
import { getHeadSha } from "../../../lib/git-range.js";
import { changeOutsideIntention } from "./compare.js";
import { findPlaces, ownsPath } from "../places.js";
import { loadIntentionState, saveIntentionState } from "../state.js";

const TRAILER = "refresh-intentions";

export type IntentionVerifyResult = { ok: true; reviewed: string[] } | { ok: false; problems: string[] };

interface RangeCommit {
  sha: string;
  byProcedure: boolean;
  paths: string[];
}

async function rangeCommits(boxRoot: string, { baseline, head }: { baseline: string; head: string }): Promise<RangeCommit[]> {
  const git = boxGit(boxRoot);
  const log = await git.raw(["log", "--format=%H%x09%(trailers:key=Created-By,valueonly,separator=%x2C)", `${baseline}..${head}`, "--"]);
  const commits: RangeCommit[] = [];
  for (const line of log.split("\n").filter((l) => l !== "")) {
    const [sha = "", trailers = ""] = line.split("\t");
    const byProcedure = trailers.split(",").some((value) => value.trim() === TRAILER);
    const tree = await git.raw(["diff-tree", "--no-commit-id", "--name-only", "-r", "-z", sha]);
    commits.push({ sha, byProcedure, paths: tree.split("\0").filter((p) => p !== "") });
  }
  return commits;
}

/** The file at `rev`, or null when it does not exist there. */
async function fileAt(boxRoot: string, { rev, relPath }: { rev: string; relPath: string }): Promise<string | null> {
  try {
    return await boxGit(boxRoot).show([`${rev}:${relPath}`]);
  } catch (_e) {
    return null; // absent at that revision
  }
}

async function judgeCommit(boxRoot: string, { commit, listed }: { commit: RangeCommit; listed: ReadonlySet<string> }): Promise<string[]> {
  const short = commit.sha.slice(0, 8);
  const problems: string[] = [];
  for (const relPath of commit.paths) {
    if (!listed.has(relPath)) {
      problems.push(`commit ${short} changed ${relPath}, which is not a listed landmark`);
      continue;
    }
    const before = await fileAt(boxRoot, { rev: `${commit.sha}^`, relPath });
    const after = await fileAt(boxRoot, { rev: commit.sha, relPath });
    if (before === null || after === null) {
      problems.push(`commit ${short} ${before === null ? "created" : "deleted"} ${relPath}`);
      continue;
    }
    const change = changeOutsideIntention(before, after);
    if (change !== null) problems.push(`commit ${short} changed ${relPath} outside intention: ${change}`);
  }
  return problems;
}

/** Listed landmarks with uncommitted changes. A never-committed landmark is not the agent's edit. */
async function dirtyLandmarks(boxRoot: string, listed: readonly string[]): Promise<string[]> {
  const out = await boxGit(boxRoot).raw(["status", "--porcelain=v1", "-z", "--", ...listed]);
  return out
    .split("\0")
    .filter((entry) => entry.length > 3 && !entry.startsWith("??"))
    .map((entry) => entry.slice(3))
    .filter((relPath) => listed.includes(relPath));
}

export async function verifyIntentions(boxRoot: string): Promise<IntentionVerifyResult> {
  const state = await loadIntentionState(boxRoot);
  if (state.run === null) return { ok: false, problems: ["no intention review is open; `bbx engine intentions check` opens one"] };
  const { baseline, listed } = state.run;
  const listedSet = new Set(listed);
  // One HEAD, read before the range is collected and recorded as the review
  // commit: a commit landing between the two would otherwise be recorded as
  // reviewed without being seen.
  const head = await getHeadSha(boxRoot);
  if (head === null) return { ok: false, problems: ["the box has no commits"] };
  const problems = (await dirtyLandmarks(boxRoot, listed)).map((relPath) => `${relPath} has uncommitted changes`);
  const commits = await rangeCommits(boxRoot, { baseline, head });
  for (const commit of commits.filter((c) => c.byProcedure)) {
    problems.push(...(await judgeCommit(boxRoot, { commit, listed: listedSet })));
  }
  if (problems.length > 0) return { ok: false, problems };

  const others = commits.filter((c) => !c.byProcedure).flatMap((c) => c.paths);
  const reviewed = { ...state.reviewed };
  const recorded: string[] = [];
  for (const place of await findPlaces(boxRoot)) {
    if (!listedSet.has(place.landmark)) continue;
    reviewed[place.landmark] = others.some((relPath) => ownsPath(place, relPath)) ? baseline : head;
    recorded.push(place.landmark);
  }
  await saveIntentionState(boxRoot, { reviewed, run: null });
  return { ok: true, reviewed: recorded };
}
