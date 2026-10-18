// # In-process per-card write serialization
//
// `withCardLock(path, fn)` funnels every read-modify-write for one file through
// a per-file promise chain, so two overlapping mutations on the same card can't
// both read the pre-mutation bytes and clobber each other's write. It is the
// in-process counterpart to the cross-process `file-lock.ts` — no lock file, no
// other process, just async tasks within one Node process.

import { test } from "tap";
import "agent-doctest/tap";
import {
  withCardLock,
  activeCardLockCount,
} from "../../src/lib/card-lock.js";
import { errorMessage, toError } from "../../src/shared/error-guards.js";

// A promise we resolve by hand, to hold a critical section open across an
// awaited yield so interleaving is deterministic (no wall-clock timers).
function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

// Flush the microtask/immediate queue so queued chain work and the
// drain-cleanup callback have run before we assert.
const tick = () => new Promise((r) => setImmediate(r));

// ## Serialization order
//
// A second acquisition for the same file waits until the first's callback fully
// completes — it does not start while the first still holds the lock:
void test("A second acquisition for the same file waits until the first's callback fully...", async (t) => {
  // doctest:L34
  const events: string[] = [];
  const gateA = deferred();

  // doctest:L37
  const pA = withCardLock("/box/todo.card", async () => {
    events.push("A:start");
    await gateA.promise;
    events.push("A:end");
  });
  const pB = withCardLock("/box/todo.card", async () => {
    events.push("B:start");
  });

  // doctest:L46
  await tick();
  t.check(events.join(","), "A:start");

  // doctest:L50
  gateA.resolve();
  await Promise.all([pA, pB]);
  t.check(events.join(","), "A:start,A:end,B:start");
});

// ## Key normalization — different spellings share one lock
//
// `path.resolve` collapses relative/`.`/`..`/redundant-separator spellings, so a
// file reached two ways still serializes:
void test("path.resolve collapses relative/./../redundant-separator spellings, so a file...", async (t) => {
  // doctest:L62
  const order: string[] = [];
  const gate = deferred();

  // doctest:L65
  const p1 = withCardLock("/box/x.card", async () => {
    order.push("1:start");
    await gate.promise;
    order.push("1:end");
  });
  const p2 = withCardLock("/box/sub/../x.card", async () => {
    order.push("2:start");
  });

  // doctest:L74
  await tick();
  t.check(order.join(","), "1:start");

  // doctest:L78
  gate.resolve();
  await Promise.all([p1, p2]);
  t.check(order.join(","), "1:start,1:end,2:start");
});

// ## Distinct files run concurrently
//
// Locks are per file; a lock on one card never blocks work on another:
void test("Locks are per file; a lock on one card never blocks work on another:", async (t) => {
  // doctest:L89
  const order: string[] = [];
  const gate = deferred();

  // doctest:L92
  const pa = withCardLock("/box/a.card", async () => {
    order.push("a:start");
    await gate.promise;
    order.push("a:end");
  });
  const pb = withCardLock("/box/b.card", async () => {
    order.push("b:start");
  });

  // doctest:L101
  await tick();
  t.check(
    // b did not queue behind a — it ran while a is still holding.
    order.join(","),
    "a:start,b:start",
  );

  // doctest:L106
  gate.resolve();
  await Promise.all([pa, pb]);
  t.check("done", "done");
});

// ## An error in the callback doesn't poison the chain
//
// The failing task's rejection reaches its own caller, but the next queued task
// still runs, and a normal callback's return value passes straight through:
void test("The failing task's rejection reaches its own caller, but the next queued task...", async (t) => {
  // doctest:L118
  const order: string[] = [];

  // doctest:L120
  const bad = withCardLock("/box/c.card", async () => {
    order.push("bad");
    throw new Error("boom");
  });
  const good = withCardLock("/box/c.card", async () => {
    order.push("good");
    return 42;
  });

  // doctest:L129
  const err = await bad.catch((e) => errorMessage(e));
  const value = await good;
  t.check([err, value, order.join(",")], [
    "boom",
    42,
    "bad,good",
  ]);
});

// ## Reentrancy is forbidden — it throws instead of deadlocking
//
// A callback that re-acquires the SAME file's lock from within itself can never
// progress (the inner acquisition queues behind the outer, which is waiting on
// the inner). Rather than hang silently, `withCardLock` throws
// `ReentrantCardLockError`:
void test("A callback that re-acquires the SAME file's lock from within itself can never...", async (t) => {
  // doctest:L147
  const outcome = await withCardLock("/box/d.card", async () => {
    return withCardLock("/box/d.card", async () => "inner")
      .then(() => "no-throw", (e) => toError(e).name);
  });
  t.check(outcome, "ReentrantCardLockError");
});

// Locking a *different* file from within a locked callback is fine — only
// same-key nesting deadlocks:
void test("Locking a different file from within a locked callback is fine — only same-ke...", async (t) => {
  // doctest:L159
  const out = await withCardLock("/box/e.card", async () => {
    const inner = await withCardLock("/box/f.card", async () => "inner-ok");
    return `outer-got:${inner}`;
  });
  t.check(out, "outer-got:inner-ok");
});

// ## Entries drain — the map doesn't leak
//
// The per-file chain is removed once it fully drains (compare-and-delete of the
// tail), so the map holds only files with active or queued work, never every
// file ever touched:
void test("The per-file chain is removed once it fully drains (compare-and-delete of the...", async (t) => {
  // doctest:L174
  await tick();
  t.check(activeCardLockCount(), 0);

  // doctest:L178
  const gate = deferred();
  const p = withCardLock("/box/drain.card", async () => { await gate.promise; });
  t.check(activeCardLockCount(), 1);

  // doctest:L183
  gate.resolve();
  await p;
  await tick();
  t.check(activeCardLockCount(), 0);
});
