/**
 * Keyed fetch coalescer with trailing-refetch semantics.
 *
 * The house pattern for "N components all racing the same request should
 * produce one HTTP call" is a `Map<key, Promise<T>>` that a caller checks
 * before starting a fetch, and clears once it settles (a coalescing window,
 * not a result cache — see `load-history.ts`'s `inFlight` map for the
 * server-side sibling of this). `load()` here is exactly that.
 *
 * `refetch()` is the piece a plain in-flight map doesn't have: a caller
 * whose trigger means "the data just changed" (a file-change event, a WS
 * reconnect) rather than "I need the data". If nothing is in flight for the
 * key, it fetches immediately, same as `load()`. If a fetch for that key IS
 * in flight, joining it would risk handing the trigger a pre-change
 * snapshot — the in-flight fetch may have already read the old state. So
 * instead it attaches exactly one trailing fetch to run right after the
 * in-flight one settles, and every `refetch()` call that lands before the
 * trailing fetch *starts* coalesces into that same one (mirroring
 * `reconnect-refresh-gate.ts`'s trailing-edge coalescing) — all of them
 * resolve to the trailing fetch's result. A `refetch()` that lands after the
 * trailing fetch has already started attaches a fresh trailing fetch after
 * *that* one, so a change is never lost no matter how the triggers land.
 */

export interface FetchCoalescer<T> {
  /** Share an in-flight fetch for `key`, or start one via `fetcher`. */
  load: (key: string, fetcher: () => Promise<T>) => Promise<T>;
  /**
   * "The data behind `key` just changed." Fetches immediately if nothing is
   * in flight; otherwise attaches (or joins) exactly one trailing fetch to
   * run after the in-flight one settles, and resolves to that trailing
   * result.
   */
  refetch: (key: string, fetcher: () => Promise<T>) => Promise<T>;
}

interface Trailing<T> {
  fetcher: () => Promise<T>;
  result: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason: unknown) => void;
}

interface Entry<T> {
  promise: Promise<T>;
  /** At most one trailing fetch queued behind this entry's fetch. */
  trailing: Trailing<T> | null;
}

export function createFetchCoalescer<T>(): FetchCoalescer<T> {
  const entries = new Map<string, Entry<T>>();

  function start(key: string, fetcher: () => Promise<T>): Promise<T> {
    const entry: Entry<T> = { promise: fetcher(), trailing: null };
    entries.set(key, entry);
    void entry.promise.finally(() => {
      if (entries.get(key) === entry) entries.delete(key);
      // A refetch() that arrived while this fetch was in flight attached a
      // trailing request — run it now that the map slot is clear, so it
      // becomes the new current entry (and can itself grow a fresh trailing
      // request if another refetch() lands while it runs).
      const pending = entry.trailing;
      if (pending) {
        start(key, pending.fetcher).then(pending.resolve, pending.reject);
      }
    });
    return entry.promise;
  }

  function load(key: string, fetcher: () => Promise<T>): Promise<T> {
    const entry = entries.get(key);
    if (entry) return entry.trailing?.result ?? entry.promise;
    return start(key, fetcher);
  }

  function refetch(key: string, fetcher: () => Promise<T>): Promise<T> {
    const entry = entries.get(key);
    if (!entry) return start(key, fetcher);
    if (entry.trailing) return entry.trailing.result; // already coalescing into a pending trailing fetch
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason: unknown) => void;
    const result = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    entry.trailing = { fetcher, result, resolve, reject };
    return result;
  }

  return { load, refetch };
}
