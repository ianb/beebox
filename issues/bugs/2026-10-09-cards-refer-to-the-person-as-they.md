---
title: "Cards refer to the person as \"they\": \"Their summary\", \"for themselves\""
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-oct — D-chemistry journey walk, 2026-10-09 (report row 36)
---

A doc card the agent wrote for the D-chemistry walker said "Their summary"
and "Worked out a strategy for themselves". The same card said "Asked what
you'd do" in another place, and its title was "Where I am": three voices in
one card. The walker is the person whose box it is, so "their" and
"themselves" should be "your" and "yourself".

This is the pronoun form of
[agents write "the user" on pages the person reads](../closed/bugs/2026-10-08-agent-writes-the-user-on-boxholder-pages.md).
The fix for that issue does not catch it. The card-write hook
(`beebox/src/core/card-lint/third-person.ts`) flags only "the user" and "the
boxholder", and "they"/"their" usually refers to someone else ("Sam brought
their drill back"), so a phrase check would mostly fire on correct text.

## Not obvious

Options: a mixed-voice check (a card that uses both "you" and a third-person
pronoun for the same subject), a schema `instructions` line for the card
types where the agent summarizes the person (doc, record, course progress),
or a knowledge audit that has the agent summarize a session about the
person. The guide's SPEAKING section already says "you" on cards.

The walk report is in the journey-walks-oct workstream
(`beebox/test/plugins/courseware/journeys/D-chemistry/reports/2026-10-09.md`, row
36) and is not yet on `main`.

## 2026-10-17: courseware plugin scope

Courses are the opt-in courseware plugin, not core Bee Box
(`beebox/src/plugins/courseware/`). This issue now has `area: courseware`, so
core and journey work leave it out.

The observed card is a doc card, but the walk's agent had loaded the
`build-course` skill minutes before it wrote the card. That skill tells the
agent to write course cards with they/them for the learner
(`beebox/src/plugins/courseware/skill.ts:28`, and the exposition-plan body
instruction at `beebox/src/plugins/courseware/exposition-plan.ts:88`). The
third person is most likely that instruction carried over. No walk showed
it in a box without the skill. The fix is in the courseware guidance.

## Re-encounter 2026-10-22 (journey walks): a core-box case

[C-reconnecting](../../beebox/test/user-stories/journeys/C-reconnecting/reports/2026-10-22.md) (R4): the briefing body gained "They send messages themselves from their phone and are not connecting any accounts" (box commit `efb592f`). The same card's "Reaching me" section speaks as "me". The person can open the briefing from the Box page's "Also here". This is not a courseware card, and the card-write hook (`beebox/src/core/card-lint/third-person.ts`) is core code, so the area is now `beebox`.
