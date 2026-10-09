---
title: "The chat agent narrates schema and code work to a person who asked for a list"
workstream: user-facing-language
resolution: implemented
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-oct — A-lending journey walk, 2026-10-08
---

In the A-lending walk the person asked to remember who has their stuff. While
the agent built a card type, the chat showed text such as "Now the schema.",
"fix a garbled line in the instructions", and "that file escapes its
backticks". The walker did not know what a schema is and was nervous about
"instructions". Nothing of the person's was damaged; the garbled line was the
agent's own wording in the file it had just written
([report](../../../beebox/test/user-stories/journeys/A-lending/reports/2026-10-08.md), rows 12, 20, 70, 74).

The box guide says nobody needs to know what a schema is
(`beebox/box-docs/what-you-could-do.md:90`). Creating a card type mid-chat is
documented behavior (`:86`, `:107-108`). The defect is that the person sees
the mechanics.

## Mechanism

- `beebox/src/core/chat/session/prompts.ts:27` says a note written before a
  tool call "reaches the user only as a short summary". The report found such
  notes render in full (transcript 10:21:26, shot 05).
- The "do your bookkeeping silently" rule (`prompts.ts:23`) covers card
  upkeep, not schema, rule, or code work.

## Not obvious

Two fixes, one for each half. The prompt can name schema and code work as
silent. The UI can follow the prompt's claim and collapse pre-tool text.
Prompt-only changes cannot be verified without a real model run. The activity
row has a related vocabulary problem:
[Chat activity row speaks in commands and files](2026-10-08-chat-activity-row-speaks-in-commands-and-files.md).

## Resolution (user-facing-language, 2026-10-09)

Closed by the user-facing-language merge to main.

Prompt half only. `prompts.ts` no longer claims pre-tool notes are summarized
(they render in full), and the silent-bookkeeping rule now names building
the box's machinery (a card type, its instructions, a rule, a view, a script,
a fix to your own wording). SPEAKING carries the same rule for all agents.
The UI keeps pre-tool text visible: a model sometimes puts its whole answer
there (`message-parsing.ts`, `groupIntoParts`).
