---
title: "A send rejected as busy is still recorded as delivered, then shows forever as the newest chat message"
workstream: busy-send-rejection
area: beebox
labels: [chat, voice]
filed-by: agent
discovered-by: Ian
discovered-in: main session — a chat on a personal box, 2026-10-14
---

Two voice sends reached one chat 14 ms apart. The second was rejected because
the first had just started a turn. The box still recorded the second as a user
message. The agent never saw it, and nothing retried it. The chat page then
shows it as the most recent message, below all later turns, after every
reload.

## Evidence (a personal box, 2026-10-15 03:57 UTC)

The boxholder ended a long recording, and a second, 2-second recording began
11 ms later. Its live text ended in a send keyword, so it sent at once.

- `events.db`: `chat-user-message` 24145 (message-id `…5f8eec`, the long
  message) and 24146 (`…3a853j`, the short one), both 03:57:39.
- `message-dedup.json`: both message ids recorded as seen.
- `hub-child.log`:
  `03:57:39.361Z [ChatSession:send] Rejected — busy`, then
  `03:57:40.253Z [ChatSession:send] Sending message (1117 chars …)`.
- The Claude transcript for the chat has one enqueue/dequeue pair at
  03:57:40 and the long message only. `3a853j` does not appear in it.
- Capture staging for both recordings: HQ `ready`, handoff `claimed`,
  terminal. The client considers both delivered.

## Two defects

Status: defect 1 is fixed in commit b6721adc0 (the send records its event and
dedup claim only once the session takes its turn; a refused send answers 409
and records nothing). Defect 2 remains open. Existing orphans, such as the one
in the evidence above, are not repaired.

1. **Half-recorded message.** The busy path rejects the send after the user message
   event and the dedup record are written. Nothing queues it for the next
   turn, the client is not told, and the dedup record blocks a client retry.
   The send path should refuse it before anything records it as received,
   and tell the client. Queueing it for the next turn is the wrong default:
   in this case the second send was a mis-send the boxholder did not want
   delivered (boxholder, 2026-10-14). The fix is that a rejected message
   does not end up half-recorded, not that it gets sent.
2. **Orphan placement.** The chat view merges the event log with the
   transcript. A user message present only in the event log has no position
   in the transcript, so it renders after the last turn on every load. A
   message the agent never received should render at its own time and show
   that it was not delivered, with resend and discard. Discard is the likely
   choice for a mis-send like this one.

Where to start: the `Rejected — busy` branch (`beebox/src/core/chat/session/run/core.ts:323`), and where
the `chat-user-message` event and the dedup record are written relative to
it.

## Related

- [Reload loses an in-flight question (closed)](../closed/bugs/2026-08-09-reload-loses-in-flight-question.md).
- [iOS stale unconfirmed-emission banner (closed)](../closed/bugs/2026-08-03-ios-stale-unconfirmed-emission-banner.md).
