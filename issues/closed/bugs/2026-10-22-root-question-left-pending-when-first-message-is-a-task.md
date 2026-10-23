---
title: "The root question stays pending when the person's first message is a concrete task"
workstream: unattached
area: beebox
labels: [onboarding]
filed-by: agent
discovered-by: agent
discovered-in: worktree-journey-walks-late-oct — I-deciding walk, 2026-10-22
resolution: implemented
---

Resolved 2026-10-22 by the journey-walks-late-oct fix commit. Boxholder decision: a concrete task as the first message answers the root question. The chat prompt now says so.

A new box asks "What do you want to keep track of here?". In the I-deciding walk the person's first message described one job: replace a washing machine with a partner. Every send carried `open-question=_bookkeeping/questions/what-to-keep-track-of.question.card`. The agent read the card at its first step (box transcript `86e5f18c`, 12:42:54). It did not answer the question, did not write a purpose into the briefing, and did not change the root landmark. The question stayed on the root page ("1 question waiting") for the whole session. The person asked "why is it still asking after I've clearly said what it's for?" and answered it again from the Questions page (box commit `27b6566`, ten minutes later).

Report: [I-deciding](../../../beebox/test/user-stories/journeys/I-deciding/reports/2026-10-22.md) (rows 29, 36).

## Mechanism

The chat prompt allows this: "If it is about something else, reply to it and leave the card pending" (`beebox/src/core/chat/session/prompts.ts:187`). To the agent, a message about one task reads as "something else". To the person, it is the answer.

## Why the fix is not obvious

Decide: does the first message on a new box always count as the answer to the root question (the agent records "this box is for <the task>" and answers), or does the agent ask one short follow-up? The F-newcomer and C-reconnecting walks of the same day show the other outcome: the agent answered from an early chat message, and the person did not see that it had (see [root question shown twice](2026-10-22-root-question-shown-twice-and-answered-silently.md)). A residual risk in the [closed openers issue](2026-10-09-root-onboarding-openers-outlive-the-purpose.md) is related: an agent that records the purpose outside the briefing never reads the briefing rule.
