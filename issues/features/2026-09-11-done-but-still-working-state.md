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

## Research, 2026-09-11 — what exists, and what nobody models

### The harness has it; the SDK does not

Corrects an assumption made earlier in this issue. The Claude Agent SDK's
`query()` runs the whole agentic loop to completion inside one async iterator:
subagents finish before the `ResultMessage` is yielded, there is no documented
API for work surviving `query()`'s return, no callback or out-of-band delivery
for a later result, and no session field distinguishing idle from
idle-with-work-running (`getSessionInfo()`/`listSessions()` expose metadata;
sessions are JSONL transcripts that do not track concurrent work). Resume and
fork are sequential continuation. `@openai/codex-sdk` is the same: thread
resume, no background task API.

`perTaskStopAffordance` therefore governs background agents surviving an
`interrupt()` *within* a turn — not a turn ending while children run.

The interactive Claude Code CLI **does** do this (`Ctrl+B` backgrounds a tool
call, `/tasks` lists what is still executing, completions arrive as
notifications in later turns). So the capability lives in the harness above the
SDK. beebox embeds the SDK, which is the layer where it is absent — meaning
this is orchestration-layer work here (a detached process, or the existing job
card + reactor substrate), with the SDK turn ending normally.

### A2A is the only protocol that models the lifecycle

Its `TaskState` enum is `SUBMITTED, WORKING, INPUT_REQUIRED, AUTH_REQUIRED,
COMPLETED, FAILED, CANCELED, REJECTED` (terminal: the last four). A client
registers a webhook via a push-notification config and the server POSTs on
significant state change — the direct protocol answer to "how does a client
learn a detached task finished." `tasks/resubscribe` replays current state as
the first event, so a disconnect loses nothing. Worth modelling against even
without adopting A2A.

Not useful for this: MCP's `notifications/progress` is a progress bar inside a
still-open request, with no concept of a task outliving the exchange. OpenAI's
Responses "background mode" is poll-only with ~10 minute retention, so nothing
arrives unprompted later. LangGraph's `interrupt()` is the input-required half,
not the still-working half.

**Nobody models the state this issue is actually about.** A2A models the
*task*; the session-level "idle but N tasks running" distinction is absent from
A2A, from MCP, and from AG-UI's state enums alike. So the per-task vocabulary
can be borrowed, but the session state has to be derived here — non-terminal
task count over the strip we already render.

### The two failure modes are opposite, and both are documented

- **The terminal signal never fires.** A documented A2A implementation bug:
  an agent finishes but forgets to emit a terminal state, and every client
  waits forever.
- **The terminal signal lies.** Codex Cloud users report tasks reporting
  "completed successfully" with no diff or PR actually produced.

So "a terminal state was emitted" and "the terminal state is true" are separate
guarantees and should be separately verifiable. That is the concrete form of
the promise problem this issue already raised.

### Cancellation is not a rewind

Google's ADK documents cancellation as deliberately non-destructive: events
already committed to session history stay; only not-yet-yielded events are
discarded. Practitioner writing on stopping agents argues for surfacing a
three-way outcome — completed / prevented / uncertain — rather than a binary
cancelled-or-not, because a side effect already committed cannot be recalled.
That bears directly on the open "what does stop mean in this state" question,
and on the boxholder's live concern that a box agent's background work writes
to the box.

Worth noting for the delivery half: delivering a delayed result into a
conversation that has moved on is itself a side effect needing the same
reconciliation, and late-arriving context competing with newer context is a
known degrader of model attention.

### Shipped UI vocabulary

Cursor's background agents: status-bar icon plus an Agents sidebar with current
step, elapsed time and live log; desktop/email/Slack notification on
completion. GitHub's Copilot coding agent: issue assigned to the agent, live
commits to a draft PR, notification at the end. Claude Code: `/tasks`
(`/bashes`) — with a filed bug where the background label does not clear on
completion, which is the stale-indicator version of the same problem.

Sources: https://a2a-protocol.org/latest/specification/ ,
https://modelcontextprotocol.io/specification/2025-03-26/basic/utilities/progress ,
https://developers.openai.com/api/docs/guides/background ,
https://cursor.com/help/ai-features/background-agents ,
https://adk.dev/runtime/cancel/ ,
https://code.claude.com/docs/en/agent-sdk/sessions.md
