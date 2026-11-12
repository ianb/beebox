---
title: "Warn before a box's Claude sign-in expires, using the SDK's `credential_expires_at`"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-sdk-update — reviewing Agent SDK 0.3.318
labels: [sdk-update]
---

Agent SDK 0.3.318 (published 2026-11-03) adds an optional
`credential_expires_at` to result messages: the time the stored claude.ai
sign-in in use ends. Claude Code 2.1.318 reports the same date in
`claude auth status` (`loginExpiresAt`).

Since the per-box-user migration (2026-10-25), each production box runs its
Claude sessions on its own long-lived Claude token. When one expires, that
box's chats, agent runs and schedules fail at start with "Failed to
authenticate", and nothing says so ahead of time. The same failure stopped the
`sdk-update` schedule on 2026-10-20 ("OAuth session expired and could not be
refreshed").

Every agent run and chat turn already reads the result message
(`beebox/src/core/agent/invoke/stream.ts`, `services/claude-chat/core.ts`).
Reading `credential_expires_at` there and recording the earliest date per box
would let the box warn its person some days before the token ends, where the
person already sees box health.

Needs the Agent SDK pin at 0.3.318 or later (settles 2026-11-05T21:55Z). The
field is optional; an absent value means no claude.ai sign-in is in use (for
example an API key) and needs no warning.
