// Tests for mobile-contract-check.ts's merge handling, against a throwaway git
// repo. Run with:
//   node --import tsx --test bin/mobile-contract-check.test.ts
// (or `pnpm test` at the repo root, which runs every bin/*.test.ts this way).

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { stagedFiles } from "./mobile-contract-check.js";

function git(root: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/**
 * A repo whose `main` changed `anchor.ts` after `feature` branched, with
 * `feature` checked out and `main` merged in but not yet committed.
 */
function repoMidMerge(): string {
  const root = mkdtempSync(join(tmpdir(), "mobile-contract-"));
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "Test");
  git(root, "config", "commit.gpgsign", "false");
  writeFileSync(join(root, "anchor.ts"), "one\n");
  writeFileSync(join(root, "other.ts"), "one\n");
  git(root, "add", ".");
  git(root, "commit", "-q", "--no-verify", "-m", "base");
  git(root, "checkout", "-q", "-b", "feature");
  writeFileSync(join(root, "other.ts"), "feature\n");
  git(root, "commit", "-q", "--no-verify", "-am", "feature edit");
  git(root, "checkout", "-q", "main");
  writeFileSync(join(root, "anchor.ts"), "main\n");
  git(root, "commit", "-q", "--no-verify", "-am", "main edit");
  git(root, "checkout", "-q", "feature");
  git(root, "merge", "-q", "--no-commit", "--no-ff", "main");
  return root;
}

test("a file changed only by the merged branch is not this commit's change", () => {
  const root = repoMidMerge();
  try {
    assert.equal(git(root, "diff", "--cached", "--name-only").trim(), "anchor.ts");
    assert.deepEqual(stagedFiles(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an edit made during the merge counts", () => {
  const root = repoMidMerge();
  try {
    writeFileSync(join(root, "anchor.ts"), "resolved\n");
    git(root, "add", "anchor.ts");
    assert.deepEqual(stagedFiles(root), ["anchor.ts"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("outside a merge every staged file counts", () => {
  const root = repoMidMerge();
  try {
    git(root, "merge", "--abort");
    writeFileSync(join(root, "anchor.ts"), "plain\n");
    git(root, "add", "anchor.ts");
    assert.deepEqual(stagedFiles(root), ["anchor.ts"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
