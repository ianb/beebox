---
title: "correction counting spec promotion"
workstream: unknown
area: beebox
---

Corrections that stay in chat disappear. The fix is to extract them (during overnight compaction or a retrospective pass), count how often the *same* correction recurs across sessions, and promote frequent ones to permanent spec-level instructions.

The count is what makes this useful. Without it:
- Save every correction → spec bloats with one-offs the boxholder wouldn't actually want as permanent rules.
- Save none → keep getting the same correction repeatedly, which is exactly the failure this addresses.

Threshold worth experimenting with (the tip suggests 3). What matters is the promotion: from per-session-correction → tracked-recurring-correction → spec-level rule.

Design notes:
- **Promotion should be explicit, not automatic.** The agent's read of "this is the same correction I got before" can be wrong (surface similarity ≠ same underlying rule). Surface candidates during retrospectives: "you corrected me on X three times this month — make this a permanent rule?" User confirms before spec changes.
- **Counting requires extraction.** Compaction needs to recognize "this was a correction" as a distinct extraction type, separate from facts or hunches. Tag at extraction time so counting is just aggregation.
- **Same connection to [Behavioral profile: autonomy-vs-escalation calibration](2026-05-19-behavioral-profile.md)** — corrections aren't only "rules to add," they're signals about what the boxholder cares about, which feeds the user model.
- **Demotion path.** If a promoted rule starts causing different corrections (because circumstances changed), the rule should be flagged for review, not silently fought.

Probably belongs in the same flow as retrospectives the user already runs. The mechanism is what's missing more than the concept.

## Audit 2026-10-22

Part of this shipped for box beliefs. The box retrospective (`beebox/docs/implemented-plans/box-retrospectives.md`, lines 214-226) counts how many distinct sessions show the same proposal. One session gives `hypothesis`, two or more give `low`, four or more give `medium`. Promotion past `medium` needs the boxholder through a question card. Still missing: a distinct 'correction' extraction type during compaction, and promotion of a recurring correction into a spec-level rule. The retrospective writes beliefs, not spec rules.

Re-reviewed 2026-10-30: unchanged since the 2026-10-22 audit. On the dev side, the retrospective schedule already promotes recurring coding feedback into guidance, which may be a model for the box version.
