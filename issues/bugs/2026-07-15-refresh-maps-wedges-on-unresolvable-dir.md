---
title: "refresh-maps wedges permanently when a directory can't be resolved at the asOf ref"
filed-by: agent
discovered-in: main session — investigating a test box's stuck refresh-maps health flag
area: callback-box
---

`refresh-maps` can enter an **unrecoverable deadlock** when the box contains a
directory that doesn't resolve at the map-state `asOf` commit. Observed on a box
carrying migration-doubled subtrees (see
[box-packageify doubled subtrees](2026-07-15-box-packageify-doubled-subtrees.md)),
but the failure mode is general — any directory present on disk but absent from
git at the stored `asOf` triggers it.

**The deadlock:**

1. The precheck lists a directory's children at `asOf` via
   `git ls-tree --full-tree <asOf>:<repoRelPath>`
   (`src/core/maps/precheck-listing.ts:105-115`). When that ref doesn't resolve
   ("fatal: Not a valid object name …"), the catch **treats it as an empty
   listing** (`precheck-listing.ts:110-114`).
2. Empty-at-`asOf` + present-on-disk ⇒ every current child reads as "added" ⇒ the
   dir is perpetually **dirty**.
3. The agent regenerates the MAP.md, then the step's `validate` phase re-runs
   `cb refresh-maps --brief`, which **"still reports outstanding work"** (the same
   dir is still dirty) ⇒ validate **fails** (observed: "Validation still failing
   after 1 retry — failing the step").
4. Because the step fails, **`finalize` never runs** — and `finalize`
   (`src/core/maps/finalize.ts:89`, `state.maps[dir] = { asOf: head }`) is the
   only thing that advances `asOf` to HEAD. So `asOf` stays stale, and the next
   run repeats from step 1. Forever.

Net: one unresolvable directory makes the **entire** refresh-maps procedure fail
on every run, with no path to convergence. On the affected box, refresh-maps has
**never** succeeded for this reason (not the stale "missing root element" parse
error that was previously assumed).

**Why the "treat as empty listing" degradation isn't enough:** it keeps the
*listing* from throwing, but it doesn't stop the dir from being reported dirty in
`--brief`, so validate can never pass. The graceful-degradation path and the
convergence path disagree.

**Possible directions (needs design):**
- Make `--brief`/validate tolerant of a directory that can't be resolved at `asOf`
  — skip it (with a loud warning) rather than counting it as outstanding work, so
  one pathological dir can't block finalize for the whole box.
- Or let `finalize` advance `asOf` for the dirs that *did* resolve even when
  others didn't, so progress isn't all-or-nothing.
- Either way, surface the unresolvable directory as an explicit anomaly (it's
  usually a symptom of box-data corruption, as here) instead of silently looping.

**Repro:** a box with a directory on disk that isn't tracked at the stored map
`asOf` (e.g. a doubled/migration-artifact subtree) → `cb tick --script
refresh-maps --force` fails the `refresh` step at validate, and the state at
`config/schedules/.state/refresh-maps.json` never reaches `success`.
