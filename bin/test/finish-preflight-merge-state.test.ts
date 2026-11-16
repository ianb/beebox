// # finish-preflight: the merge state a worktree is left in
//
// git refuses to start a merge while MERGE_HEAD exists. Twice in the week of
// 2026-11-09 a finished merge left MERGE_HEAD behind, and preflight reported a
// conflict with no files. Preflight now clears MERGE_HEAD only when HEAD
// already records that merge, nothing is unmerged, and nothing is staged. Any
// other state stops with exit 3 and a message naming it. Each test builds a
// real repository: main and branch `work`, one commit apart each way.

import { test, type Test } from "tap";
import "@ianbicking/tap-check/tap";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MergeConflictError, MergeStateError } from "../finish-preflight-errors.js";
import { clearLeftoverMerge, mergeMain, readMergeState } from "../finish-preflight-merge.js";

interface Repo {
  dir: string;
  git: (...args: string[]) => string;
  commit: (file: string, content: string) => void;
  /** Writes MERGE_HEAD as an interrupted or hand-finished merge leaves it. */
  leaveMergeHead: (...shas: string[]) => void;
  mergeHeadExists: () => boolean;
}

function repo(t: Test): Repo {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "finish-preflight-merge-state-"));
  t.teardown(() => fs.rmSync(dir, { recursive: true, force: true }));
  const git = (...args: string[]): string =>
    execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const commit = (file: string, content: string): void => {
    fs.writeFileSync(path.join(dir, file), content);
    git("add", "-A");
    git("commit", "-qm", file);
  };
  const mergeHeadPath = (): string => path.join(dir, git("rev-parse", "--git-path", "MERGE_HEAD"));
  git("init", "-q", "-b", "main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  git("config", "core.hooksPath", "/dev/null");
  commit("a.txt", "one\n");
  git("checkout", "-q", "-b", "work");
  commit("b.txt", "branch\n");
  git("checkout", "-q", "main");
  commit("c.txt", "main\n");
  git("checkout", "-q", "work");
  return {
    dir,
    git,
    commit,
    leaveMergeHead: (...shas) => fs.writeFileSync(mergeHeadPath(), shas.map((sha) => `${sha}\n`).join("")),
    mergeHeadExists: () => fs.existsSync(mergeHeadPath()),
  };
}

/** Both sides edit a.txt, so merging main conflicts. */
function conflicting(fx: Repo): void {
  fx.git("checkout", "-q", "main");
  fx.commit("a.txt", "main side\n");
  fx.git("checkout", "-q", "work");
  fx.commit("a.txt", "branch side\n");
}

/** The state a stop names, or the result when it does not stop. */
function outcome<T>(fn: () => T): T | { stopped: string; exitCode: number } {
  try {
    return fn();
  } catch (e) {
    if (e instanceof MergeStateError) return { stopped: e.found.state, exitCode: e.exitCode };
    if (e instanceof MergeConflictError) return { stopped: `conflict: ${e.detail.conflicted}`, exitCode: e.exitCode };
    throw e;
  }
}

void test("a clean merge of main merges and clears nothing", async (t) => {
  const fx = repo(t);
  t.check(mergeMain(fx.dir), { status: "merged", broughtPaths: ["c.txt"], resolved: [] });
});

// The case the issue reported. main moves on afterwards, so the run after
// clearing still has something to merge. A checkout removes MERGE_HEAD, so it
// is written last.
void test("a leftover MERGE_HEAD that HEAD already records is cleared, and the merge proceeds", async (t) => {
  const fx = repo(t);
  fx.git("merge", "-q", "--no-edit", "main");
  const merged = fx.git("rev-parse", "main");
  fx.git("checkout", "-q", "main");
  fx.commit("d.txt", "later\n");
  fx.git("checkout", "-q", "work");
  fx.leaveMergeHead(merged);
  t.check(readMergeState(fx.dir), { state: "finished", mergeHead: merged });
  t.check([mergeMain(fx.dir), fx.mergeHeadExists()], [
    { status: "merged", broughtPaths: ["d.txt"], resolved: [], clearedMergeHead: merged },
    false,
  ]);
});

void test("a finished merge with changes staged on top stops and keeps the index", async (t) => {
  const fx = repo(t);
  fx.git("merge", "-q", "--no-edit", "main");
  fx.leaveMergeHead(fx.git("rev-parse", "main"));
  fs.writeFileSync(path.join(fx.dir, "b.txt"), "staged edit\n");
  fx.git("add", "b.txt");
  t.check([outcome(() => mergeMain(fx.dir)), fx.git("diff", "--cached", "--name-only")], [
    { stopped: "finished-with-staged", exitCode: 3 },
    "b.txt",
  ]);
});

// git keeps one line per merged commit. Checking only the first against
// HEAD^2 would clear an octopus merge with heads unchecked.
void test("a MERGE_HEAD naming more than one commit is not cleared, even when its first matches", async (t) => {
  const fx = repo(t);
  fx.git("merge", "-q", "--no-edit", "main");
  fx.leaveMergeHead(fx.git("rev-parse", "main"), fx.git("rev-parse", "HEAD~1"));
  t.check([outcome(() => mergeMain(fx.dir)), fx.mergeHeadExists()], [{ stopped: "unreadable", exitCode: 3 }, true]);
});

void test("a merge with conflicts still in progress stops and names the files", async (t) => {
  const fx = repo(t);
  conflicting(fx);
  spawnSync("git", ["merge", "main"], { cwd: fx.dir });
  t.check(readMergeState(fx.dir), { state: "conflicted", mergeHead: fx.git("rev-parse", "main"), paths: ["a.txt"] });
  t.check(outcome(() => mergeMain(fx.dir)), { stopped: "conflicted", exitCode: 3 });
});

// Left as found: the person decides between commit and abort.
void test("conflicts resolved in the index but not committed stop with that state", async (t) => {
  const fx = repo(t);
  conflicting(fx);
  spawnSync("git", ["merge", "main"], { cwd: fx.dir });
  fs.writeFileSync(path.join(fx.dir, "a.txt"), "resolved\n");
  fx.git("add", "a.txt");
  t.check([outcome(() => mergeMain(fx.dir)), readMergeState(fx.dir).state], [
    { stopped: "resolved-uncommitted", exitCode: 3 },
    "resolved-uncommitted",
  ]);
});

void test("a MERGE_HEAD that HEAD does not record, with nothing staged, stops", async (t) => {
  const fx = repo(t);
  fx.leaveMergeHead(fx.git("rev-parse", "main"));
  t.check(outcome(() => mergeMain(fx.dir)), { stopped: "unrecorded", exitCode: 3 });
});

// An untracked file main would overwrite: git fails, and nothing is unmerged.
void test("a merge that fails without conflicts says so instead of reporting a conflict", async (t) => {
  const fx = repo(t);
  fs.writeFileSync(path.join(fx.dir, "c.txt"), "untracked\n");
  t.check(outcome(() => mergeMain(fx.dir)), { stopped: "merge-failed", exitCode: 3 });
});

void test("a new conflict with no rule is reported as a conflict, the merge left in progress", async (t) => {
  const fx = repo(t);
  conflicting(fx);
  t.check([outcome(() => mergeMain(fx.dir)), readMergeState(fx.dir).state], [
    { stopped: "conflict: a.txt", exitCode: 3 },
    "conflicted",
  ]);
});

// `--no-merge` runs the same check: a sheet read over a half-done merge would
// describe a tree nobody committed.
void test("--no-merge's check clears a finished leftover once and stops on anything else", async (t) => {
  const fx = repo(t);
  fx.git("merge", "-q", "--no-edit", "main");
  const merged = fx.git("rev-parse", "main");
  fx.leaveMergeHead(merged);
  const first = clearLeftoverMerge(fx.dir);
  const second = clearLeftoverMerge(fx.dir);
  fx.leaveMergeHead(fx.git("rev-parse", "HEAD~1"));
  t.check([first, second, outcome(() => clearLeftoverMerge(fx.dir))], [
    merged,
    undefined,
    { stopped: "unrecorded", exitCode: 3 },
  ]);
});
