---
title: "Reload during/just after a chat turn can lose the user's in-flight question"
workstream: live-vs-stored
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

## Reproduced (2026-08-25) — and it is worse than "a slice from before the turn"

`test/webapp/chat-reload-loses-in-flight.doctest.md` pins it deterministically at
the route tier. A send is accepted, the durable claim is on disk, the persisted
`chat-user-message` is on the bus — and `chat.bootstrap` answers
**`kind: "empty"`**. Not a history missing one entry: no session at all.

That is the field report exactly. A message that opens a **new** chat is accepted
*before* the engine has assigned a session id, so a reload in that window has
nothing to resolve and lands on a blank chat — no history, no session, no sign
the message was ever sent.

## The mechanism, corrected twice

- **Not** "the reload raced the transcript write by milliseconds" (the original
  guess). For an existing session that is roughly right — `transcript-sync.ts`
  measures the subprocess's flush lag at ~150 ms. For a **new** session the
  window lasts until the engine starts and the id is recorded, and a cold spawn
  is allowed ten minutes (`chat-send-run.ts` `RUN_START_TIMEOUT_MS`). Hence
  "reloaded while the turn appeared stuck".
- **Not** "the SDK batches transcript writes until the turn ends" (a later guess,
  checked and discarded). `TranscriptMirrorBatcher` in the vendored SDK only runs
  when the `sessionStore` option is set — this codebase never sets it — and it
  mirrors to an *external* store after the local write succeeds (`sdk.d.ts:4984`).

The real shape: **acceptance and history are two different records, and only one
of them is consulted on reload.** `recordUserMessage`
(`webapp/routes/chat-send-routes.ts:143-150`) emits a persisted bus event and
takes the durable claim — its own comment says *"recording it IS acceptance"*.
`chat.bootstrap` reads the transcript and nothing else
(`core/chat/session/load-history.ts`). Live clients bridge the gap with an
in-memory optimistic copy plus the bus event over the WebSocket
(`InteractiveChat-ws.ts:252`); a reloaded page has neither.

## Proposed fix

Have `chat.bootstrap` return the messages the box has **accepted but not yet
made durable in the transcript**, as a separate field — not merged into
`entries`. The client already knows what to do with that shape: it feeds them
into `pendingMessages`, and the existing `reconcilePending`
(`frontend/src/machines/chat-shared.ts:81`) retires each one as the transcript
catches up. No new dedup logic server-side; the client's is already doctested.

Details to settle when building:
- The bus needs a bounded "recent events of this type" read; today it exposes
  `readSince(afterId)` only.
- Bound it in time (~10 min, matching `RUN_START_TIMEOUT_MS`) and then stop
  claiming it — a message still not durable after that is a failure to surface,
  not a pending state to render forever.
- The `kind: "empty"` case is the important one and the awkward one: a
  pending-new send has `sessionId: null` on its bus event, so these cannot be
  keyed by session.

## Blocked on sequencing, not on design

Two live worktrees — `emission-model` and `capture-chip-states` — are both
actively restructuring `chat-shared.ts`, `chatMachine.ts`, `chat-types.ts` and
`chat-actors.ts`, and both are net-*deleting* from the pending/reconcile
machinery this fix would extend. Building the client half here means a
three-way conflict on files two streams are rewriting, possibly on top of a
shape they are removing. The server half is additive and safe; the client half
should wait for those to land, or be done inside one of them.
