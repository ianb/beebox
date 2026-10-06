// The machine-wide full-run lock, against a real directory, and the rule that
// decides which commands take it. Run with:
//   node --import tsx --test bin/test-full-run-lock.test.ts

import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { acquireFullRun, FULL_RUN, type LockRecord } from "./test-locks.js";
import { runsWholeTier } from "./test-tiers.js";

function withDir(fn: (dir: string) => Promise<void>): () => Promise<void> {
  return async () => {
    const dir = mkdtempSync(join(tmpdir(), "full-run-lock-"));
    try {
      await fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

function writeLock(path: string, overrides: Partial<LockRecord>): void {
  const record: LockRecord = {
    pid: process.ppid,
    branch: "worktree-other",
    at: new Date().toISOString(),
    bootTimeMs: null,
    ...overrides,
  };
  writeFileSync(path, JSON.stringify(record));
}

test(
  "a free lock is claimed and released",
  withDir(async (dir) => {
    const claim = await acquireFullRun({ dir, branch: "full-suite", waitMs: 0 });
    assert.notEqual(claim.held, null);
    assert.deepEqual(readdirSync(dir), [FULL_RUN]);
    claim.held?.release();
    assert.deepEqual(readdirSync(dir), []);
  }),
);

test(
  "a held lock defers immediately at waitMs 0, naming the holder",
  withDir(async (dir) => {
    writeLock(join(dir, FULL_RUN), {});
    const claim = await acquireFullRun({ dir, branch: "full-suite", waitMs: 0 });
    assert.equal(claim.held, null);
    assert.equal(claim.blockedBy?.branch, "worktree-other");
    assert.deepEqual(readdirSync(dir), [FULL_RUN], "the holder's lock is untouched");
  }),
);

test(
  "a lock whose process is gone is debris and is reclaimed",
  withDir(async (dir) => {
    writeLock(join(dir, FULL_RUN), { at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString() });
    const claim = await acquireFullRun({ dir, branch: "full-suite", waitMs: 0 });
    assert.notEqual(claim.held, null);
    claim.held?.release();
  }),
);

test(
  "a waiting caller gives up at its budget rather than waiting forever",
  withDir(async (dir) => {
    writeLock(join(dir, FULL_RUN), {});
    const started = Date.now();
    const claim = await acquireFullRun({ dir, branch: "worktree-x", waitMs: 1200 });
    assert.equal(claim.held, null);
    assert.ok(Date.now() - started < 5000);
  }),
);

const TAPRC = ["test/a.doctest.md", "test/b.doctest.md"];

test("only a bare tap that names no file is a whole-tier run", () => {
  const base = { taprcFiles: TAPRC, careful: [], isFile: () => false };
  assert.equal(runsWholeTier({ ...base, command: ["tap"] }), true);
  assert.equal(runsWholeTier({ ...base, command: ["tap", "-j1"] }), true);
  assert.equal(runsWholeTier({ ...base, command: ["tap", "test/a.doctest.md"] }), false);
  assert.equal(runsWholeTier({ ...base, command: ["echo", "hi"] }), false);
});
