---
title: "A failed capture chip offers only \"tap to retry\" — no discard, and no sense of how old it is"
workstream: capture-chip-states
area: callback-box
labels: [capture, chat, ui]
filed-by: agent
discovered-by: Ian
discovered-in: main session — boxholder found a months-old failed capture in chat
---

A capture chip in chat reads **"7 photos, 1 clip"** with **"failed — tap to
retry"** underneath. It has apparently been there a long time. There is no way
to dismiss it.

> Not sure what to do with it. There's no discard option.

**Confirmed on the live box (2026-08-20).** `capture.pendingSessions` returns it
as a real staging session in state **`failed:prepare`**, counts
`{photos: 7, files: 0, audioSegments: 1}`, `startedAt` **2026-08-04** — so it
has been surfacing an unactionable retry prompt for **16 days**. This is a
genuine stuck capture, not a display artifact, and it is the *only* durable
capture state the UI has: a delivered capture drops out of this same query and
leaves nothing behind (see
[capture success is invisible](2026-08-20-capture-success-is-invisible.md)).

## Two defects in one small control

**Retry is the only verb.** `CaptureCaption`
(`src/frontend/src/components/chat/capture-bubble.tsx:63-71`) renders a single
`<button>` for the failed state whose only action is the retry `onClick`. No
discard, no dismiss, no "stop showing me this" — so a capture that will never
succeed is a permanent fixture of the conversation.

**The chip is ageless.** `captureBubbleCaption` returns the same
`"failed — tap to retry"` whether it failed ten seconds ago or three months ago.
The reader cannot tell recent-and-worth-retrying from ancient-and-abandoned,
which is exactly the judgement they are being asked to make.

## The backend already knows better than the UI does

`src/core/capture/sweep.ts` classifies precisely this case and takes a
deliberate position on it:

> `failed:*` older than the window → logged once per run (**stale, needs a
> human**) but NOT auto-retried — a repeatedly-failing capture shouldn't loop.

So the system has already decided that (a) this needs a person, and (b) retrying
it automatically is wrong. The UI then offers the person one action — the very
one the sweep declined — and no way to act on "needs a human" in any other
sense. The distinction the sweep draws (fresh failure vs stale failure) never
reaches the surface where the decision gets made.

## Precedent for the fix, from this month

The stuck "Sending message…" row had the same shape — a state with no exit —
and the emission-model workstream resolved it by swapping the caption after 30
seconds pending for *"Still waiting for the box to confirm this message."* with
**Restore / Discard**: a user exit that never manufactures a false verdict.
Applying the same treatment here means an aged failure changes what it says and
grows a second verb.

## What the design has to settle

- **What discard means for staged media.** The staged photos and audio still
  exist — the sweep logs stale artifacts and explicitly never deletes them. So
  discard could drop the staging session, or keep the files and stop surfacing
  the chip. Those are different promises and the label must match whichever is
  chosen; "discard" implying deletion when files remain is its own bug.
- **Whether retry can still work.** If a months-old capture's staging session is
  gone or unusable, then "tap to retry" is a promise the app cannot keep, and the
  aged state should say so rather than offering the action.
- **Whether the chip should persist in the transcript at all** once dismissed,
  or leave a quiet trace ("capture discarded") — a capture that silently
  vanishes is its own kind of confusing.

## Code reading (2026-08-21)

**The discard plumbing is nearly all present.** `cancelCaptureSession` already
exists client-side (`src/frontend/src/pages/capture/capture-api.ts:300`),
`DELETE /api/capture/sessions/:id` already exists
(`src/webapp/routes/capture.ts:185`), and
`discardStagingSessionIfCancellable` explicitly permits this state — "an `open`
batch is still uploading and a `failed:*` one is dead, so both may be thrown
away" (`core/capture/staging-teardown.ts`). Adding the verb is mostly UI.

**But that DELETE route bypasses the guard.** It calls
`cleanupStagingSession` unconditionally (`routes/capture.ts:198`) rather than
`discardStagingSessionIfCancellable`, so it will delete a session that is
mid-`preparing` out from under the background worker — exactly the race the
guard's own doc comment describes ("the worker reads `null` and silently
returns … the user gets no message while their client reports success"). This is
a latent bug independent of the missing discard verb, and the discard work
should route through the guarded path rather than widen use of the unguarded
one.

**The age the chip needs is already in hand:** `startedAt` ships in the
`pendingSessions` payload (`core/capture/pending.ts:34`) and the caption ignores
it. The fresh/stale line the sweep draws is `ABANDONMENT_WINDOW_MS`
(`core/capture/sweep.ts`).

Related: [capture upload error/retry affordance is tiny](2026-08-03-capture-upload-error-retry-affordance-weak.md)
— same family, different surface (that one is the capture overlay's control
being small and giving no click feedback; this one is the chat chip lacking a
verb entirely).
