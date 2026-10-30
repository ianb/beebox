---
title: "Chat shows a message the agent never got as not delivered"
status: implemented
workstream: bug-burndown-5
issues:
  - ../../../issues/closed/bugs/2026-10-14-busy-rejected-send-recorded-then-orphaned.md
---
# Chat shows a message the agent never got as not delivered

A chat message that the box accepted into its send queue can be dropped before
the agent receives it: `stop()` empties the queue. Today the chat page then
shows that message as "queued" until it ages out. This plan records the drop,
and the chat page shows the message as not delivered, with Resend and Discard.

**Issues addressed:**
[busy-rejected-send-recorded-then-orphaned](../../../issues/closed/bugs/2026-10-14-busy-rejected-send-recorded-then-orphaned.md)
(defect 2 rendering and the dropped-queue re-encounter; placement is already
fixed on this branch). Searched `issues/` for "undelivered", "not delivered":
the only other hits are closed and unrelated (a reminder notification, quick
chat's start failure).

Human decision (2026-10-27): *"sure, show not delivered. Fine about empty chat
I guess."* The issue's lean for the dropped queue was "mark undelivered, do not
replay"; this plan takes it, because the only remaining way a message becomes
undelivered is the dropped queue (defect 1's refused send now records nothing,
`src/webapp/routes/chat/user-message-sender.ts:133-138`). The one exception
is on the client: a queued send the server refuses (Track 2).

Human decision after the plan review (2026-10-27): keep the record on the
event log, not a durable ledger. Accepted with it: the mark lasts at most 24
hours (startup prunes older rows, `src/webapp/server/app.ts:253`) and vanishes
when an engine update bumps the event-schema generation
(`src/core/event-bus/core.ts:32-37`). A crash, which runs no `stop()`, loses a
queued message with no mark.

## Design

### Situations

- When Priya ends a voice message just as the box restarts for a deploy, I
  want to see that the agent never got it, so I can send it again instead of
  waiting for a reply that will not come.
- When Tomas sent a message by mistake (a voice recording that ended on a
  send word) and it was dropped, I want to remove it, so the chat does not
  show a question nobody asked.
- When Priya reloads the chat an hour later, I want the dropped message still
  marked, so a deploy at night does not erase it without a trace. (Holds for
  up to 24 hours; see the decision above.)
- When a message is only waiting behind the current reply, I do not want it
  marked as failed. It is still on its way.

### Right place, right time

| Situation | Act, show, or quiet | Surface and card | Attention |
|---|---|---|---|
| Dropped by a restart | Show | The user message bubble, at the place it was sent | Waits to be found |
| Mis-send | Show, person acts | Same bubble, Discard | Waits to be found |
| Reload later | Show | Same bubble | Waits to be found |
| Waiting in queue | Quiet (existing "queued" edge) | Same bubble | Background |

No notification. The person is either looking at the chat or will see the
bubble on their next visit; a drop does not need to interrupt.

### Spirit

- **Serves:** "You should be able to see the gears" (`docs/architecture/spirit.md`)
  — the box says what happened to the message instead of showing a state that
  is no longer true.
- **Risks:** "It should feel like a place" — a red-edged bubble left in old
  chats is clutter. Guard: Discard removes it, and Resend replaces it.

### Trust

Shows only. The box takes no action on its own: it does not resend. Resend and
Discard are the person's actions.

### When it goes wrong or does nothing

- Resend fails (a 409 or network error): the existing send-failure path shows
  the error, and the not-delivered bubble stays, so the words are not lost.
- Discard fails: the bubble stays and the error shows inline.
- An orphan from before this change (no message id on its record) cannot be
  marked. It looks queued until it ages out, as now.

### Walkthrough

1. Priya sends "Add oat milk to the list" while a reply is streaming. The send
   route answers `{queued: true}` and records `chat-user-message` with her
   message id.
2. A deploy restarts the server. `stop()` drops the queue. The box records
   `chat-user-message-undelivered` with that message id.
3. Her open page gets the event over the bus. Her bubble loses the dashed
   "queued" edge and shows a red edge and the line "Not delivered", with
   Resend and Discard.
4. She taps Resend. The words are sent as a new message, and the old bubble is
   discarded. The record keeps both events, so the history is not rewritten.

## Smallest fix and budget

Smallest fix: client-only. Mark a pending message "not delivered" when the
session is idle and the message is still unreconciled. It fails because the
client cannot tell "dropped" from "the transcript write is late", and after a
reload it has no record at all past the 10-minute accepted window
(`ACCEPTED_WINDOW_MS`, `src/core/chat/session/accepted-messages.ts:46`).

Chosen: three chunks.

- Server record: about 120 source lines, 120 test lines.
- Client marking and reconciliation: about 80 source lines, 100 test lines.
- Bubble and actions: about 100 source lines, 60 test lines.

Total about 580 changed lines. No authored docs beyond comments and the issue
note. Not a BIG CHANGE.

## Stated preferences this plan trades against

- `AGENTS.md`, minimize invented concepts (memory "prefer primitives"): two new
  bus events instead of a new store. The bus is already the record that
  accepted messages are read from.
- The issue's boxholder note: *"Queueing it for the next turn is the wrong
  default … the second send was a mis-send the boxholder did not want
  delivered."* No automatic replay.
- `docs/engineering-principles.md` fail-closed: Discard is refused unless an
  undelivered marker exists for that message, so it cannot hide a delivered
  message.

## What already exists

- `chat-user-message` bus event, persisted
  (`src/core/event-bus/schemas.ts:167-172`). Reuse; add optional `messageId`.
- `readAcceptedMessages` (`src/core/chat/session/accepted-messages.ts:137`)
  returns accepted messages to `chat.bootstrap`
  (`src/webapp/trpc/routers/chat/bootstrap-procedure.ts:126`). Reuse; it reads
  the markers too.
- Session-to-bus bridge in `src/webapp/routes/chat/register.ts:169-174`
  (`session.on("done", …) eventBus.emit("chat-complete", …)`). Reuse the same
  pattern for the drop.
- Client bus handler `src/frontend/src/components/chat/everywhere/InteractiveChat/ws.ts:256-300`.
  Add one branch.
- Optimistic copy uuid is the message id (`chat-actions.ts:50`: `uuid: event.messageId`).
- Failed-capture bubble with Retry and Discard
  (`src/frontend/src/components/chat/capture-bubble.tsx:169-200`). Reuse its
  button pattern and danger colors (`bg-danger`, `text-danger-dark`).
- Queued render in `src/frontend/src/components/chat/user-message/view.tsx:176-180`
  (`QUEUED_EDGE`, `PendingIndicator`). Extend with the undelivered state.

## Prior art (external)

No decision depends on an external premise. Messaging apps (iMessage, Signal)
show "Not Delivered" with a retry on the bubble; that is the common pattern,
evaluated-only.

## Ontology

- **Message id**: the client's id for one send (`messageId` in the send
  body; the dedup key in `send-dedup.ts`). Exists. Not the bus row id.
- **Accepted message**: a `chat-user-message` bus row. Exists.
- **Undelivered marker**: new persisted bus event
  `chat-user-message-undelivered { sessionId, messageId, timestamp }`. Means
  the box accepted the message and the agent will never receive it from this
  acceptance.
- **Discard marker**: new persisted bus event
  `chat-user-message-discarded { sessionId, messageId, timestamp }`. Means the
  person removed an undelivered message. Not a deletion of the accepted row.
- **Undelivered entry**: a `PendingSessionEntry` with `undelivered: true` and
  `messageId`. It reconciles like any pending entry.

## Tracks / scope

### Track 1: record the drop (server)

- **What:** carry the message id from the send into the queue, and record an
  undelivered marker for each client message `stop()` drops.
- **Why:** `stop()` runs `this.messageQueue = []`
  (`src/core/chat/session/run/core.ts:455`) with no record, so nothing can
  tell a dropped message from a waiting one.
- **Direction:**
  - `ChatSendInput.messageId?: string` (`src/core/chat/session/messages.ts:86`).
    The sender sets it on the enqueue at `user-message-sender.ts:92-94`.
  - `chat-user-message` gains `messageId: z.string().optional()`, set in
    `recordUserMessage` (`user-message-sender.ts:76-81`).
  - `stop()` emits session event `"queue-dropped"` with the dropped inputs
    before clearing. `register.ts` bridges each input that has a `messageId`
    to `chat-user-message-undelivered`. Self-notes (`clientComposed`, no id)
    drop as before.
  - `readAcceptedMessages` reads recent undelivered and discarded markers. A
    discarded message is skipped. An undelivered one is returned with
    `undelivered: true` and `messageId`, and the 10-minute window does not
    apply to it. The 50-row scan bound and the bus's 24-hour retention still
    apply.
  - `stop()` marks every input it loses, whether or not a run is live. Today
    it clears the queue only with a live run (`run/core.ts:448-457`), but every
    caller then discards the session (shutdown, idle sweep, LRU cap, delete,
    reset), so an idle queue is lost too. It also marks the inputs of a drain
    in flight: `drainSessionQueue` splices the queue before its send resolves
    (`src/core/chat/session/state.ts:266`), so the session keeps those inputs
    in a field until the send settles.
  - `chat-user-message` also gains `hadImages: z.boolean().optional()`, set
    before the image tokens are stripped, so a reloaded bubble knows Resend
    cannot carry the images.
  - New tRPC mutation `chat.discardUndelivered({ sessionId, messageId })`.
    It records the discard marker only when an undelivered marker exists for
    that pair, otherwise it answers a not-found error.
  - The dedup claim stays. Resend sends with a new message id, so the claim on
    the old id never blocks it.
- **Vocabulary lock-ins:** event names `chat-user-message-undelivered`,
  `chat-user-message-discarded`; field `messageId` on `chat-user-message`.
- **First chunk:** schema fields, `stop()` event, bridge, reader changes,
  mutation. Test: the issue's probe (queue a send behind a streaming fake
  turn, `registry.shutdown()`), then bootstrap returns it with
  `undelivered: true` after the 10-minute window; discard hides it; discard
  of a delivered message is refused.

### Track 2: mark it on the client

- **What:** the client learns of the marker live and on load, and shows
  the entry as undelivered.
- **Why:** without this, the bubble stays "queued" until it ages out.
- **Direction:**
  - `SessionEntry` gains `undelivered?: true` and `messageId?: string`
    (`src/frontend/src/api-chat.ts`, shared with the server's
    `cli/lib/session-entry.ts`).
  - ws branch for `chat-user-message-undelivered` sends machine event
    `MESSAGE_UNDELIVERED { messageId }`. The action marks the pending entry
    whose `messageId ?? uuid` equals it.
  - The marker reaches tabs that hold no entry for it (a second tab of the
    same person ignores the `chat-user-message` broadcast, `ws.ts:281`;
    another user's copy has a synthetic uuid, `chat-actions.ts:94`). When no
    entry matches, the tab refetches the bootstrap's accepted list.
  - `mergeAcceptedIntoPending` (`chat-shared.ts:97`) matches an accepted copy
    to an optimistic copy by `messageId` first, and by text only for rows
    without one. The match takes the accepted copy's `undelivered`.
  - `reconcilePending` treats undelivered entries like other pending ones. If
    the transcript holds the message after all (a drain admitted during
    `stop()`), it was delivered, and the bubble retires.
  - A queued send the server refuses (`queueMessageToBackend`,
    `chat-actors.ts:399`, which today only settles the receipt) marks its
    optimistic entry undelivered on the client. Discard of that entry removes
    it locally: the server recorded nothing.
- **First chunk:** the type fields, the machine event, merge and reconcile
  changes, with machine tests.

### Track 3: the bubble

- **What:** an undelivered own message shows a danger edge, "Not delivered",
  and Resend and Discard. Another user's undelivered message shows the edge
  and line without buttons.
- **Direction:** in `user-message/view.tsx`, `isUndelivered` takes precedence
  over `isPending`. Resend sends the bubble's displayed text through the
  normal send (new message id), then calls discard on the old one. A message
  with images (`hadImages`, or image blocks on the optimistic copy) offers
  Discard only, with the line "Not delivered — images were not kept", because
  the bus row has no image bytes (`accepted-messages.ts`, the `IMAGE_TOKEN_RE`
  comment). Discard calls the
  mutation and removes the pending entry on success.
- **First chunk:** render and both actions, DOM test for the three faces
  (queued, undelivered own, undelivered other) and browser check on test1.

## Could this be simpler?

Simplest: Track 1 and 3 without the discard marker: Discard only hides the
bubble in this page. It fails on reload: the message comes back, which
contradicts the person's action. The fuller plan buys a discard that holds.

Simpler still: keep the 10-minute window for undelivered messages. It fails
the night-deploy situation: the message vanishes without a trace, which is the
"comfortable lie" `accepted-messages.ts:41-44` warns about.

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| `stop()` drops a queued send with no `messageId` (an old client) | Planned | Skipped, as today | Silent (looks queued, ages out) — accepted, old clients only |
| Server crashes instead of stopping (no `stop()`) | No | No | Silent — accepted by the boxholder |
| `stop()` during an in-flight drain | Planned | Marks the in-flight inputs | Clear |
| Queued send refused by the server | Planned | Marked on the client | Clear |
| Bus pruned (24 h) or truncated (schema bump) | No | No | Silent — accepted by the boxholder |
| Discard for a delivered message | Planned | Refused | Clear |
| Resend succeeds, discard fails | Planned | Old bubble stays, error shown | Clear |
| More than 50 later sends push the row out of the scan | No | No | Silent — the marked message disappears |

> **Accepted risk (boxholder, 2026-10-27):** a crash loses queued messages
> with no marker, and the bus keeps a marker for at most 24 hours. A durable
> ledger of queued messages would cover both; it was offered and declined.

> **Accepted risk:** the 50-row scan bound. An undelivered message survives
> 50 later sends on the box, which covers the "next visit" situation.

## Agent-flow / user-flow edge cases

- Two tabs of one person: ADDRESSED. Both get the bus event; each marks its
  copy by `messageId ?? uuid`.
- Identical sends with different outcomes: ADDRESSED. Merge matches by
  `messageId` first.
- Resend while a reply streams: ADDRESSED. It queues like any send.
- Discard by another user in a shared chat: ADDRESSED. No buttons on another
  user's bubble; the mutation does not check the sender, an accepted risk on a
  shared box.
- Transition state: messages accepted before deploy have no `messageId`; they
  behave as today.

## NOT in scope

- Replaying the queue after restart: rejected by the boxholder's mis-send note.
- Messages sent into an empty chat still go last (boxholder, 2026-10-27).
- The drain refused by `sendReadiness` (issue's "Related" paragraph): the input
  stays queued, it is not dropped.
- Repairing existing orphans on personal boxes.
- Removing the dedup claim: not needed, Resend uses a new id.

## Open design questions

none

## Plan review (codex gpt-6-sol, 2026-10-27)

Seven findings, all checked against the source. Adopted: in-flight drain and
idle-queue drops (Track 1), tabs with no matching entry, merge by
`messageId`, the `hadImages` flag, refused queued sends (Track 2). The event
log's retention and the crash gap went to the boxholder, who kept the event
log. One change of mine follows from adopting the in-flight-drain fix:
undelivered entries reconcile normally, since a drain admitted during `stop()`
can still deliver.

## Knowledge audits

No box-agent guidance changes; the agent never sees these markers.
