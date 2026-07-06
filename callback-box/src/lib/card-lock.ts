/**
 * In-process per-file write serialization.
 *
 * This is the in-process counterpart to `file-lock.ts`. `file-lock.ts`
 * coordinates *across processes* (a JSON lock file + PID liveness);
 * `withCardLock` coordinates *within one Node process*, where there is no
 * other process to negotiate with — only concurrent async tasks racing on
 * the same file. The two solve different problems and don't compose: a
 * same-file read-modify-write inside one server process is a lost-update
 * bug that a cross-process file lock wouldn't even see (both racers are the
 * same PID). See `file-lock.ts`'s module comment for the full lock table.
 *
 * ## The hazard
 *
 * A read-modify-write on a card looks like:
 *
 *   const fields = parse(await readFile(path));   // read
 *   mutate(fields);                                // modify
 *   await writeFile(path, serialize(fields));      // write
 *
 * Two of these overlapping on the same `path` both read the pre-mutation
 * bytes, and whichever writes last silently discards the other's change.
 * `withCardLock` funnels every RMW for a given file through a per-file
 * promise chain so they run one-at-a-time.
 *
 * ## Usage
 *
 *   await withCardLock(fullPath, async () => {
 *     const fields = parse(await readFile(fullPath));
 *     mutate(fields);
 *     await writeFile(fullPath, serialize(fields));
 *   });
 *
 * Wrap the *entire* read-through-write span (including the git stage/commit
 * that follows, so a same-file mutation's commit can't interleave with the
 * next mutation's read). The lock is advisory: it only serializes callers
 * that opt in by going through `withCardLock` for that path — an unlocked
 * writer elsewhere still races. Route every RMW for a file through here.
 *
 * ## Key normalization
 *
 * The lock is keyed by `path.resolve(filePath)`, so the same file reached
 * via different spellings (relative vs absolute, `.`/`..` segments,
 * redundant separators) shares one lock. It does NOT resolve symlinks or
 * normalize case: `fs.realpath` would require the file to already exist
 * (an RMW may create it) and add an async stat to every acquisition, and
 * lowercasing would wrongly collapse distinct files on case-sensitive
 * filesystems (prod is Linux). Callers already pass a single canonical
 * `path.join(boxRoot, relPath)` spelling, so `resolve` covers the spellings
 * that actually occur; pass absolute paths.
 *
 * ## Reentrancy is forbidden — it deadlocks
 *
 * A locked `fn` that awaits `withCardLock` for the SAME key can never make
 * progress: the inner acquisition queues behind the outer chain's tail,
 * which only settles once the outer `fn` returns — which is blocked on the
 * inner. That is a silent hang. We detect it via an `AsyncLocalStorage` of
 * the keys the current async context holds and throw
 * `ReentrantCardLockError` instead of deadlocking. Do not nest
 * `withCardLock` on the same file; factor the shared RMW into one locked
 * function that its callers invoke without re-locking. (Locking a
 * *different* file from within a locked `fn` is fine.)
 *
 * ## Drain semantics
 *
 * Map entries are removed when the chain drains (compare-and-delete of the
 * tail promise), so the map holds only files with in-flight or queued work,
 * never a growing set of every file ever touched. A rejection in `fn`
 * propagates to that caller but does NOT poison the chain — the next queued
 * task runs regardless.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import * as path from "node:path";

/**
 * Thrown when a `withCardLock`-guarded function tries to re-acquire the
 * same file's lock from within itself. This would deadlock; we fail loudly
 * instead. It signals a bug at the call site (nested locking), not a
 * runtime condition to recover from.
 */
export class ReentrantCardLockError extends Error {
  readonly key: string;
  constructor(key: string) {
    super(
      `withCardLock re-entered for ${key} from within its own critical ` +
        "section — this would deadlock. Factor the shared read-modify-write " +
        "into one locked function instead of nesting withCardLock.",
    );
    this.name = "ReentrantCardLockError";
    this.key = key;
  }
}

/**
 * Tail of the promise chain per normalized path. The stored promise never
 * rejects (see below), so a failed task doesn't break serialization for the
 * queue behind it. An absent entry means "no work in flight" — the map only
 * holds files with active or queued tasks.
 */
const chains = new Map<string, Promise<void>>();

/**
 * The set of lock keys held by the current async context. Used only to
 * detect same-key reentrancy; carries no other state.
 */
const heldKeys = new AsyncLocalStorage<ReadonlySet<string>>();

/**
 * Run `fn` with exclusive access to `filePath` relative to other
 * `withCardLock` callers for the same (normalized) path. Serializes the
 * whole callback, not just the write. Returns `fn`'s result; rejects with
 * `fn`'s error (which does not stall the queue) or with
 * `ReentrantCardLockError` if `fn` is already holding this file's lock.
 */
export async function withCardLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  const key = path.resolve(filePath);

  const held = heldKeys.getStore();
  if (held?.has(key) === true) {
    throw new ReentrantCardLockError(key);
  }

  const nextHeld = new Set(held);
  nextHeld.add(key);

  const previous = chains.get(key) ?? Promise.resolve();
  // Run fn after the prior task settles (the tail never rejects, so the
  // single onFulfilled handler always fires). Track `key` as held for the
  // duration so a nested same-key acquisition is caught.
  const run = previous.then(() => heldKeys.run(nextHeld, fn));

  // The stored tail swallows fn's outcome so one failure can't poison the
  // chain for queued callers.
  const tail = run.then(
    () => {},
    () => {},
  );
  chains.set(key, tail);

  // Compare-and-delete: once this tail settles, drop the map entry ONLY if
  // nobody chained after us (the map still points at our tail). If a later
  // task appended, `chains.get(key)` is its newer tail and we leave it.
  void tail.then(() => {
    if (chains.get(key) === tail) {
      chains.delete(key);
    }
  });

  return run;
}

/**
 * Number of files with a live lock chain (in-flight or queued work).
 * Read-only introspection for tests and diagnostics — a drained map reports
 * 0. Exposes no state a caller could misuse, so it needs no flag gate.
 */
export function activeCardLockCount(): number {
  return chains.size;
}
