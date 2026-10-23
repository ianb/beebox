---
title: "The chat agent narrates schema and code work to a person who asked for a list"
workstream: knowledge-audit-refresh
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-oct — A-lending journey walk, 2026-10-08
resolution: implemented
---
**Closed.** Resolved by the chat-progress-fold work (commits 05665521a, d52050af6, a9f06731d): lines the agent writes between steps fold into the "took N steps" activity row when the turn ends, and only the final reply stays visible. Prompt wording and the `speak-outcome-not-mechanics` knowledge audit (3 of 4 passes) back it. Divergence: the agent is not stopped from narrating; the narration is hidden from the answer. If an agent writes part of its answer before a final tool call, that part folds too.


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

## Re-encounter 2026-10-09 (journey walks, before the fix)

The 2026-10-09 walks ran on main `24d84746f`, before this issue's fix landed (`4d9a15fe8`). They are evidence of the old behavior, not of the fix failing.

Seen again in three walks. [A](../../../beebox/test/user-stories/journeys/A-lending/reports/2026-10-09.md) (row 15): "Setting it up now: a 'loan' type…" and "Adding a landmark and regenerating docs now" rendered between activity rows (11:06:52, 11:07:52); the agent did not regenerate docs. [B](../../../beebox/test/user-stories/journeys/B-inventory/reports/2026-10-09.md) (row 22): "checking and committing" in prose (transcript 11:44:02). [F](../../../beebox/test/user-stories/journeys/F-newcomer/reports/2026-10-09.md) (row 37): the interim line "I'm reporting that gap and then I'll answer." (12:27:09).

A fourth case sits on the closed [chat-agent-narrates-internal-bookkeeping](../docs-and-chores/2026-08-06-chat-agent-narrates-internal-bookkeeping.md) item. [D](../../../beebox/test/plugins/courseware/journeys/D-chemistry/reports/2026-10-09.md) (row 12): before an edit the agent wrote "I'll put their purpose into the briefing, quoted verbatim" (05:55:29), in the third person. The closed fix, the bookkeeping rule at `prompts.ts:23`, is in place and covered field-budget remarks; this is a pre-action plan line, the same schema/rule/code-work gap this issue describes. The closed item stays closed; the evidence is recorded here.

## Re-encounter 2026-10-22 (journey walks, after the fix)

Two walks had one line each; the F, H and I walks reported none. It stays closed.

- [A-lending](../../../beebox/test/user-stories/journeys/A-lending/reports/2026-10-22.md) (row 34): "The Lending page summary came out garbled, so I'm rewriting that line properly." The agent's own Python `replace` had written broken text into the Lending landmark; it rewrote the line 7 s later, and the broken text was never committed. The prompt names "a fix to your own wording" as silent (`beebox/src/core/chat/session/prompts.ts:23`), so this is that rule failing once. The walker: "it fixed its own mess but I'd have preferred not to hear about it." It was the only process line in eight turns.
- [B-inventory](../../../beebox/test/user-stories/journeys/B-inventory/reports/2026-10-22.md) (row 40): building two card types and a view produced only lay interim lines ("Now I'm building the all-in-one list you can search from your phone."). One terse pre-tool note leaked in a new chat: "Need details/quantities." The walker called it "leaked self-talk".

## Reopened 2026-10-22 (knowledge audit, after the fix)

The knowledge audit `speak-outcome-not-mechanics` asks in chat mode for a tool-loan tracker, the A-lending request. It failed 2/2 on the opening line: "I'll build a loan card type and record the two current loans. Let me read how schemas work here first." The rule named mid-work narration, and the agent read an announcement before the work as allowed.

The rule at `beebox/src/core/chat/session/prompts.ts:23` now says "before or during the work" and gives "Setting up a place for your loans" as the opening. After that change every run opened with that line, but 3 of 5 runs added a build-step line next to it: "Let me check how this box defines its own card types first", "Now I'll write the loan card type, its template, and the place for the loans". The rule covers this case, and the agent still narrates its build steps between tool calls. More prompt text did not fix this. A further fix may be a product choice about how pre-tool text shows in chat (`message-parsing.ts`, `groupIntoParts`).
