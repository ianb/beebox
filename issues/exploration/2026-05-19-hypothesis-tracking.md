---
title: "hypothesis tracking"
workstream: unknown
needs: [design]
area: beebox
---

The agent forms suspicions constantly — "boxholder seems stressed about work this week," "the kitchen project may have stalled," "they're avoiding a particular family topic." These are different from facts and currently have nowhere to live: too provisional for a person/topic card, too important to discard. Without persistence the agent re-derives them each session or, worse, forgets and asks something the suspicion would have steered it away from.

Design notes:

- **No percentage confidence.** Fake precision; neither model nor user has calibrated 65%-vs-70% intuitions. If gradation matters at all, qualitative bands (hunch / suspect / likely). Probably even those are overkill — binary "is-a-hunch" plus a refutation trigger does the real work.
- **Every hunch carries a refutation/confirmation trigger.** "If Alice mentions the kitchen project, ask if it stalled" is more useful than any confidence score. The trigger is what makes the hunch operationally actionable.
- **Aging.** Hunches go stale fast — most suspicions about state ("seems stressed this week") shouldn't survive past a couple weeks. Trait-shaped hunches ("seems uncomfortable discussing finances") last longer. Per-hunch TTL, not a global one.
- **Promotion to fact.** When a hunch is confirmed it should become a normal note on the relevant person/topic card, not a permanent resident of the hunches file.
- **Connection to user-model dimensions** (see [User-model dimensions](2026-05-19-user-model-dimensions.md) entry above) — hunches along the same axes the agent watches for are the raw material; over time, repeated hunches in the same direction become facts.
