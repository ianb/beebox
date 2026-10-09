---
title: "A long agent turn gives no sign of progress"
workstream: unattached
area: beebox
needs: [decision]
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-oct — D-chemistry journey walk, 2026-10-08
---

In the D-chemistry walk the first reply took 113 seconds to show any text.
The walker reports that the screen showed only "Thinking…"; no screenshot covers the middle of the wait. The agent had composed one 73-second tool
call that wrote every course card, so nothing reached the chat in between.
The walker noted the wait. The interim line that followed ("Your study space is
written; I'm checking that everything validates") helped, but arrived after
the gap. Transcript times: send 10:47:33.0, first text 10:49:26.4.

## Why this needs a decision

Three fixes pull different ways:

1. Tell the agent to send a one-line progress message before any tool call
   expected to take long. Cheap, but depends on model compliance.
2. Split big writes into several smaller tool calls. The activity row would
   then change as cards land, but this changes how agents write.
3. Show elapsed time or a heartbeat in the chat UI. Accurate but says nothing
   about what is happening.

The developer should pick which of these, or a combination, the product
promises. Related:
[companion doc shows no sign it is being edited](../bugs/2026-08-25-companion-doc-shows-no-sign-it-is-being-edited.md).

Report: [D](../../beebox/test/user-stories/journeys/D-chemistry/reports/2026-10-08.md) (row 20).

## Re-encounter 2026-10-09 (journey walks)

Improved by agent behaviour, not by the product, per [D2](../../beebox/test/user-stories/journeys/D-chemistry/reports/2026-10-09-2.md) (rows 20, 22). The course build again took one long turn (2.2 minutes), but the agent sent a first line at 5.3 s and a progress line mid-way; the longest silent stretch was 54 s, against 113 s on 2026-10-08. No guidance asks for this (`prompts.ts` has no such rule) and nothing in the product changed; the decision is still open. [B](../../beebox/test/user-stories/journeys/B-inventory/reports/2026-10-09.md) (row 28): a 111 s turn showed progress lines at 45 s and 78 s, so it is not a repeat. [D](../../beebox/test/user-stories/journeys/D-chemistry/reports/2026-10-09.md) saw no long turn (slowest 20.5 s).
