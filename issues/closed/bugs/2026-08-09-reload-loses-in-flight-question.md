---
title: "Reload during/just after a chat turn can lose the user's in-flight question"
workstream: live-vs-stored
area: callback-box
filed-by: agent
discovered-in: worktree-integration-tests — field-test spine run; spun out of chat-status-lies-after-completion
labels: [field-test-findings, code-error]
resolution: implemented
---

Closed 2026-08-25 by commit `97c57780` (workstream `live-vs-stored`,
reproduction pinned in `2bd186e2`) — `chat.bootstrap` now reports box-accepted,
not-yet-durable messages as `pending`. The "Not covered (deliberate)" section
below records three intentionally out-of-scope residuals, not blockers.

During the field-test spine run, a page reload while a turn appeared stuck
seemed to lose the user's just-sent question entirely — it was not in the
rendered history after reload.

Investigation (while closing
[chat-status-lies-after-completion](2026-08-08-chat-status-lies-after-completion.md))
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

## Fixed (2026-08-25)

`chat.bootstrap` now reports what the box has **accepted but not yet made
durable**, as a field of its own (`pending`) rather than merged into `entries`
— `history` keeps meaning "what is on disk", which is what every other reader
of it assumes.

- `core/chat/session/accepted-messages.ts` reads a bounded, time-limited tail of
  `chat-user-message` off the bus. Bounded in time to ten minutes, matching
  `RUN_START_TIMEOUT_MS`: a message still absent from the transcript after the
  longest a cold spawn is given is not pending any more, and rendering it
  forever would be a comfortable lie rather than a true "not yet".
- The bus grew `readRecent({ event, limit })` for this. `readSince(afterId)`
  answers "what have I missed", which needs a cursor a page load does not have.
- The server deliberately does **not** filter these against the transcript. The
  client already owns that comparison (`reconcilePending`), and a second
  implementation server-side could disagree with it. The client folds them into
  `pendingMessages` and reconciliation retires each one as the transcript
  catches up, exactly as for a locally-minted optimistic copy.
- `mergeAcceptedIntoPending` (`frontend/src/machines/chat-shared.ts`) keeps the
  two sides from doubling: in the window where a send lands while the initial
  fetch is still in flight, this page's optimistic copy and the box's accepted
  record describe the same message. Matched through the same normalizer
  reconciliation uses (the server injects `user=`/`user-email=` attributes the
  optimistic copy never carried), consumed one-for-one so a person who really
  did send the same words twice keeps both.
- `ChatPage` now carries a preload for `rendered === "new"` when the box has
  accepted messages with no session yet — the `kind: "empty"` case, which is the
  one the field report described and the one that previously showed nothing at
  all.

Verified in the running app: with the only record of a message being its
acceptance on the bus, a bare `/chat` load renders it instead of a blank chat.
Covered by `test/webapp/chat-reload-loses-in-flight.doctest.md` (the
reproduction, now carried through to the fix) and the
`mergeAcceptedIntoPending` cases in `test/frontend/reconcile-pending.doctest.md`.

## Not covered (deliberate)

- **A stuck send eventually goes quiet.** A message accepted more than ten
  minutes ago and still not durable falls out of the window and stops being
  shown. Bounding it is right — rendering it forever would be a lie — but the
  message deserves a visible terminal state ("this never sent") rather than
  silence. Separate work; the same shape as
  [nothing-retries-forever](../../issues/).
- **A `?session=new` URL on a box that cannot coin.** The web client normally
  coins a session id and reserves it before the first send
  (`pages/chat-coin-session.ts`), so the URL carries a real id by the time
  anything is sent and the acceptance record matches by session. A box whose
  engine cannot coin (Codex) keeps the `"new"` sentinel, and `ChatPage` disables
  the bootstrap query for it — so that reload still comes back blank. Covering
  it means a bootstrap round trip on every new-chat open, which is a real cost
  paid by every box to fix one engine's case.
- **Two new chats at once, same person.** Two tabs each starting an unassigned
  chat would each show both pending messages, since neither has a session id to
  tell them apart and the sender is the same. Narrow, and it self-corrects the
  moment either engine assigns an id.
