/**
 * What a worktree schedule's branch carries between runs: uncommitted edits a
 * session left behind, and commits that never reached `main`.
 *
 * Both used to be invisible. A session that exited mid-run left its edits in
 * the tree, and the next run's `git merge main` then refused on every run
 * until a person cleaned up (knip-sweep, 2026-09-23). A session that committed
 * but did not land left the commits on the branch, and later runs judged only
 * their own findings (cross-box-leak-scan's 7c95a7cb6 sat three weeks).
 *
 * The runner neither commits unreviewed edits onto the branch nor discards
 * them: it PARKS them as a commit under `refs/schedules/<name>/parked/<runId>`,
 * cleans the tree, and tells the session. Unlanded commits are a standing
 * condition the runner raises; landing stays the session's (or the
 * boxholder's) call, under the schedule's own prompt.
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { execa } from "execa";

import type { Inherited } from "./schedules-briefing.js";
import type { LoadedSchedule } from "./schedules.js";
import { raiseAlert, type RunnerDeps } from "./schedules-alerts.js";
import { resolveConditions } from "./schedules-alert-lifecycle.js";

/** The branch `bin/workstreams create` gives a schedule's worktree. */
function scheduleBranch(name: string): string {
  return `worktree-${name}`;
}

interface GitResult { ok: boolean; stdout: string; stderr: string }

/** `git -C <cwd>`, never throwing; `index` points GIT_INDEX_FILE elsewhere. */
async function git(at: { cwd: string; index?: string }, args: string[]): Promise<GitResult> {
  const env = at.index === undefined ? process.env : { ...process.env, GIT_INDEX_FILE: at.index };
  const result = await execa("git", ["-C", at.cwd, ...args], { reject: false, env });
  return { ok: result.exitCode === 0, stdout: result.stdout, stderr: result.stderr };
}

/** Paths `git status` reports as changed or untracked (ignored files excluded),
 *  or null when git cannot answer. */
export async function dirtyPaths(cwd: string): Promise<string[] | null> {
  const status = await git({ cwd }, ["status", "--porcelain=v1", "--untracked-files=all"]);
  if (!status.ok) return null;
  return status.stdout.split("\n").filter((line) => line !== "").map((line) => line.slice(3));
}

/** Where the worktree on `worktree-<name>` is checked out, or null when it is
 *  not (culled, never created) or git cannot say. */
export async function scheduleWorktreePath(mainRoot: string, name: string): Promise<string | null> {
  const listed = await git({ cwd: mainRoot }, ["worktree", "list", "--porcelain"]);
  if (!listed.ok) return null;
  let current: string | null = null;
  for (const line of listed.stdout.split("\n")) {
    if (line.startsWith("worktree ")) current = line.slice("worktree ".length);
    if (line === `branch refs/heads/${scheduleBranch(name)}`) return current;
  }
  return null;
}

export interface ParkedWork {
  ref: string;
  sha: string;
  base: string;
  paths: string[];
}

export type ParkResult = { kind: "clean" } | { kind: "parked"; parked: ParkedWork } | { kind: "failed"; reason: string };

/**
 * Save every uncommitted change in `cwd` — staged, unstaged, untracked — as one
 * commit on top of HEAD, point `refs/schedules/<name>/parked/<runId>` at it,
 * then reset the tree to HEAD. Ignored files are left alone. The commit is
 * built on a temporary index, so the branch and its index never see it.
 *
 * Fails closed: if the tree is still dirty afterward (a nested repository
 * `clean` will not remove), that is a failure, and nothing launches on it.
 */
async function parkDirtyTree(cwd: string, input: { name: string; runId: string }): Promise<ParkResult> {
  const paths = await dirtyPaths(cwd);
  if (paths === null) return { kind: "failed", reason: "git status failed" };
  if (paths.length === 0) return { kind: "clean" };

  const head = await git({ cwd }, ["rev-parse", "HEAD"]);
  if (!head.ok) return { kind: "failed", reason: `git rev-parse HEAD: ${head.stderr.trim()}` };
  const base = head.stdout.trim();

  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "schedules-park-"));
  try {
    const index = path.join(scratch, "index");
    for (const step of [["read-tree", "HEAD"], ["add", "-A", "--", "."]]) {
      const ran = await git({ cwd, index }, step);
      if (!ran.ok) return { kind: "failed", reason: `git ${step.join(" ")}: ${ran.stderr.trim()}` };
    }
    const tree = await git({ cwd, index }, ["write-tree"]);
    if (!tree.ok) return { kind: "failed", reason: `git write-tree: ${tree.stderr.trim()}` };
    const message = `Uncommitted edits left in the ${input.name} worktree, parked before run ${input.runId}`;
    const commit = await git({ cwd }, ["commit-tree", tree.stdout.trim(), "-p", base, "-m", message]);
    if (!commit.ok) return { kind: "failed", reason: `git commit-tree: ${commit.stderr.trim()}` };
    const sha = commit.stdout.trim();
    const ref = `refs/schedules/${input.name}/parked/${input.runId}`;
    const updated = await git({ cwd }, ["update-ref", ref, sha]);
    if (!updated.ok) return { kind: "failed", reason: `git update-ref: ${updated.stderr.trim()}` };

    // Only now, with the work reachable from a ref, is the tree reset.
    for (const step of [["reset", "--hard", "--quiet", "HEAD"], ["clean", "-fd", "--quiet"]]) {
      const ran = await git({ cwd }, step);
      if (!ran.ok) return { kind: "failed", reason: `git ${step.join(" ")}: ${ran.stderr.trim()} (the edits are saved at ${ref})` };
    }
    const after = await dirtyPaths(cwd);
    if (after === null || after.length > 0) {
      return { kind: "failed", reason: `the tree is still dirty after parking (${after === null ? "git status failed" : after.join(", ")}); the edits are saved at ${ref}` };
    }
    return { kind: "parked", parked: { ref, sha, base, paths } };
  } finally {
    await fs.rm(scratch, { recursive: true, force: true });
  }
}

/**
 * Commits on `head` whose changes are not on `main`, oldest first, as
 * `<short-sha> <subject>`; null when git cannot answer.
 *
 * "Not on main" is judged by content: would merging `head` into `main` change
 * `main`'s tree? A branch whose work was landed by hand under different hashes
 * merges cleanly into the same tree and reports nothing. When something is
 * unlanded, the list is every non-merge commit `main` lacks by hash; when the
 * difference lives only in a merge (a conflict resolved differently), the tip
 * stands in for it.
 */
export async function unlandedCommits(cwd: string, head: string): Promise<string[] | null> {
  const mainTree = await git({ cwd }, ["rev-parse", "main^{tree}"]);
  if (!mainTree.ok) return null;
  // Exit 0 is a clean merge whose tree is printed first; 1 is a conflict,
  // which means `head` holds something `main` does not.
  const merged = await execa("git", ["-C", cwd, "merge-tree", "--write-tree", "main", head], { reject: false });
  if (merged.exitCode !== 0 && merged.exitCode !== 1) return null;
  if (merged.exitCode === 0 && merged.stdout.split("\n")[0] === mainTree.stdout.trim()) return [];
  const listed = await git({ cwd }, ["log", "--reverse", "--no-merges", "--format=%h %s", `main..${head}`]);
  if (!listed.ok) return null;
  const commits = listed.stdout.split("\n").filter((line) => line !== "");
  if (commits.length > 0) return commits;
  const tip = await git({ cwd }, ["log", "-1", "--format=%h %s", head]);
  return [`${tip.ok ? tip.stdout.trim() : head} (the difference is in merge commits)`];
}

/** One line for any alert raised after edits were parked and before a session
 *  was told: the next run finds a clean tree and would never mention them. */
export function parkedNote(parked: ParkedWork): string {
  return `Uncommitted edits from an earlier run (${String(parked.paths.length)} path(s)) were parked on \`${parked.ref}\` before this failure; no session has seen them.`;
}

export type PreparedWorktree =
  | { ok: true; inherited: Inherited }
  | { ok: false; failure: { title: string; message: string; details: string | null } };

/**
 * Ready a schedule's worktree for its session: park an earlier session's
 * uncommitted edits, merge `main`, and list what the branch still carries.
 *
 * Uncommitted edits are an earlier session's unfinished work (it exited
 * mid-run). Left in place they make the merge refuse on every run, as
 * knip-sweep's did from 2026-09-23. Committing them onto the branch would put
 * unreviewed work there and discarding them loses it, so they are parked and
 * the session is told.
 *
 * Then the merge. A worktree schedule is long-lived: `bin/workstreams create`
 * re-attaches an existing branch rather than rebuilding it, so without this the
 * session resumes on whatever `main` looked like the first time the worktree
 * was made. Asking the prompt to do it works until an agent forgets, and the
 * whole point of a scheduled run is that nobody is watching. Plain merge, not
 * `--ff-only`: a schedule that commits between lands carries its own commits,
 * so its branch is legitimately ahead. A conflict is a stop, never something
 * resolved unattended.
 */
export async function prepareScheduleWorktree(cwd: string, input: { name: string; runId: string }): Promise<PreparedWorktree> {
  const parking = await parkDirtyTree(cwd, input);
  if (parking.kind === "failed") {
    return { ok: false, failure: {
      title: "could not set aside uncommitted edits",
      message: `${input.name} has work waiting, but its worktree has uncommitted edits the runner could not park — the run was not started.`,
      details: parking.reason,
    } };
  }
  const merged = await git({ cwd }, ["merge", "--no-edit", "main"]);
  if (!merged.ok) {
    await git({ cwd }, ["merge", "--abort"]);
    return { ok: false, failure: {
      title: "could not bring the worktree up to date with main",
      message: `${input.name} has work waiting, but merging \`main\` into ${path.basename(cwd)} failed — the run was not started.${parking.kind === "parked" ? `\n\n${parkedNote(parking.parked)}` : ""}`,
      details: [merged.stdout, merged.stderr].filter((text) => text.trim() !== "").join("\n") || null,
    } };
  }
  return { ok: true, inherited: {
    parked: parking.kind === "parked" ? parking.parked : null,
    // A git failure here only costs the session a hint; the runner's
    // `unlanded-commits` check after the run is the record.
    unlanded: (await unlandedCommits(cwd, "HEAD")) ?? [],
  } };
}

/** A worktree schedule's branch holding commits `main` lacks. Runner-owned:
 *  checked after every run of such a schedule, raised `normal` while it holds,
 *  resolved once the branch has landed (or is gone). */
const UNLANDED_CONDITION = "unlanded-commits";

/**
 * Finished work must not sit on a schedule branch unnoticed. cross-box-leak-
 * scan's 7c95a7cb6 was reported "ready to land" once, in an `fyi` that closed
 * itself, and then sat three weeks while later runs reported "nothing to land".
 * As a standing condition it stays open, reaches each daily digest, and is
 * filed as an issue after a week. Landing stays with the session (under its
 * prompt) or the boxholder; the runner never lands.
 */
export async function accountForUnlanded(deps: RunnerDeps, input: { schedule: LoadedSchedule; runId: string }): Promise<void> {
  const { schedule } = input;
  if (schedule.config.workstream?.worktree !== true) return;
  const branch = scheduleBranch(schedule.name);
  const resolve = async (): Promise<void> => {
    await resolveConditions(deps.storeRoot, {
      workstream: schedule.name, conditions: [UNLANDED_CONDITION], except: [], at: deps.now().toISOString(),
    });
  };
  const exists = await execa("git", ["-C", deps.mainRoot, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], { reject: false });
  // 1 is "no such branch"; anything else is git unable to answer, which
  // resolves nothing it did not check.
  if (exists.exitCode === 1) return resolve();
  if (exists.exitCode !== 0) return;
  const commits = await unlandedCommits(deps.mainRoot, branch);
  if (commits === null) return;
  if (commits.length === 0) return resolve();
  await raiseAlert(deps, {
    workstream: schedule.name,
    runId: input.runId,
    title: "finished work is not on main",
    message: [
      `\`${branch}\` has ${String(commits.length)} commit(s) that are not on \`main\`:`,
      "",
      ...commits.map((line) => `- ${line}`),
      "",
      `Review and land them from the main checkout with \`bin/land ${branch}\`. The schedule's next session is also told about them, and lands them if its prompt lets it land its own work.`,
    ].join("\n"),
    details: null,
    priority: "normal",
    condition: UNLANDED_CONDITION,
  });
}
