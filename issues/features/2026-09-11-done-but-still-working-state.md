---
title: "Chat needs a \"done, still working\" state — the agent ready for input while background work continues"
workstream: unattached
area: beebox
priority: normal
needs: [design]
labels: [chat, agents, status]
filed-by: agent
discovered-by: Ian
discovered-in: main session — "I want some signal that the agent is 'done' but still running things in the background"
---

Boxholder: "mostly I want some signal that the agent is 'done' but still
running things in the background. Like the foreground agent is ready and
willing to respond, and will just do whatever when the background agents
finish."

That is a third state the chat does not model. Today
`useProcessingStatusPoll` produces a single boolean, `showAgentWorking`
(`InteractiveChat.tsx:216`), which feeds both the composer status and the
streaming indicator (`InteractiveChat-view.tsx:290-292`). A turn is either in
flight or finished. There is no way to say **the turn is finished, I am ready
for your next message, and two things are still running.**

The distinction matters because the two states want opposite affordances. Mid-
turn, sending again queues behind the current turn. Done-but-working, sending
again should be immediate and normal — the whole point is that the foreground is
free.

## What already exists

More than the earlier decision issue assumed. `BackgroundTasks.tsx` renders a
live strip of pills above the composer — one per running task, with a pulsing
dot, label, last tool touched, and elapsed time; a pill disappears when its task
settles and the result becomes a transcript marker. Its docstring scopes it to
"tasks the agent has running in the background (e.g. a backgrounded shell
command)", so whether SDK background subagents appear there is unverified and
is the first thing to check.

So the per-task visibility is largely built. What is missing is the
**session-level** state that reads off it: "idle", "working", and "idle with N
running" are three things, and only two are represented.

## The native capability this rests on

The Agent SDK already backgrounds agents and workflows — see
[chat stop and background subagents](../decisions/2026-08-25-chat-stop-and-background-subagents.md),
which exists because `interrupt()` kills them unless `perTaskStopAffordance` is
set. Two corrections to that issue, both from 2026-09-11:

- It says nothing can be implemented until the pin reaches 0.3.246. The pin is
  now **0.3.266**, so that blocker is gone.
- It says there is "no chat surface listing what is still running". The
  background-task strip is that surface, or most of it.

What is genuinely unestablished: whether a backgrounded subagent survives a
**normal turn end**, as opposed to surviving an `interrupt()`. Those are
different lifecycles, and the reactor drives chat jobs with session reuse across
cycles rather than one continuous process. Settle that before designing on the
assumption that the foreground can simply finish.

## What to decide

- **What "done" promises.** If the agent says it is finished while work runs,
  and that work later fails, the person was told something untrue. The state
  needs a resolution path, not just an indicator.
- **How a result lands.** "Will just do whatever when the background agents
  finish" implies results arrive unprompted, in a conversation that has moved
  on — which is the ambient/callout territory the chat-everywhere plan covers
  (Track D). Reuse it rather than inventing a second arrival mechanism.
- **Silent deferral is the failure mode.** An agent that can defer can also
  drop: "I'll do that later" with no visible obligation is worse than doing it
  slowly in front of you. The outstanding work has to stay visible until it
  resolves — which is the same argument as
  [explicit but rich](../exploration/2026-09-11-explicit-but-rich.md).
- **What stop means in this state** — the open question in the decision issue,
  now with a concrete case attached.
