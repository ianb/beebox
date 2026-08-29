---
title: "Inject derived session context into Telegram thread sessions"
workstream: unattached
area: callback-box
filed-by: agent
discovered-by: agent
discovered-in: worktree-chores-burn-down — closing the completed web session-context issue
---

Web chat messages receive the derived `<chat-app>` snapshot from
`src/core/session-context.ts`. Telegram-backed chat jobs in
`src/core/reactor/chat-jobs.ts` build their own prompt from the job description
and todo ambient line, so they do not receive local time, last activity, or
near-horizon calendar context.

Add the relevant channel-aware snapshot to new Telegram thread sessions without
making the reusable system prompt time-dependent.
