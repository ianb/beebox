---
title: "Agents write \"the user\" and \"the boxholder\" on pages the person reads"
workstream: user-facing-language
resolution: implemented
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
[walk 1](../../../beebox/test/user-stories/journeys/B-inventory/reports/2026-10-08.md) (row 42),
[walk 2](../../../beebox/test/user-stories/journeys/B-inventory/reports/2026-10-08-2.md) (row 45).

## Resolution (user-facing-language, 2026-10-09)

Closed by the user-facing-language merge to main.

A check, not more guide text: the card-write hook (`sdk-hooks.ts`,
`card-lint/third-person.ts`) flags "the user" / "the boxholder" in text the agent
just wrote to a card under `_content/`, while it can still fix it. It reads
only the new text, so imported content that quotes "the user" stays quiet;
for the same reason it is not a `bbx validate` rule. The briefing's
instructions now say to write it in the person's own voice ("I'm
cataloguing my tools"), since agents read it too and "you" would be
ambiguous there.

[walk 1](../../../beebox/test/user-stories/journeys/B-inventory/reports/2026-10-08.md) (row 42),
[walk 2](../../../beebox/test/user-stories/journeys/B-inventory/reports/2026-10-08-2.md) (row 45).

## Re-encounter 2026-10-09 (journey walks, before the fix)

The 2026-10-09 walks ran on main `24d84746f`, before this issue's fix landed (`4d9a15fe8`). They are evidence of the old behavior, not of the fix failing.

Seen again in three walks. [B](../../../beebox/test/user-stories/journeys/B-inventory/reports/2026-10-09.md) (R5): the inventory briefing says "the boxholder wants that visible" (`_content/inventory/briefing.briefing.card:19`). [D2](../../../beebox/test/user-stories/journeys/D-chemistry/reports/2026-10-09-2.md) (row 20): "the learner" and "they" on a course page written for the person. Here the third person is required: the build-course skill tells the agent to write every course card with "neutral pronouns (they/them) for the learner" (`beebox/src/core/box/guidance-sync/skills-content.ts:33`), and the course card, progress body and session log follow it. [D](../../../beebox/test/user-stories/journeys/D-chemistry/reports/2026-10-09.md) (row 36): one doc card mixes three voices ("Their summary", "Asked what you'd do", and a first-person title "Where I am"); no course rule is behind that card. [F](../../../beebox/test/user-stories/journeys/F-newcomer/reports/2026-10-09.md) (row 17): the briefing says "A friend set the box up for them." on the person's own page. Fixing the build-course skill is part of this issue.
