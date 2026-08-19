---
title: "iOS audio retranscription"
status: active
workstream: ios-retranscribe
issues:
  - ../../../issues/bugs/2026-08-19-ios-dictated-messages-cannot-be-retranscribed.md
---
# iOS audio retranscription

`cb chat retranscribe --message <id>` and `cb chat ask-about-audio` fail for
every message dictated in the native iOS composer, because nothing on the iOS
send path leaves the recording anywhere the retranscribe path can reach. The
failure and its trace are recorded in
[the issue](../../../issues/bugs/2026-08-19-ios-dictated-messages-cannot-be-retranscribed.md);
this plan is the fix.

**Decision taken (2026-08-19, boxholder).** Of the three directions the issue
lays out, the chosen one is **native retains, and answers the request when
asked**. Audio does not get uploaded at send, and does not sit at rest on the
box; the phone keeps the bytes and hands them over only when an agent actually
asks. Whether durable server-side audio is ever wanted is explicitly parked, not
rejected — it stays available as a later addition for the asleep-phone case
without invalidating anything here.

## The shape

Today the web tab is the only thing that can answer. The change makes the phone
a second answerer of the *same* request, over the *same* endpoint, with the same
echo-and-verify rules:

```
cb chat retranscribe --message M
  → POST /api/chat/last-audio/request        (long-poll, parks with target M)
  → bus: chat-last-audio-request {requestId, messageId}
      ├── every web tab answers from its in-memory retention store
      └── a tab in the native shell ALSO relays to the phone,
          which answers from its on-disk retention store
  → POST /api/chat/last-audio/:requestId     (multipart audio, echoing M)
```

### Why the server needs no changes

Two properties already in `core/last-audio-pending.ts` make this work as-is, and
both are load-bearing enough to name:

- **A `none` answer does not settle the request.** Each request's grace window
  defaults to its own `timeoutMs` (the 2026-08 fix in `create()`), precisely so
  an instant chorus of "none" from tabs that don't hold the recording cannot cut
  off a slower answer from one that does. The phone is exactly such a slower
  answerer — it must read a file and upload it while web tabs answer in
  milliseconds. Without that property this design would lose every race.
- **Echo-and-verify already scopes the answer.** `fulfill()` ignores any answer
  whose echoed `messageId` doesn't match the target, without settling the
  request. The phone is subject to the same check as any tab; a phone holding a
  different recording cannot win, it simply isn't the answerer.

So the box server is untouched. The work is one relay web-side and one answerer
native-side.

## Track 1 — web relays the request to the native shell

`fulfillLastAudioRequest` (`src/frontend/src/lib/audio/last-audio.ts`) already
receives everything the phone needs: `requestId`, `messageId`, and the tab's own
`sessionId`. When `isNativeShell()` is true it posts them to the shell on a new
`callbackboxLastAudioRequest` channel, then answers from its own retention store
exactly as it does now.

Both answers are correct and neither is wasted: the web store legitimately holds
recordings for anything dictated in the *web* composer inside the WKWebView, and
its `none` is harmless by the grace-window property above.

`isNativeShell()` is used rather than threading an `enabled` prop down from
`InteractiveChat`, because it keys off the document-start bridge function — the
same signal `native-post.ts` already treats as the definition of "in a shell",
and one that survives in-app navigation.

## Track 2 — native retains the recording

A new `VoiceAudioRetentionStore` (actor, `ios-app/CallbackBox/Storage/`) keyed by
emission id, mirroring the web `RetentionStore`'s vocabulary and its capacity of
5. Per box, under `Application Support/voice-retention/<boxID>/`: the WAV as
`<emissionId>.wav` plus a small JSON index carrying `recordedAt` and the message
text (both ride the answer as multipart fields today).

It is deliberately **not** the existing `ComposerDraftRepository` payload store.
That store's lifecycle is draft-and-pending-scoped — payloads are swept the
moment an emission is delivered, which is the exact moment retention must begin.
Entangling the two would mean one of the two lifecycles has to bend.

Retention happens on both send shapes, replacing today's deletes:

- **`.live`** (`NativeComposerView.swift:559`) — the WAV is deleted immediately
  today. It moves into retention instead, keyed by the id `pendingStore.enqueue`
  returns. This is the case that matters most: `.live` is the ordinary
  narration-off send, which is precisely what retranscription exists to fix.
- **`.hq`** — the staged copy is deleted in `finishVoicePreparation`
  (`PendingEmissionStore.swift:146`); it moves into retention instead. The
  preparation id is already the emission id, so no new identity plumbing.

Retention outliving the pending emission is the point, so the sweep on receipt
(`removePayloads`) stays as it is and does not touch the retention store. It must
not outlive the *message*, though — a discarded send, or one pulled back into the
composer, drops its recording. A **rejected** send keeps its recording, because
`retry` can still send it.

Unpairing a box removes its retention directory — the recordings are that box's —
and does so **synchronously**, on the same path that drops the pairing. Handing
it to a task would let the app be suspended in between, leaving audio on disk for
a box the user has just removed. (Both lifecycle points came from cross-model
review.)

## Track 3 — native answers

`ChatWebView` gains the `callbackboxLastAudioRequest` script-message channel and
routes it, like the existing composer-command channel, out to the app. The
answer is a direct HTTP call (`ChatAPI.answerLastAudio`), not a bridge round
trip: multipart to `/api/chat/last-audio/:requestId` with `file`, `recordedAt`,
`text`, `messageId`, and a `sessionId` (see below) — or `{"none": true}` as JSON
when the store doesn't hold that id.

The phone answers `none` rather than staying silent when it doesn't hold the
recording. Silence would be indistinguishable from a phone that is asleep, and
the `none` costs nothing given it cannot settle the request early.

`sessionId` needs care. It addresses the retranscription report — the CLI passes
the echoed value to `buildRetranscriptionReport`, whose bus event the web matches
against its own session — so answering with the phone's *currently visible*
session would post the correction to whichever conversation the user happens to
be looking at, not the one the message is in. Native therefore stores the session
each recording was dictated into (`box.sessionID` at send time, which is the
visible chat session) and echoes that, falling back to the relayed tab's session
when it has none. Raised by cross-model review.

## What this does not fix

Stated plainly so it isn't discovered as a surprise:

- **A phone that isn't reachable within the long-poll window** (10s default, 30s
  max) cannot answer. The agent gets the existing `no-client` 504, which already
  describes itself as transient. This is the known cost of the chosen direction.
- **Recordings made before this ships** are gone; nothing can recover them.
- **The web-reload half** of
  [the first-message issue](../../../issues/bugs/2026-08-18-first-message-audio-not-retranscribable.md)
  is untouched — that is the web store's memory-only lifetime, a separate fix.

## Verification

Automatable, and expected of this change:

- XCTest over the retention store: retain/evict at capacity, survive relaunch,
  answer shape for a hit and for a miss, per-box isolation, and the session
  precedence above.
- The existing mobile-contract fixture discipline for the new channel.
- A frontend doctest that the relay fires in a native shell and not otherwise.

Not automatable — **one narrow device check, for the boxholder**: dictate one
message in the iOS composer with narration off, then run
`cb chat retranscribe --message <id>` against it. Expected: a transcript, not
"No recording is cached for this message." An agent cannot produce speech into a
live box, so this single step is the one thing that settles whether the path
works end to end.
