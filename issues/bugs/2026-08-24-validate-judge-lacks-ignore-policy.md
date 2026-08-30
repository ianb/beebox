---
title: "The validate judge fails refresh-maps for obeying the ignore policy"
workstream: refresh-maps-throughput
filed-by: agent
discovered-in: refresh-maps throughput measurement (worktree-refresh-maps-throughput)
area: beebox
---

`SKELETON_HIDDEN_PATHS` in `precheck-ignore.ts` hides whole subtrees from maps —
its own doc comment says "the dir itself is excluded from its parent's listing
AND no MAP is generated inside it". `config/connectors|procedures|schedules|
schemas/` and `store/archive|calendar|chat|trash/` are on that list.

The validate step's review agent doesn't know this. Across 28 measured runs on
deployed boxes it failed two of them for "regressing" maps — the refresh agent
had removed exactly those entries, correctly, and the judge reasoned only from
"these directories still exist on disk, so dropping them is a loss". Both
verdicts are wrong, and one of them read convincingly enough to nearly justify a
model-tier bump on the refresh step.

The judge is given the diff and the step's `instructions`, but nothing about the
box's map ignore policy, so the one thing it most needs to check a map diff
against is the one thing it can't see.

Two shapes of fix, not yet chosen. Narrow: pass the effective ignore patterns
(defaults + skeleton + `.bbx-maps-ignore`) into the judge's context for this
step. General: give validate steps a way to declare the policy a reviewer needs,
so this isn't refresh-maps-specific — the same gap will appear wherever a
procedure's correct behavior is defined by config the judge can't read.

Worth pairing with the question of whether a judge's *inconclusive* result should
surface as a failed step at all; see
[refresh-maps max-turns throughput](../closed/code-quality/2026-07-19-refresh-maps-max-turns-throughput.md),
where 6 of 12 failures were the judge exhausting its own 8-turn budget rather
than judging anything.
