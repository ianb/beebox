import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { execa } from "execa";

const REPO_ROOT = join(import.meta.dirname, "..");

// The router keeps its own log and pidfiles beside the per-worktree ones. A
// sweep that removed them took the workstreams app's log away mid-run, so the
// "exhibits unavailable" page pointed at a file that no longer existed.
void test("sweep leaves the router's own logs and pidfiles alone", async (t) => {
  const state = mkdtempSync(join(tmpdir(), "workstreams-sweep-"));
  t.after(() => rmSync(state, { recursive: true, force: true }));
  const worktreeRoot = join(state, "worktrees");
  mkdirSync(worktreeRoot);
  mkdirSync(join(state, "logs"));
  mkdirSync(join(state, "pids"));
  for (const name of ["router", "workstreams-app", "main", "gone-worktree"]) {
    writeFileSync(join(state, "logs", `${name}.log`), "");
  }
  for (const name of ["_workstreams-app", "main", "gone-worktree"]) {
    writeFileSync(join(state, "pids", `${name}.json`), "{}");
  }

  const { stdout } = await execa(join(REPO_ROOT, "bin/workstreams"), ["sweep", "--dry-run"], {
    cwd: REPO_ROOT,
    env: { BBX_STATE_DIR: state, BBX_WORKTREE_ROOT: worktreeRoot },
  });
  const orphans = stdout.split("\n").filter((line) => /orphan (log|pidfile):/.test(line)).map((line) => line.trim());

  assert.deepEqual(orphans, [
    `orphan log: ${join(state, "logs", "gone-worktree.log")}`,
    `orphan pidfile: ${join(state, "pids", "gone-worktree.json")}`,
  ]);
});
