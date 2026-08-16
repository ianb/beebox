---
title: "refresh-maps max-turns:40 is an unmeasured throughput knob"
workstream: refresh-maps-convergence
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
