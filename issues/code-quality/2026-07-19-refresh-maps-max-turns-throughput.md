---
title: "refresh-maps max-turns:40 is an unmeasured throughput knob"
workstream: refresh-maps-throughput
filed-by: agent
discovered-in: refresh-maps convergence work (worktree-refresh-maps-convergence)
area: callback-box
---

`templates/procedures/refresh-maps.procedure.card` caps its agent at
`max-turns: 40` on haiku. Before the convergence fix, an agent that hit that cap
banked *nothing* — the whole brief repeated next run — so the cap was a
correctness problem disguised as a budget.

That's fixed: finalize now runs as a run-phase shell and stamps only the maps it
can prove were rewritten, so a capped run banks its partial work and the next run
continues from there (see
[`docs/plans/refresh-maps-convergence.md`](../../callback-box/docs/implemented-plans/refresh-maps-convergence.md)).

What's left is a genuine throughput question with no measurement behind it: on a
box with a large brief, 40 turns means N runs to converge, and nobody has checked
what N actually is or how many maps one haiku run gets through. Raising it, or
switching model tier, is guessing until someone watches a real refresh on a big
box. Worth measuring before tuning.

Related: [box-packageify doubled subtrees](../closed/bugs/2026-07-15-box-packageify-doubled-subtrees.md)
— the corruption that produced a maximally-inflated brief in the first place.

## Measured, 2026-08-24

Sample: every refresh-maps run with a surviving agent transcript on the three
deployed boxes that carry history — 28 runs, 2026-07-13 → 2026-08-24. (Earlier
run cards exist but are stuck in `status: running` with no session, from before
the engine recorded step results.) All three boxes are on the `claude` engine and
every run resolved to haiku, so the `haiku` → tier `efficient` rename does not
split the sample. Turn counts are per agent invocation: the validate step spawns
its own review agent in the same session, which does not draw on the refresh
step's `max-turns`.

**The cap is not the binding constraint.**

- Refresh-agent turns: median 12, range 9–41. **One run of 28 hit the cap.**
- The largest single run banked **36 maps in 25 turns** and passed validate. The
  biggest box holds 28 MAP.md files total, so a maximally-dirty whole-box brief
  already fits inside 40 turns with room to spare.
- Cost structure is ~9–11 turns of fixed overhead (brief, finalize, commit)
  plus well under one turn per map at volume — a 1-map run costs 9–12 turns, a
  36-map run costs 25.
- Wall clock: 64s–441s per run, median ~200s.
- No box ever needed multiple runs to work off a backlog. Multi-run streaks
  exist, but each run's brief was 1–6 maps; they are repeat *failures*, not a
  queue draining.

**The one capped run was not throughput-limited.** Its brief was 2 maps. It
spent 36 of 40 turns on `Bash` — repeated `git show`/`status`/`log`/`ls-tree`
and four re-runs of `cb refresh-maps` — auditing its own work, and 2 turns
writing maps. Raising the cap would have bought it more auditing.

**What does limit this procedure: validate failures.** 12 of 28 runs are marked
`failed`. Exactly **one** of those failed the outstanding-work shell check. The
other 11 failed the validate step's *review* — the agent judging the diff and
finding it unsound. At least one is a real regression rather than a review
false positive: a run that reported "6 map(s)" as *created* instead deleted four
live subdirectory entries from `config/MAP.md` and one entry each from two other
maps (net +2/−8 lines). The review caught it; `severity: warn` meant nothing
gated, and the lost entries stayed lost for nine days until the next large
refresh restored them.

**Cost, for whatever tuning follows.** Mean $0.14 per refresh invocation at
`efficient`/haiku (dominated by cache reads); the same token profile at
`balanced`/sonnet prices is ~$0.41. Across three boxes running daily that is
roughly $12/mo → $37/mo. Raising `max-turns` alone changes nothing, since
almost nothing reaches it.

**Recommendation: leave `max-turns: 40` alone.** It is correctly sized and is
not what limits throughput. The open question the data actually raises is
whether `efficient` is the right tier for a step that silently drops live
directory entries out of an index other agents read — and whether the validate
review should gate rather than warn. Both are separate from this issue.
