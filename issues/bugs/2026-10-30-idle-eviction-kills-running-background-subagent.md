---
title: "Idle eviction stops a chat whose background subagent is still working; its next tool calls come back as \"the user doesn't want to take this action\""
workstream: unattached
area: beebox
labels: [chat, subagents, sessions]
filed-by: agent
discovered-by: Ian
discovered-in: "main session — boxholder asked what the 'declined commands' in a prod box chat were, 2026-10-30"
---

A box chat started a long background subagent (a source-collection run) and
ended its own turn. With no new user message and no open SSE listener, the
registry's idle sweep evicted the session while the subagent was mid-run:

```
[ChatSessionRegistry:sweep] Idle eviction of <session>
[ChatSession:stop] Stopping run
```

Every tool call the subagent made after that came back as `The user doesn't
want to take this action right now. STOP what you are doing and wait for the
user to tell you how to proceed.` The subagent stopped; its task notification
then woke the parent, which told the boxholder that "the permission system
declined" two commands and asked for permission. Nobody declined anything,
the chat runs with `permissionMode: "bypassPermissions"`, and the boxholder
had no prompt to answer.

Seen three times in one box on 2026-10-29/30. Each run of denials started
within a minute or two of an idle eviction of that session in the box server
log, and identical commands (the same `git add … && git commit`) succeeded
just before. The denied commands were ordinary: a commit, a read-only Python
script, an append to a card.

Mechanism: `sweepIdle` (`beebox/src/core/chat/session/registry/core.ts`)
evicts an entry when `lastActivity` is older than the idle timeout and
`refCount` is 0. A background subagent's tool calls do not count as activity
and do not hold a pin, so a working session looks idle.

Two defects:

1. **Eviction stops live background work.** Background subagent activity
   should count as activity (or pin the session) until its task completes.
2. **The interruption is reported as a permission denial.** The agent, and
   then the person, are told a user declined. When a run is stopped by the
   server (idle eviction, maintenance quiesce, live-cap enforcement), the
   subagent's failed calls should say so, so the parent can resume the work
   instead of asking for a permission that does not exist.

Neighbours: [done-but-still-working state](../features/2026-09-11-done-but-still-working-state.md),
[chat stop and background subagents](../decisions/2026-08-25-chat-stop-and-background-subagents.md).
