---
title: "The first message of a chat can't have its audio retranscribed"
workstream: unattached
area: callback-box
labels: [chat, voice, transcription]
filed-by: agent
discovered-by: Ian
discovered-in: main session — boxholder noticed retranscribe failing on first messages
---

Retranscription appears to fail on the **first message sent to a chat**, while
later messages in the same conversation work. The boxholder's read: the audio is
"probably lost in the transition" — the handoff from composing/sending into an
established session.

**Unverified.** Nobody has reproduced this deliberately or traced where the
recording goes; the observation is from ordinary use. Reproduce before fixing —
the mechanism below is a hypothesis, not a finding.

## Why it matters more than one missing recording

The failure teaches the wrong lesson. An agent that tries to retranscribe the
first message, fails, and concludes *"audio retranscription doesn't work here"*
will not try again for the rest of the conversation — including on every later
message that would have succeeded. One missing recording turns into a
capability the agent has written off.

That is what makes a first-message-specific failure worse than a random one: the
first message is the one an agent is most likely to reach for, because it is
often where the request being clarified was made.

## Mitigated already (2026-08-18), but not fixed

The blast radius was reduced without touching the cause:

- `src/webapp/routes/chat-last-audio-routes.ts` — the `no-audio` 404 now says
  the miss is about *this* message and that other messages in the conversation
  may still have audio, rather than "no recording is cached for the last
  message". The `no-client` 504 likewise now names itself as transient.
- `src/core/chat/session/prompts.ts` — the chat prompt states that a failure is
  about one recording rather than the capability, and calls out the first
  message specifically as the likely miss.

Both are about how the failure *reads*. The recording is still missing.

## What to actually investigate

- **Where the first message's audio is supposed to be cached**, and whether it
  is ever written. The fetch is a loopback long-poll answered by a connected
  chat tab (`chat-last-audio-routes.ts`, `core/last-audio-pending.ts`), so the
  question is whether the tab holds the blob for a message it sent before the
  session existed.
- **Whether "first message" is really the axis**, or whether the true axis is
  something correlated with it — a tab that reloaded on send, a session that was
  created by the send itself, a navigation between composing and the established
  conversation. The 404's own wording ("recorded before the chat tab was last
  loaded") suggests a reload is the mechanism, which would make this about
  *tab lifetime*, not message ordering.
- **Whether the retention/tombstone path is involved** —
  `test/frontend/lib/retention.doctest.md` already models a null-payload
  "no-audio tombstone", so there is existing vocabulary for a recording that is
  known-absent rather than merely missing.

## Related

The cold-start family this may belong to:
[chat send receipts fail](2026-08-04-chat-send-receipts-fail-often-message-actually-sent.md)
— the first send after a cold agent races its own receipt. If the first
message's audio is lost during the same transition, these are two symptoms of
one under-specified handoff, and worth investigating together rather than
separately.
