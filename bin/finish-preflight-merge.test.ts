// finish-preflight's merge of main against the merge state a worktree can be
// left in, in real temporary git repositories.
//
// A node:test file for the reason bin/finish-preflight.test.ts gives.
//
//   node --import tsx --test bin/finish-preflight-merge.test.ts

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  MergeConflictError,
  MergeStateError,
} from "./finish-preflight-errors.js";
import { mergeMain, readMergeState } from "./finish-preflight-merge.js";

interface Repo {
  dir: string;
  git: (...args: string[]) => string;
  write: (path: string, text: string) => void;
  commit: (message: string) => void;
  cleanup: () => void;
}

/** main with a.txt, and branch `work` checked out, one commit ahead and one behind. */
function repo(): Repo {
  const dir = mkdtempSync(join(tmpdir(), "finish-preflight-merge-"));
  const git = (...args: string[]): string =>
    execFileSync("git", args, {
      cwd: dir,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  const write = (path: string, text: string): void => {
    writeFileSync(join(dir, path), text);
  };
  const commit = (message: string): void => {
    git("add", "-A");
    git("commit", "-q", "-m", message);
  };
  git("init", "-q", "-b", "main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  git("config", "core.hooksPath", "/dev/null");
  write("a.txt", "one\n");
  commit("base");
  git("checkout", "-q", "-b", "work");
  write("b.txt", "branch\n");
  commit("branch work");
  git("checkout", "-q", "main");
  write("c.txt", "main\n");
  commit("main work");
  git("checkout", "-q", "work");
  return {
    dir,
    git,
    write,
    commit,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/** Writes MERGE_HEAD as an interrupted or hand-finished merge leaves it. */
function leaveMergeHead(fx: Repo, sha: string): void {
  writeFileSync(
    join(fx.dir, fx.git("rev-parse", "--git-path", "MERGE_HEAD")),
    `${sha}\n`,
  );
}

function expectState(fn: () => unknown, state: string): void {
  assert.throws(fn, (e: unknown) => {
    assert.ok(e instanceof MergeStateError, String(e));
    assert.equal(e.found.state, state);
    assert.equal(e.exitCode, 3);
    return true;
  });
}

test("a clean merge of main merges and clears nothing", () => {
  const fx = repo();
  try {
    const result = mergeMain(fx.dir);
    assert.equal(result.status, "merged");
    assert.deepEqual(result.broughtPaths, ["c.txt"]);
    assert.equal(result.clearedMergeHead, undefined);
  } finally {
    fx.cleanup();
  }
});

test("a leftover MERGE_HEAD that HEAD already records is cleared, and the merge proceeds", () => {
  const fx = repo();
  try {
    fx.git("merge", "-q", "--no-edit", "main");
    const merged = fx.git("rev-parse", "main");
    // main moves on, so the run after clearing still has something to merge.
    // (Before MERGE_HEAD is written: a checkout removes it.)
    fx.git("checkout", "-q", "main");
    fx.write("d.txt", "later\n");
    fx.commit("main later");
    fx.git("checkout", "-q", "work");
    leaveMergeHead(fx, merged);
    assert.deepEqual(readMergeState(fx.dir), {
      state: "finished",
      mergeHead: merged,
    });
    const result = mergeMain(fx.dir);
    assert.equal(result.clearedMergeHead, merged);
    assert.equal(result.status, "merged");
    assert.deepEqual(result.broughtPaths, ["d.txt"]);
    assert.equal(
      existsSync(join(fx.dir, fx.git("rev-parse", "--git-path", "MERGE_HEAD"))),
      false,
    );
  } finally {
    fx.cleanup();
  }
});

test("a finished merge with changes staged on top stops and keeps the index", () => {
  const fx = repo();
  try {
    fx.git("merge", "-q", "--no-edit", "main");
    leaveMergeHead(fx, fx.git("rev-parse", "main"));
    fx.write("b.txt", "staged edit\n");
    fx.git("add", "b.txt");
    expectState(() => mergeMain(fx.dir), "finished-with-staged");
    assert.equal(fx.git("diff", "--cached", "--name-only"), "b.txt");
  } finally {
    fx.cleanup();
  }
});

test("a merge with conflicts still in progress stops and names the files", () => {
  const fx = repo();
  try {
    fx.git("checkout", "-q", "main");
    fx.write("a.txt", "main side\n");
    fx.commit("main edits a");
    fx.git("checkout", "-q", "work");
    fx.write("a.txt", "branch side\n");
    fx.commit("branch edits a");
    assert.notEqual(
      spawnSync("git", ["merge", "main"], { cwd: fx.dir }).status,
      0,
    );
    assert.throws(
      () => mergeMain(fx.dir),
      (e: unknown) =>
        e instanceof MergeStateError &&
        e.found.state === "conflicted" &&
        /a\.txt/.test(e.message),
    );
  } finally {
    fx.cleanup();
  }
});

test("conflicts resolved in the index but not committed stop with that state", () => {
  const fx = repo();
  try {
    fx.git("checkout", "-q", "main");
    fx.write("a.txt", "main side\n");
    fx.commit("main edits a");
    fx.git("checkout", "-q", "work");
    fx.write("a.txt", "branch side\n");
    fx.commit("branch edits a");
    spawnSync("git", ["merge", "main"], { cwd: fx.dir });
    fx.write("a.txt", "resolved\n");
    fx.git("add", "a.txt");
    expectState(() => mergeMain(fx.dir), "resolved-uncommitted");
    // Left as found: the person decides between commit and abort.
    assert.equal(readMergeState(fx.dir).state, "resolved-uncommitted");
  } finally {
    fx.cleanup();
  }
});

test("a MERGE_HEAD that HEAD does not record, with nothing staged, stops", () => {
  const fx = repo();
  try {
    leaveMergeHead(fx, fx.git("rev-parse", "main"));
    expectState(() => mergeMain(fx.dir), "unrecorded");
  } finally {
    fx.cleanup();
  }
});

test("a merge that fails without conflicts says so instead of reporting a conflict", () => {
  const fx = repo();
  try {
    // An untracked file main would overwrite.
    fx.write("c.txt", "untracked\n");
    expectState(() => mergeMain(fx.dir), "merge-failed");
  } finally {
    fx.cleanup();
  }
});

test("a new conflict with no rule is reported as a conflict, merge left in progress", () => {
  const fx = repo();
  try {
    fx.git("checkout", "-q", "main");
    fx.write("a.txt", "main side\n");
    fx.commit("main edits a");
    fx.git("checkout", "-q", "work");
    fx.write("a.txt", "branch side\n");
    fx.commit("branch edits a");
    assert.throws(
      () => mergeMain(fx.dir),
      (e: unknown) =>
        e instanceof MergeConflictError && e.detail.conflicted === "a.txt",
    );
    assert.equal(readMergeState(fx.dir).state, "conflicted");
  } finally {
    fx.cleanup();
  }
});
