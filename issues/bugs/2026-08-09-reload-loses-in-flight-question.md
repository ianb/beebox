---
title: "Reload during/just after a chat turn can lose the user's in-flight question"
area: callback-box
filed-by: agent
discovered-in: worktree-integration-tests — field-test spine run; spun out of chat-status-lies-after-completion
labels: [field-test-findings, code-error]
---

During the field-test spine run, a page reload while a turn appeared stuck
seemed to lose the user's just-sent question entirely — it was not in the
rendered history after reload.

Investigation (while closing
[chat-status-lies-after-completion](../closed/bugs/2026-08-08-chat-status-lies-after-completion.md))
established the reload path is HTTP-only and disk-backed: `fetchInitialActor`
(`src/frontend/src/machines/chat-actors.ts`) calls `chat.bootstrap` /
`getChatHistory`, so a *finished* turn must appear. Losing the question
therefore means either the reload raced the transcript write itself, or the
bootstrap's history read returned a slice from before the turn persisted its
first frame — the optimistic user-side entry (`pendingMessages` in
`chatMachine.ts`) does not survive a reload, so anything not yet durable
vanishes from view.

Needs a live repro: send a message, reload at varying delays, and check when
the user message becomes durable in the session transcript vs. when it first
survives a reload. If the message is written at turn start (as
`chat-send-routes.ts` suggests), the window should be milliseconds — measure
whether it actually is, and whether the observed loss was instead the
20-minute wedge making a mid-flight reload likely.
