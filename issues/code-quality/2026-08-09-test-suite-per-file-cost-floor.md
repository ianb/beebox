---
title: "Per-file fixed cost is ~12–13% of the suite — Node boot, tsx, loader, and a cold template box, paid 480 times"
workstream: test-selection
area: beebox
needs: [design]
labels: [testing, developer-experience]
filed-by: agent
discovered-in: worktree-test-selection — sized while planning change-based test selection
priority: important
---

> **Naming note (2026-10-18):** doctests (`*.doctest.md`) are now `.test.ts` files with `t.check`, in the same directory under the same base name, and `agent-doctest` is now `tap-check/` (`@ianbicking/tap-check`). See `beebox/docs/implemented-plans/retire-doctest.md`.

Every test file pays a fixed cost before it runs a single assertion: Node
process boot, the tsx import hook, the doctest loader (removed 2026-10-18 with the doctest format), and — for the 37 files
that call `makeTestServer()` — a cold template-box build.

The measured figures come from the profiling in
[run less of the full suite](../closed/exploration/2026-08-08-run-less-of-the-test-suite.md)
(`## Research (2026-08-08)`; loaded-machine caveat applies to all of them):

- Cold template-box build: **1,023 ms**. Warm clones after it: 387 ms mean,
  332 ms median. Cleanup: 69.6 ms.
- The fastest file in the whole run is
  `test/core/external-url-fetch.doctest.md` (moved to `beebox/test/core/external/url-check/fetch.test.ts`) at **0.828 s**, which is close to
  pure floor — it does almost no work.
- At roughly 0.9 s × 480 files, the floor is about **430 file-seconds against a
  3,374.8 file-second aggregate: 12–13%**.

## Why this is worth its own item

It is the second lever on suite cost, and it has two properties the first lever
does not:

- **It speeds up the full suite**, not just the selected subset. Everyone pays
  the floor on every run, including the nightly and every `/finish`.
- **It carries no correctness risk.** Making a file start faster cannot cause a
  regression to ship. Change-based selection can, which is why the two were
  deliberately kept apart rather than planned together.

## What to look at

- **The per-process template box.** `test/helpers/test-server.ts` already builds
  one initialized template per test process and `fs.cp()`-clones it per
  `makeTestServer()` call — the largest safe redundancy is already gone. What
  remains is that each of the 37 files pays the ~1 s cold build once. A
  persistent immutable template built once per *run* and shared read-only across
  processes could remove most of that, at the cost of managing a shared artifact
  and its lifetime. The prior research flagged this as plausible but secondary.
- **Node + tsx + loader startup.** The CLI already bundles for exactly this
  reason — `scripts/build-cli.mjs:1-3`: *"Bundles the CLI … for fast cold starts
  — collapsing our ~hundreds of source modules into one file removes the
  per-module ESM loader-hook overhead that dominates tsx startup."* Whether the
  same trick can help test processes (a prebuilt transform cache, or bundling
  the common helper graph) is unexplored.
- **`commitAll()` and `makeTmpBox({ git: true })`** still spawn git
  synchronously. The profiling did not separate those from test bodies, so git
  may still be a hot-path cost even though server boot no longer initializes a
  repo each time.

## Constraint

Do not treat this as a substitute for a green quiet-machine baseline. Every
number above is an upper bound from a heavily loaded machine (load average ~18,
~37 agent processes live). The first real measurement should be a green full run
on a quiet machine — see the research section's conclusion, which says the same
thing.

Related: [change-based test selection](../../beebox/docs/plans/change-based-test-selection.md)
sizes this lever in its NOT-in-scope section and measures itself against it in
Track 0 — if selection's realistic saving turns out comparable to this, this work
is the better investment and selection should be shelved.

## Update (2026-10-12)

The suite is now 1,016 test files. The sum of per-file medians over the
hourly full runs since 2026-10-01 is 4,654 s: a mean of 4.6 s per file, and
about 13 minutes at 6 jobs. 190 source files are imported by 300 or more
tests, so an edit to one of them selects about half of the suite for
`test:changed` (about 9.5 minutes). See the change-based-test-selection
plan, "Revision 2026-10-12 — broad selections".

## Update (2026-10-23): tsx cache listing, and the floor by layer

`pnpm perf:test-floor` (new, worktree-perf-easy-wins) times one test process
layer by layer, with the node arguments from `.taprc`.

- **tsx cache listing (fixed, a38dbc807).** tsx 4.23.1 listed its shared
  transform cache (`$TMPDIR/tsx-<uid>`) at the start of every process. The
  directory held about 166,000 entries (1.3 GB, about 33,000 new a day across
  worktrees), so each tsx process spent about 470 ms there. tsx 4.23.15 probes
  by file name. Same cache, medians of 7: the floor file
  (`test/core/external/url-check/fetch.test.ts`) went from 970 to 300 ms;
  `test/webapp/server-root.healthz-engine-version.test.ts` from 3.70 to 2.83 s.
  At about 0.47 s × 1,016 files the saving is about 480 file-seconds of the
  4,654 s aggregate (about 10%), before counting child CLI processes.
- **React Compiler hook (fixed, 721a78d8e).** The hook imported Babel and
  esbuild in every process; they now load on the first cache miss. The preload
  went from 170 to 100 ms.

The floor after both, load average about 17: `node` 29 ms, tsx 59 ms, all
`.taprc` preloads 313 ms, a one-assertion tap test 322 ms. What remains:

- tap's own import (through `@ianbicking/tap-check/tap`, which loads
  `@tapjs/core`): about 120 ms. Every tap test needs it.
- The React Compiler hook's loader thread: about 50 ms. `module.register`
  runs hooks on a separate thread, and every module load then crosses to it.
  Node 24's in-thread `module.registerHooks` would remove the thread, but
  needs synchronous transforms (Babel `transformSync`, esbuild
  `transformSync`). Not measured.
- The cold template box (`makeTestServer`), unchanged from the 2026-08 figures.
- tsx's cache expiry walk. tsx 4.23.15 still walks its whole cache directory
  to expire entries older than about 8 days, in the background of any process
  that writes a new cache entry. At 174,744 entries the walk costs about
  355 ms of main-thread CPU. After an edit, each test process that transforms
  the changed file pays it. Pruning entries older than one or two days every
  day (the `disk-hygiene` schedule prunes weekly) would cut the walk to about
  a quarter; not done, because it changes that schedule's cadence.
