---
title: "introspectable feedback storage"
area: callback-box
---

Several ideas in this file — parked proactive observations, hypothesis tracking, behavioral-profile candidates, correction-counting, autonomy-promotion candidates, agent-noticed self-failures — all involve the same shape: *the agent writes structured entries that accumulate over time and get surfaced during /spark or retrospectives*. The naive implementation is parallel files (ideas_log.md, development_backlog.md, hunches.md, parked-observations.md, corrections.md...), which is sprawl with overlapping concerns.

Cleaner shape: extend `cb feedback` (or whatever the existing feedback mechanism is) to be the single storage layer for all of these. Each entry has:

- **Type/category** — parked-observation, hypothesis, correction, self-noticed-failure, autonomy-promotion-candidate, etc.
- **Subject** — what it's about (person, project, behavior, operation class).
- **Body** — the content itself.
- **State** — fresh / parked-until-date / killed / promoted.
- **Aging metadata** — when written, when last surfaced, when last engaged with.

The point isn't to enforce a rigid schema — different types need different fields. The point is *one introspectable surface* the boxholder can query ("what's been accumulating about Alice?", "what hunches haven't been confirmed?", "what corrections have repeated?") and the agent can scan during /spark, retrospectives, and compaction.

Connections:
- [/spark mode — batch harvest of the proactive layer](../features/2026-05-19-spark-mode.md) reads this surface as its input.
- *Park ignored proactive observations* in [prompt-audits.md](../callback-box/docs/prompt-audits.md#park-ignored-proactive-observations) writes parked items here.
- [Hypothesis tracking](2026-05-19-hypothesis-tracking.md) writes hunches here.
- [Correction counting → spec promotion](2026-05-19-correction-counting-spec-promotion.md) writes correction events here.
- [Declared per-box autonomy matrix with encounter queue](2026-05-19-autonomy-matrix.md) writes promotion candidates here.

The discipline that makes this work: nothing in the system writes accumulated observations to a *new* file — everything goes through the feedback layer with its type tag. Otherwise the sprawl returns under different filenames.
