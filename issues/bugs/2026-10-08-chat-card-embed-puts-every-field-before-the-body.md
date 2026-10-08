---
title: "A card embedded in chat shows every field before the body"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-oct — D-chemistry journey walk, 2026-10-08
---

In the D-chemistry walk the learner said "show me what you've recorded". The
agent embedded the progress card in chat with
`![Where you left off](/_content/courses/…/Intro_Chemistry_Progress.progress.card)`.
The chat then showed the whole raw record: every type field, in storage
order, before any prose. The learner had asked for a summary.

## Mechanism

The chat prompt tells the agent an embed shows the card "via its own viewer"
(`beebox/src/core/chat/session/prompts.ts:108`). In embed mode there is no
Properties face, so `beebox/src/frontend/src/lib/card-field-faces.ts:56`
puts every type field on the front (rationale in the file comment, lines
8-14). A bodied card then pushes its body down the chat, below all its fields.

## Options

Cap or collapse the field block in embeds, put the body first, or tell the
agent that an embed shows the whole card so it links instead. Related:
[structured card front hides its facts](../decisions/2026-10-08-structured-card-front-hides-its-facts.md)
(same face split, opposite complaint).

Report: [D](../../beebox/test/user-stories/journeys/D-chemistry/reports/2026-10-08.md) (row 56, shot 19).
