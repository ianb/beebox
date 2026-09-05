---
title: "spark mode"
workstream: unknown
needs: [design]
area: beebox
priority: backlog
---

Conceptual inverse of narration mode (see [narration-mode.md](../../beebox/docs/plans/narration-mode.md)). Narration is user-talks-mostly (long dumps, agent files quietly). /spark is agent-talks-mostly (agent surfaces everything it's been holding back; user triages). Both intentionally break the turn-balanced rhythm in opposite directions.

The premise: the agent runs a proactive layer continuously, with normal suppression discipline (park-on-ignore, thresholded surfacing, silent consultation as default). Observations the agent would have surfaced eventually but didn't yet — because timing was wrong, because the boxholder was focused elsewhere, because the quota was already spent — accumulate. /spark is the deliberate harvest of that accumulation.

This presupposes the full suppression-discipline stack. Without it the bin is empty and spark is just "the agent rambling." Inputs probably come from:

- Parked proactive observations (see *Park ignored proactive observations* in [prompt-audits.md](../../beebox/docs/prompt-audits.md#park-ignored-proactive-observations) audit)
- Hypotheses crossing confirmation/refutation thresholds (see [Hypothesis tracking](../exploration/2026-05-19-hypothesis-tracking.md))
- Behavioral-profile and autonomy-matrix promotion candidates (see [Declared per-box autonomy matrix with encounter queue](../exploration/2026-05-19-autonomy-matrix.md), [Correction counting → spec promotion](../exploration/2026-05-19-correction-counting-spec-promotion.md))
- Recurring corrections worth surfacing as proposed rules
- Health-check residue (quiet failures, drift)
- Stale items from the questions queue (see [Aging policy for the questions/waiting queue](../closed/features/2026-05-19-questions-aging-policy.md))

Open design questions:

- **Confidence floor stays.** Suppression-lifting isn't confidence-lifting. The point isn't "show me everything you've ever thought" — it's "show me everything you'd have surfaced eventually but didn't yet." Speculative hunches still shouldn't appear.
- **Output structure.** Flat list overwhelms. Probably grouped: opportunities / risks / patterns / pending decisions / observations-about-you / proposed promotions.
- **Triage actions per item.** Each item needs quick action: act-now / park-again / kill / tell-me-more. Pure monologue produces overwhelm without resolution. This is where the mode differs from a passive summary report.
- **Termination.** Done when the bin drains, when the user calls it, or some combination. Probably the user can leave with items un-triaged and they stay parked for next time.
- **Cadence vs. on-demand.** Should /spark be entirely on-demand, or also offered proactively when the bin reaches some size threshold? Either way the boxholder retains control over entry.
