---
title: "Should chat's stop button keep background subagents running? (`perTaskStopAffordance`, SDK 0.3.246)"
workstream: unattached
area: beebox
priority: normal
filed-by: agent
discovered-by: agent
discovered-in: worktree-sdk-update — reviewing Agent SDK 0.3.246
labels: [sdk-update]
needs: [decision]
---

SDK 0.3.246 adds a `perTaskStopAffordance` option: when set, `interrupt()`
aborts only the current turn and leaves background agents and workflows
running; without it (and for one-shot string prompts) they stop too.

beebox calls `interrupt()` on the chat stop path
(`beebox/src/core/chat/session/index.ts:374`, reached from
`webapp/trpc/routers/chat-control-procedures.ts:212`) and again in
`services/claude-chat.ts:273` and the field-test operator turns. Today every one
of those inherits the "stop everything" semantics, so a boxholder pressing stop
because the visible answer went sideways also silently kills any background
subagent the box agent had launched — including work that was going fine.

**The call to make:** whether chat's stop means "stop talking" or "stop
working". Arguments both ways. Keeping background work alive matches what the
button looks like it does and avoids throwing away minutes of subagent work over
a bad paragraph; but a box agent's background subagents write to the box, so
work the boxholder thought they had cancelled would keep committing, and there
is currently no chat surface listing what is still running or a second control
to stop it. Adopting the option probably implies building that surface first,
which is why this is a decision rather than a one-line flag flip.

The option ships in 0.3.246, which is ahead of the current pin — nothing can be
implemented until the pin reaches it. See the 0.3.246 entry in
`../../docs/agent-sdk-notes.md`.
