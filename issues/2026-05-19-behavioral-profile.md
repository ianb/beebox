---
area: callback-box
---

# Behavioral profile: autonomy-vs-escalation calibration

A specific cut of the user-model work (see [User-model dimensions](2026-05-19-user-model-dimensions.md)): a profile of what the boxholder wants done autonomously vs. wants to be consulted on. The agent decides this constantly ("just do it, or confirm first?") and miscalibration is visible in both directions — too cautious produces nag fatigue, too autonomous produces unwelcome surprises.

The harder question is meta: we have spaces for this kind of reflective material and some reflective processes, but it's unclear whether the profile actually progresses over time or just sits. A profile that doesn't update is worse than none, because the agent trusts it.

Possible answer: measure the profile by its *predictions*, not its size. When the profile licenses autonomous action on X, does the boxholder later object? When it triggers escalation on Y, does the boxholder say "you didn't need to ask"? Those mismatches are the learning signal. Without a feedback loop the profile drifts toward whatever the agent's prior was at write-time and stays there.

Implementation thoughts:
- The profile entries should be falsifiable ("act autonomously on calendar moves under 30 min"), not vague ("user likes when you take initiative").
- Each entry probably wants a "last validated" timestamp — if it hasn't been exercised in N weeks, lower its weight or re-check.
- The reflective process needs explicit prompts that *evaluate* existing entries, not just generate new ones. Generation without evaluation is what produces a pile rather than a model.
