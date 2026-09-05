---
title: "The post-commit background URL check can spin at 90% CPU for hours; 82 orphans were pinning a 16 GB machine"
workstream: unattached
area: beebox
priority: important
labels: [hooks, performance]
filed-by: agent
discovered-by: Ian
discovered-in: main session — "where is memory going?"
---

The box post-commit hook (`src/core/install-validation-hooks.ts`,
`postCommitBlock`) launches `bbx validate --urls --urls-since HEAD~1`
detached in the background on every commit, unbounded. On 2026-09-05 the
machine had **82** of them alive, parented to launchd, each 1 to 4 hours
old, each at ~90% CPU, ~40 MB resident and more compressed — load average
42 on a 16 GB laptop with 12.6 GB of swap in use, and the harness killing
other work for memory. Killing them dropped the load to 20 and freed 4 GB
of swap within a minute.

What is known:

- Every one had an **empty** `.beebox/url-check.log`: the process never got
  as far as printing a report.
- `sample` showed the main thread inside `MicrotaskQueue::RunMicrotasks`
  the whole time — a synchronous JS spin, not a network wait (the network
  path has a 10 s timeout per request, `url-fetch.ts`). A timer-based
  deadline inside the process would not fire either.
- Both the main checkout's `beebox/dist/cli.mjs` and the
  `box-layout-criteria` worktree's were represented. They accumulated during
  the hours that workstream was migrating box layouts and running suites
  (`~/src/boxes/test1` itself changed to the `_content`/`_config` layout at
  03:38), so the likely trigger is a box whose layout, cwd, or git state
  changed under the check — a fixture box deleted mid-run, or a box root the
  new layout resolves differently. Not confirmed.
- Run by hand afterwards on the migrated test1 the same command finishes in
  under 2 s with "Checked 0 external URL(s)".

Two fixes, both wanted:

1. **Bound it.** A detached background job with no deadline is a leak by
   construction (nothing retries or runs forever — a week is the outside
   bound for anything, minutes for this). The bound has to be *outside* the
   Node process, since the spin starves timers: the hook wraps the check in a
   killer (`( cmd & pid=$!; ( sleep 600; kill $pid ) & wait $pid )`, or
   `timeout` where present) and the check refuses to start when another
   instance for the same box is already running.
2. **Find the spin.** Reproduce under the layout workstream's conditions
   (`bin/browse` is irrelevant; this is CLI): run the check against a box
   fixture while it is deleted or re-laid-out, with `--cpu-prof`, and read
   the hot frame. `urlSetsForMode` (`git grep` at `HEAD~1` and the working
   tree), `referrersOf`, and `extractExternalUrls` are the candidates.

Related: `issues/closed/bugs/2026-08-24-full-suite-timeouts-under-concurrent-worktree-load.md`
(load-induced flakes) — this is one source of that load.
