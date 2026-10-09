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
(`beebox/test/user-stories/journeys/D-chemistry/reports/2026-10-09.md`, row
36) and is not yet on `main`.
