---
title: "Git-replay testing"
workstream: unknown
resolution: superseded
---

**Closed (2026-07-15): superseded / out of date with the current ideas.** A
speculative testing mode salvaged from a retired implementation guide, out of step
with where testing actually settled: doctests (`.doctest.md`, three tiers) as the
primary format plus `src/scenario/` for synthetic multi-step histories. Replaying
*real* box history has never proven needed, and it carries real complexity (the
logs-outside-the-timeline sub-question below is a symptom). Refile with a concrete
replay-debugging need if one ever shows up.

2026-07-04 · idea, salvaged from the retired MVP implementation guide
(`implemented-plans/mvp-implementation-guide.md`).

Git gives the box time travel: every state change is a commit, so a
debugging/testing mode could check out any historical commit and re-run
processing from that state, or run twice from the same starting point and
diff the results — commits as the unit of "what happened." Scenario fixtures
(`src/scenario/`) cover the synthetic side; this is the replay-real-history
complement.

Open sub-question from the same doc: verbose logs would need to live outside
the replayed timeline so a checkout doesn't mix logs from two histories.
