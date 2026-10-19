// # fetch-coalescer — keyed in-flight coalescing with a trailing refetch
//
// `createFetchCoalescer` (`lib/fetch-coalescer.ts`) backs `AgentViewRenderer`'s
// module-level cards cache: every bound card visible in a chat mounts its own
// renderer, and a WS reconnect fires all their `onConnect`s in the same tick —
// without coalescing that was 56 identical `/api/views/:slug/cards` GETs in one
// second on prod. `load()` is the coalescing half. `refetch()` is for a trigger
// that means "the data just changed" (a file-change event, a reconnect): if a
// fetch for the key is already in flight, joining it risks handing the trigger
// a pre-change snapshot, so it schedules a trailing fetch instead.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { createFetchCoalescer } from "../../src/lib/fetch-coalescer.js";

// A manually-resolvable promise, so a test can control exactly when a
// "fetch" settles relative to other calls.
function makeDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

// ## Concurrent `load()` calls for the same key share one fetch
void test("Concurrent `load()` calls for the same key share one fetch", async (t) => {
  // doctest:L27
  let fetchCount = 0;
  const coalescer = createFetchCoalescer<string>();
  const fetcher = async () => { fetchCount += 1; return "value"; };

  // doctest:L31
  const [a, b, c] = await Promise.all([
    coalescer.load("k", fetcher),
    coalescer.load("k", fetcher),
    coalescer.load("k", fetcher),
  ]);
  t.check({ fetches: fetchCount, values: [a, b, c] }, { fetches: 1, values: ["value", "value", "value"] });

  // A caller arriving after it settles starts a fresh fetch — this is a
  // coalescing window, not a result cache:

  // doctest:L47
  const after = await coalescer.load("k", fetcher);
  t.check({ fetches: fetchCount, value: after }, { fetches: 2, value: "value" });
});

// ## Different keys never coalesce with each other
void test("Different keys never coalesce with each other", async (t) => {
  // doctest:L58
  let fetchCount2 = 0;
  const coalescer2 = createFetchCoalescer<string>();
  const [x, y] = await Promise.all([
    coalescer2.load("a", async () => { fetchCount2 += 1; return "A"; }),
    coalescer2.load("b", async () => { fetchCount2 += 1; return "B"; }),
  ]);
  t.check({ fetches: fetchCount2, values: [x, y] }, { fetches: 2, values: ["A", "B"] });
});

// ## `refetch()` while nothing is in flight fetches immediately
void test("`refetch()` while nothing is in flight fetches immediately", async (t) => {
  // doctest:L74
  let fetchCount3 = 0;
  const coalescer3 = createFetchCoalescer<string>();
  const result = await coalescer3.refetch("k", async () => { fetchCount3 += 1; return "fresh"; });
  t.check({ fetches: fetchCount3, value: result }, { fetches: 1, value: "fresh" });
});

// ## `refetch()` mid-flight never returns the stale in-flight snapshot
//
// The scenario Codex flagged: an in-flight `load()` snapshots the OLD state; a
// `file-change` event fires `refetch()` before that settles. `refetch()` must
// resolve to a fetch that started *after* the trigger, not the one already
// under way.
void test("The scenario Codex flagged:", async (t) => {
  // doctest:L89
  let calls = 0;
  const coalescer4 = createFetchCoalescer<string>();
  const first = makeDeferred<string>();
  const second = makeDeferred<string>();
  const fetchers = [
    () => { calls += 1; return first.promise; },
    () => { calls += 1; return second.promise; },
  ];
  const fetcher4 = () => fetchers[calls]!();

  // doctest:L99
  // A load starts and is still in flight (nothing resolved yet).
  const loadPromise = coalescer4.load("k", fetcher4);

  // doctest:L102
  // The real edit lands: a trigger fires refetch() while that load is still
  // in flight.
  const refetchPromise = coalescer4.refetch("k", fetcher4);
  t.check(calls, 1);

  // The in-flight fetch settling with the stale value does NOT resolve the
  // refetch — a second fetch starts only once the first settles:

  // doctest:L113
  first.resolve("stale");
  await loadPromise;
  t.check(calls, 2);

  // doctest:L120
  second.resolve("fresh");
  const refetched = await refetchPromise;
  t.check(refetched, "fresh");
});

// ## Several triggers while one fetch is in flight coalesce into ONE trailing fetch
void test("Several triggers while one fetch is in flight coalesce into ONE trailing fetch", async (t) => {
  // doctest:L129
  let calls2 = 0;
  const coalescer5 = createFetchCoalescer<string>();
  const inFlight = makeDeferred<string>();
  const trailingResult = makeDeferred<string>();
  const fetcher5 = () => {
    calls2 += 1;
    return calls2 === 1 ? inFlight.promise : trailingResult.promise;
  };

  // doctest:L138
  coalescer5.load("k", fetcher5);
  const r1 = coalescer5.refetch("k", fetcher5);
  const r2 = coalescer5.refetch("k", fetcher5);
  const r3 = coalescer5.refetch("k", fetcher5);
  t.check(calls2, 1);

  // doctest:L147
  inFlight.resolve("stale");
  await new Promise((r) => setTimeout(r, 0));
  t.check(calls2, 2);

  // doctest:L154
  trailingResult.resolve("fresh");
  const [v1, v2, v3] = await Promise.all([r1, r2, r3]);
  t.check([v1, v2, v3], ["fresh", "fresh", "fresh"]);
});

// ## A `refetch()` that lands after a trailing fetch has already started schedules another one
//
// Triggers don't get lost even if they keep arriving faster than fetches
// settle: once the trailing fetch is itself running, it's the new "in flight"
// entry, and a further `refetch()` attaches behind IT.
void test("Triggers don't get lost even if they keep arriving faster than fetches settle:", async (t) => {
  // doctest:L167
  let calls3 = 0;
  const coalescer6 = createFetchCoalescer<string>();
  const gen1 = makeDeferred<string>();
  const gen2 = makeDeferred<string>();
  const gen3 = makeDeferred<string>();
  const gens = [gen1, gen2, gen3];
  const fetcher6 = () => { const d = gens[calls3]!; calls3 += 1; return d.promise; };

  // doctest:L175
  coalescer6.load("k", fetcher6);
  coalescer6.refetch("k", fetcher6); // schedules trailing #1
  gen1.resolve("gen1"); // trailing #1 starts
  await new Promise((r) => setTimeout(r, 0));
  t.check(calls3, 2);

  // doctest:L184
  const r = coalescer6.refetch("k", fetcher6); // trailing #1 is running; schedule trailing #2 behind it
  gen2.resolve("gen2"); // trailing #1 settles, trailing #2 starts
  await new Promise((resolve) => setTimeout(resolve, 0));
  t.check(calls3, 3);

  // doctest:L192
  gen3.resolve("gen3");
  const final = await r;
  t.check(final, "gen3");
});
