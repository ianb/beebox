---
title: "Inject derived session context into Telegram thread sessions"
workstream: chores-burn-down
area: beebox
resolution: implemented
filed-by: agent
discovered-by: agent
discovered-in: worktree-chores-burn-down — closing the completed web session-context issue
---

**Closed:** This commit prepends the shared situational snapshot to every Telegram chat job. New or rotated sessions receive elapsed time from that thread's prior reactor session. The snapshot omits web-only UI features, and the reactor prompt explains the Telegram context.

Web chat messages receive the derived `<chat-app>` snapshot from
`src/core/session-context.ts`. Telegram-backed chat jobs in
`src/core/reactor/chat-jobs.ts` build their own prompt from the job description
and todo ambient line, so they do not receive local time, thread activity, or
channel context. The current shared snapshot has no calendar attribute; this
issue does not reintroduce the older calendar-context experiment.

Add the relevant channel-aware snapshot to new Telegram thread sessions without
making the reusable system prompt time-dependent.
