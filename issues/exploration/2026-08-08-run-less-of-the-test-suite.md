---
title: "Run less of the full suite — map changes to the tests that could break"
area: callback-box
needs: [design]
labels: [testing, developer-experience]
---

Every verification runs everything. `/finish` runs the full suite on each land,
agents run it before committing, and a re-run after a post-green fix runs it
again. Most of that is provably irrelevant to the diff — a frontend tweak does
not need the connector doctests — but we have no way to know which part *is*
relevant, so we pay for all of it every time.

Scale of the thing (`callback-box/.taprc`, `package.json:52`):

- **480 `.doctest.md` files** plus 2 `.test.ts` under `callback-box/test/`, and
  19 `.test.ts` under `bin/` — roughly 2231 assertions.
- `jobs: 6` (deliberately half the cores: `makeTestServer()` boots a full
  Fastify app plus two synchronous `git` spawns, and at full core-count
  parallelism the thundering herd thrashes the machine into non-deterministic
  SIGALRM timeouts).
- `timeout: 300` per file, raised because **a single route file is ~80s solo**.

So the suite is slow for structural reasons that won't be tuned away, and the
cost lands on the tightest loop we have.

## Why this is research, not a task

The obvious approach — "map source files to the tests that exercise them" — has
several real implementations with different trade-offs, and picking wrong is
worse than not doing it, because a selection bug shows up as a regression that
shipped, not as a failing test. Worth surveying before designing:

- **Coverage-based selection.** Run the suite once with coverage, record which
  source files each test file touched, then select tests whose touched files
  appear in the diff. Language-agnostic and precise. `tap --coverage` already
  exists (coverage is merely disabled by default here — see the `.taprc`
  rationale), so the raw capability is present.
- **Import-graph selection.** What Jest (`--onlyChanged`/`--changedSince`) and
  Vitest (`--changed`) do: walk the static import graph from each test. Cheaper
  to maintain, but blind to runtime coupling — and our doctests reach a lot of
  behavior through a booted server rather than a direct import.
- **Affected-package graphs.** Nx/Turborepo/Bazel style, at package granularity.
  Coarse, but this is a monorepo with real package boundaries
  (`callback-box`/`agent-doctest`/`bin`/`canvas-loop`), so a cheap first cut
  might just be "which packages did the diff touch."
- **Test Impact Analysis** as a named industry practice (Microsoft shipped this
  for .NET/Azure DevOps) — worth reading for how they handle the safety problem
  of a stale map.

## What's specific to us

- **We own the runner.** `agent-doctest/` is ours, so per-doctest instrumentation
  is available in a way it wouldn't be with a third-party runner. That may be the
  decisive advantage.
- **Doctests are markdown**, so "which source does this test import" isn't a
  static-analysis freebie — it means analyzing the code blocks, or measuring at
  runtime.
- **Subprocess attribution is hard.** Doctests spawn servers and `git`; coverage
  that only sees the parent process will under-attribute.
- **Prior art in-repo:** `/finish`'s docs-only fast path already does a crude
  version of this — if every changed path is under a `docs/` dir and none is a
  `.doctest.md`, skip the whole verification tier. It works because the rule is
  conservative and path-precise. That's the shape to generalize.

## Constraints any design must respect

- **Wrong selection = a missed regression.** Whatever we build needs a safety
  net: full suite at some gate (pre-merge, or on `main`), selected suite on the
  iteration loop. Never selected-only everywhere.
- **A stale map fails open, not closed.** If the map doesn't know about a file,
  it must run more tests, not fewer.
- Measure first. Nobody has profiled where the time actually goes; it may be
  concentrated in a handful of route files, in which case targeted fixes to
  those could beat a selection system entirely.

Related: [flaky login-redirect doctest](../bugs/2026-07-29-flaky-login-redirect-doctest.md)
(parallel-load flakes are the same contention this would reduce).
