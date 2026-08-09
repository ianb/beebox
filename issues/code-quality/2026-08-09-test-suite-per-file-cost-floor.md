---
title: "Per-file fixed cost is ~12–13% of the suite — Node boot, tsx, loader, and a cold template box, paid 480 times"
area: callback-box
needs: [design]
labels: [testing, developer-experience]
filed-by: agent
discovered-in: worktree-test-selection — sized while planning change-based test selection
---

Every test file pays a fixed cost before it runs a single assertion: Node
process boot, the tsx import hook, the doctest loader, and — for the 37 files
that call `makeTestServer()` — a cold template-box build.

The measured figures come from the profiling in
[run less of the full suite](../exploration/2026-08-08-run-less-of-the-test-suite.md)
(`## Research (2026-08-08)`; loaded-machine caveat applies to all of them):

- Cold template-box build: **1,023 ms**. Warm clones after it: 387 ms mean,
  332 ms median. Cleanup: 69.6 ms.
- The fastest file in the whole run is
  `test/core/external-url-fetch.doctest.md` at **0.828 s**, which is close to
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

Related: [change-based test selection](../../callback-box/docs/plans/change-based-test-selection.md)
sizes this lever in its NOT-in-scope section and measures itself against it in
Track 0 — if selection's realistic saving turns out comparable to this, this work
is the better investment and selection should be shelved.
