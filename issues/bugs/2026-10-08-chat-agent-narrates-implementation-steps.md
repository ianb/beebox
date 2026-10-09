---
title: "The chat agent narrates schema and code work to a person who asked for a list"
workstream: unattached
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
([report](../../beebox/test/user-stories/journeys/A-lending/reports/2026-10-08.md), rows 12, 20, 70, 74).

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

## Re-encounter 2026-10-09 (journey walks)

Seen again in three walks. [A](../../beebox/test/user-stories/journeys/A-lending/reports/2026-10-09.md) (row 15): "Setting it up now: a 'loan' type…" and "Adding a landmark and regenerating docs now" rendered between activity rows (11:06:52, 11:07:52); the agent did not regenerate docs. [B](../../beebox/test/user-stories/journeys/B-inventory/reports/2026-10-09.md) (row 22): "checking and committing" in prose (transcript 11:44:02). [F](../../beebox/test/user-stories/journeys/F-newcomer/reports/2026-10-09.md) (row 37): the interim line "I'm reporting that gap and then I'll answer." (12:27:09).

A fourth case sits on the closed [chat-agent-narrates-internal-bookkeeping](../closed/docs-and-chores/2026-08-06-chat-agent-narrates-internal-bookkeeping.md) item. [D](../../beebox/test/user-stories/journeys/D-chemistry/reports/2026-10-09.md) (row 12): before an edit the agent wrote "I'll put their purpose into the briefing, quoted verbatim" (05:55:29), in the third person. The closed fix, the bookkeeping rule at `prompts.ts:23`, is in place and covered field-budget remarks; this is a pre-action plan line, the same schema/rule/code-work gap this issue describes. The closed item stays closed; the evidence is recorded here.
