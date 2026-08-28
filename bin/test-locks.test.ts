// Tests for the test-run semaphore: staleness, slot choice, the careful
// barrier, and the file-level acquire/release it drives. Run with:
//   node --import tsx --test bin/test-locks.test.ts
//
// A `.test.ts` rather than the doctest bin/CLAUDE.md prescribes, because the
// semaphore sits in front of `pnpm test` itself: a doctest of it would have to
// run under the very suite whose slots it hands out.

import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  CAREFUL_WAITING,
  LOCK_STALE_MS,
  SLOTS,
  acquire,
  chooseSlots,
  isLockStale,
  parseLockRecord,
  type LockRecord,
  type SlotState,
  type StaleProbe,
} from "./test-locks.js";

const NOW = Date.parse("2026-08-25T12:00:00.000Z");
const BOOT = Date.parse("2026-08-25T08:00:00.000Z");

const lock = (over?: Partial<LockRecord>): LockRecord => ({
  pid: 111,
  branch: "worktree-x",
  at: new Date(NOW - 60_000).toISOString(),
  bootTimeMs: BOOT,
  ...over,
});

const probe = (over?: Partial<StaleProbe>): StaleProbe => ({
  nowMs: NOW,
  bootTimeMs: BOOT,
  isProcessAlive: () => true,
  ...over,
});

// ── staleness ───────────────────────────────────────────────────────────────

test("a lock whose pid is gone is stale", () => {
  assert.equal(isLockStale(lock(), probe({ isProcessAlive: () => false })), true);
});

test("a live, recent, this-boot lock is held", () => {
  assert.equal(isLockStale(lock(), probe()), false);
});

test("a lock written before this boot is stale even with a live pid", () => {
  // The reboot case pid liveness alone gets wrong: the kernel hands the dead
  // runner's pid to something unrelated and the slot is held forever.
  const held = lock({ at: new Date(BOOT - 1000).toISOString(), bootTimeMs: null });
  assert.equal(isLockStale(held, probe()), true);
});

test("a lock stamped with a different boot is stale", () => {
  assert.equal(isLockStale(lock({ bootTimeMs: BOOT - 99_999 }), probe()), true);
});

test("a lock older than the stale window is debris whatever its pid says", () => {
  const held = lock({ at: new Date(NOW - LOCK_STALE_MS - 1).toISOString() });
  assert.equal(isLockStale(held, probe()), true);
});

test("with boot time unknown, age alone carries the reclaim", () => {
  const old = lock({ at: new Date(NOW - LOCK_STALE_MS).toISOString(), bootTimeMs: null });
  assert.equal(isLockStale(old, probe({ bootTimeMs: null })), true);
  assert.equal(isLockStale(lock({ bootTimeMs: null }), probe({ bootTimeMs: null })), false);
});

test("an unparseable timestamp is stale, never held forever", () => {
  assert.equal(isLockStale(lock({ at: "not a date" }), probe()), true);
});

// ── slot choice ─────────────────────────────────────────────────────────────

const states = (holders: Array<LockRecord | null>): SlotState[] =>
  SLOTS.map((slot, i) => ({ slot, holder: holders[i] ?? null }));

test("an ordinary run takes one free slot and counts the other as concurrency", () => {
  const choice = chooseSlots({ tier: "ordinary", states: states([lock(), null]), carefulWaiting: null });
  assert.deepEqual(choice.take, ["slot-1"]);
  assert.equal(choice.concurrency, 1);
});

test("an ordinary run with both slots held waits, naming a holder", () => {
  const choice = chooseSlots({
    tier: "ordinary",
    states: states([lock(), lock({ pid: 222 })]),
    carefulWaiting: null,
  });
  assert.deepEqual(choice.take, []);
  assert.equal(choice.blockedBy?.pid, 111);
  assert.equal(choice.concurrency, 2);
});

test("a careful run takes BOTH slots, or none", () => {
  const free = chooseSlots({ tier: "careful", states: states([null, null]), carefulWaiting: null });
  assert.deepEqual(free.take, ["slot-0", "slot-1"]);
  const oneHeld = chooseSlots({ tier: "careful", states: states([lock(), null]), carefulWaiting: null });
  assert.deepEqual(oneHeld.take, [], "one free slot is not enough for an exclusive run");
});

test("a queued careful run is a barrier: an ordinary run does not take the free slot", () => {
  // Without this, a steady stream of iteration runs starves the careful run
  // forever — each one grabs the slot the previous one just freed.
  const choice = chooseSlots({
    tier: "ordinary",
    states: states([null, null]),
    carefulWaiting: lock({ pid: 333, branch: "worktree-y" }),
  });
  assert.deepEqual(choice.take, []);
  assert.equal(choice.blockedBy?.pid, 333);
});

test("the barrier does not block the careful run itself", () => {
  const choice = chooseSlots({
    tier: "careful",
    states: states([null, null]),
    carefulWaiting: lock({ pid: 333 }),
  });
  assert.deepEqual(choice.take, ["slot-0", "slot-1"]);
});

// ── lock file parsing ───────────────────────────────────────────────────────

test("a half-written or wrong-shaped lock file parses as nothing", () => {
  assert.equal(parseLockRecord('{"pid":1,"branch":'), null);
  assert.equal(parseLockRecord('{"pid":"1","branch":"b","at":"x","bootTimeMs":null}'), null);
  assert.equal(parseLockRecord("[]"), null);
});

test("a lock file without a boot time reads as boot-unknown", () => {
  assert.deepEqual(parseLockRecord('{"pid":7,"branch":"b","at":"2026-08-25T12:00:00.000Z"}'), {
    pid: 7,
    branch: "b",
    at: "2026-08-25T12:00:00.000Z",
    bootTimeMs: null,
  });
});

// ── acquire / release against a real directory ──────────────────────────────

function withDir(fn: (dir: string) => Promise<void>): () => Promise<void> {
  return async () => {
    const dir = mkdtempSync(join(tmpdir(), "test-locks-"));
    try {
      await fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

/** A lock file held by a pid that is alive but is not this process. */
function writeForeignLock(path: string): void {
  const record: LockRecord = {
    pid: process.ppid,
    branch: "worktree-other",
    at: new Date().toISOString(),
    bootTimeMs: null,
  };
  writeFileSync(path, JSON.stringify(record));
}

test(
  "an ordinary run takes a slot and gives it back",
  withDir(async (dir) => {
    const held = await acquire({ dir, tier: "ordinary", branch: "worktree-x" });
    assert.equal(held.concurrency, 0);
    assert.deepEqual(readdirSync(dir), ["slot-0"]);
    assert.equal(parseLockRecord(readFileSync(join(dir, "slot-0"), "utf-8"))?.pid, process.pid);
    held.release();
    assert.deepEqual(readdirSync(dir), []);
  }),
);

test(
  "a second ordinary run takes the other slot and sees the first",
  withDir(async (dir) => {
    writeForeignLock(join(dir, "slot-0"));
    const held = await acquire({ dir, tier: "ordinary", branch: "worktree-x" });
    assert.equal(held.concurrency, 1);
    assert.deepEqual(readdirSync(dir).toSorted(), ["slot-0", "slot-1"]);
    held.release();
  }),
);

test(
  "debris is reclaimed rather than waited on",
  withDir(async (dir) => {
    // Both slots "held" by a run that died two hours ago.
    for (const slot of SLOTS) {
      writeFileSync(
        join(dir, slot),
        JSON.stringify({
          pid: process.ppid,
          branch: "worktree-dead",
          at: new Date(Date.now() - LOCK_STALE_MS - 1).toISOString(),
          bootTimeMs: null,
        }),
      );
    }
    const held = await acquire({ dir, tier: "careful", branch: "worktree-x" });
    assert.equal(held.concurrency, 0, "stale holders are not live runs");
    held.release();
  }),
);

test(
  "a careful run queues the barrier, then takes both slots when the machine clears",
  withDir(async (dir) => {
    writeForeignLock(join(dir, "slot-0"));
    const acquired = acquire({ dir, tier: "careful", branch: "worktree-careful" });
    await waitFor(() => readdirSync(dir).includes(CAREFUL_WAITING));

    // While that marker stands, an ordinary run must not take the free slot.
    const ordinary = acquire({ dir, tier: "ordinary", branch: "worktree-x" });
    assert.equal(await settled(ordinary), false, "ordinary run queued behind the barrier");

    rmSync(join(dir, "slot-0"));
    const held = await acquired;
    assert.deepEqual(readdirSync(dir).toSorted(), ["slot-0", "slot-1"], "barrier cleared on acquire");
    held.release();

    const after = await ordinary;
    after.release();
  }),
);

/** A polled condition that never became true within the test's budget. */
class ConditionNeverHeldError extends Error {
  constructor() {
    super("condition never held");
    this.name = "ConditionNeverHeldError";
  }
}

/** Poll until a condition holds, so a test never depends on the poll interval. */
async function waitFor(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new ConditionNeverHeldError();
}

/** Did this promise resolve within a couple of poll intervals? */
async function settled(promise: Promise<unknown>): Promise<boolean> {
  const pending = Symbol("pending");
  const timer = new Promise<typeof pending>((resolve) => setTimeout(() => resolve(pending), 2200));
  return (await Promise.race([promise, timer])) !== pending;
}
