---
title: "TodoWrite and the Task tools are already absent on the models beebox runs — opt in, or accept"
workstream: sdk-update
area: beebox
priority: backlog
filed-by: agent
discovered-by: agent
discovered-in: worktree-sdk-update — reviewing Agent SDK 0.3.268
labels: [sdk-update]
needs: [decision]
---

Agent SDK `0.3.268`:

> *"Changed the task-tracking tools (TaskCreate/Get/Update/List, TodoWrite) to be
> default tools only on Claude 3.x, Opus 4.0–4.7, Sonnet 4.0–4.6 and Haiku 4.5;
> elsewhere list them in `tools`/`allowedTools`."*

beebox's model table (`src/shared/model-ids.ts`) resolves `opus` →
`claude-opus-5`, `sonnet` → `claude-sonnet-5` and `fable` → `claude-fable-5-1`,
all outside that list. Neither `src/core/agent/run.ts` nor
`src/services/claude-chat.ts` passes `tools` or `allowedTools`. So from `0.3.268`
on, Claude box agents and chat sessions on the default models **no longer have
TodoWrite or the Task tools** unless beebox opts them back in. Only `haiku`
(`claude-haiku-4-5`) keeps them.

beebox renders what those tools produce: TodoWrite shows as "Updated task list"
in chat activity (`src/frontend/src/components/chat/activity-rendering.tsx`), is
listed in `src/shared/known-tools.ts`, is counted by the session report, and
Codex plan items are mapped onto a synthetic `TodoWrite` so both engines render
the same way (`src/services/codex-tool-activity.ts`). Nothing found depends on
todos beyond rendering and reporting.

**The call to make:** opt the tools back in by listing them in `allowedTools` on
both Claude paths, or accept upstream's judgment that current models do not
need them. Accepting costs nothing now, but the Claude side of the TodoWrite
rendering stops receiving input and the Codex mapping becomes the only
producer. Opting in keeps behavior as it is at the price of overriding a
default that upstream changed on purpose.

`0.3.268` was ~19h old at the 2026-09-11 turn, so the settled path reaches it
no earlier than 2026-09-12; deciding before then avoids the change arriving
unnoticed.

## Corrected 2026-09-13 — already absent at the previous pin; no deadline

Read the session's `system/init` tool list rather than inferring from the
changelog. On **both** `0.3.267` (the pin at the time) and `0.3.268`, for
`claude-sonnet-5`, `claude-opus-5` and the default model, the list is identical
(69 tools) and contains:

    Task, TaskOutput, TaskStop

and **not** `TodoWrite`, `TaskCreate`, `TaskUpdate`, `TaskList` or `TaskGet`.
(`Task`/`TaskOutput`/`TaskStop` are the subagent tools, a different family from
the task-tracking ones this issue is about.)

So the task-tracking tools were already gone for beebox's models before
`0.3.268`, and taking that release changed nothing here — the framing "0.3.268
drops them" was wrong. beebox's "Updated task list" rendering
(`activity-rendering.tsx`) is fed by the synthetic `TodoWrite` that
`codex-tool-activity.ts` constructs from Codex plan items, which is why nothing
looked broken.

The underlying question survives without a deadline: **should beebox opt these
tools back in** for Claude agents and chats by listing them in `allowedTools`,
or accept that current models plan without them? Lowered to `backlog` — no
release forces the answer, and the remedy is a beebox-side list either way.
