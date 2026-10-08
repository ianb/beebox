---
title: "Agents write \"the user\" and \"the boxholder\" on pages the person reads"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-oct — B-inventory journey walk, 2026-10-08
---

Both B-inventory walks of 2026-10-08 showed the box agent referring to the
person in the third person on cards and briefings the person reads.

- Walk 1: a card said "the user confirmed". The walker, who is "the user",
  noted this. The briefing used the same wording.
- Walk 2: the briefing opened "The boxholder is cataloguing …" and a card said
  "Listed from the boxholder's memory". The walker: "\"the boxholder\" is a
  funny name for me."

The agent guide already forbids this. `beebox/src/core/agent-guide/guide.md:153-158`
says terms like "boxholder" and "the agent" are for operating the system, and
that the agent must address the person as "you" and speak as "I". The agent
read the guide and still wrote the third person. Walk 2 shows a changed
word, not a fix.

## Why the fix is not obvious

The rule exists and is clear, so more guide text is unlikely to help. Options:
a lint or post-write check on cards and briefings for the phrases, or a
briefing template whose own wording sets the voice. The second option matches
how the seed briefing is already written in the person's voice (see
[seed briefing speaks agent commands](2026-10-08-seed-briefing-reaching-me-speaks-agent-commands.md)).

Reports:
[walk 1](../../beebox/test/user-stories/journeys/B-inventory/reports/2026-10-08.md) (row 42),
[walk 2](../../beebox/test/user-stories/journeys/B-inventory/reports/2026-10-08-2.md) (row 45).
