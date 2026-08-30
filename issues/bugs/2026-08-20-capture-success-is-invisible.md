---
title: "A capture that succeeds says nothing — success is a chip disappearing, so the user assumes it failed and re-captures"
workstream: capture-chip-states
area: beebox
labels: [capture, chat, ui, feedback]
filed-by: agent
discovered-by: Ian
discovered-in: main session — boxholder could not tell whether a capture had landed
needs: [manual-testing]
---

> **⏳ Awaiting manual testing** — fix landed in `9e6caef8`. A capture now
> reports which step it is on and how long it has taken, and resolves in place
> with a "delivered" face instead of the row vanishing. Only the developer
> clears this.

> Turns out it actually did go through. I just couldn't tell.

Capture delivery works. The user cannot see that it worked, and acts on the
assumption that it did not.

## The signalling is inverted

`useCaptureBubbles.ts:6-9` states the model plainly:

> The query is refetched on every capture-status event (and on mount); **a
> delivered capture cleans up its staging session, so it simply drops out of
> the next query result** — no client-side reconcile needed.

So the in-flight chip is a *pending* indicator, and **success is rendered as
disappearance**. A delivered capture is then re-rendered separately as a
`CaptureChip` in the transcript (`CaptureChip.tsx:1-6`), arriving
asynchronously — measured on a live box, roughly a minute after the capture is
sealed.

The result is an asymmetry pointing the wrong way:

- **Failure is loud and permanent.** A `failed:*` staging session persists in
  `capture.pendingSessions` indefinitely — verified on a live box, one has been
  sitting in `failed:prepare` for 16 days
  ([and cannot be discarded](../closed/bugs/2026-08-20-failed-capture-chip-cannot-be-discarded.md)).
- **Success is a silent swap** — one element vanishes, another appears
  somewhere else in the transcript a minute later, with no moment that says
  "this landed".

The only states with a durable visual identity are the bad ones.

## What it cost, on one live box in one evening

Reconstructed from a session transcript (structural detail only):

1. The user typed a throwaway greeting to open the chat — required by the
   ["send a message first" gate](../closed/features/2026-08-20-cannot-capture-into-a-new-chat.md).
   That turn was **interrupted** and never answered, so the chat's title became
   the greeting.
2. **86 minutes later** they typed a single `?` — checking whether anything was
   alive at all. The agent then answered normally.
3. They spent an **entire capture round-trip purely as a connectivity test**,
   with the spoken note *"I purely want to test if this gets through."* One
   image, 7 seconds of audio, delivered and confirmed — a whole interaction
   whose only purpose was to learn whether the feature works.
4. They then **re-captured items already cataloged earlier that afternoon**
   (3 images, 24 seconds of audio), because they had no evidence the earlier
   batch had landed. The agent recognized the duplicates, reconciled them
   against the existing entries, and `git rm`'d the redundant capture.
5. Only afterwards did they realize it had worked all along.

So the missing signal cost: one interrupted opener, an 86-minute silence, a
test capture, a duplicate capture, and agent work to detect and undo the
duplicate. The pipeline was healthy for every one of those steps.

## Why re-capturing is the expensive failure

A user who cannot tell whether a capture landed will capture again — that is the
rational move, and the affordance encourages it (the only verb on a failed chip
is "tap to retry"). But duplicate captures are not free: they consume
transcription, cost an agent turn to reconcile, and risk landing as duplicate
entries when the agent does not catch them. Here the agent did catch it. Nothing
guarantees that.

## What would settle it

The specific gap is that **no durable element says "this capture landed"** at
the moment it lands. Directions worth weighing rather than assuming:

- **Give delivery a positive, momentary signal** — the pending chip resolves
  into its delivered form in place rather than vanishing and reappearing
  elsewhere, so the transition is visible as a transition.
- **Make the pending state legible while it runs.** Delivery takes about a
  minute; if that minute showed progress (sealed → transcribing → delivered),
  silence would not read as failure.
- **Close the loop where the user is looking.** If the user leaves the chat
  after capturing — the common case, since capture is often the last thing they
  do — the confirmation needs to reach them somewhere other than a transcript
  they are not watching.

## Code reading (2026-08-21)

Two corrections and one finding, from reading the delivery path.

**The transcript chip is not a minute behind — it is simultaneous.**
`core/chat/session/deliver-user-message.ts:174` emits `chat-user-message` (which
renders the transcript chip) inside the same delivery step that
`core/capture/prepare.ts:355` emits `capture-status: delivered` (which removes
the pending bubble). There is no interval where nothing is on screen. The
~1 minute is *preparation* — transcription — during which the bubble correctly
reads "preparing…"/"transcribing…".

So the defect is not a gap. It is that **the swap is unmarked**: a dimmed
pending row is deleted and an ordinary-looking transcript message appears, with
nothing identifying them as the same object. The second half is that the minute
of preparation is long enough to walk away from.

**The client already receives the success signal and discards it.** The
`delivered` event carries `docPath` and the resolved `sessionId`
(`prepare.ts:355`). `useCaptureBubbles.ts:36-44` uses it only to trigger a
refetch; the row then vanishes because the query no longer returns it. Resolving
the bubble in place needs no new backend state — only that the hook stop
dropping what it is already handed.

**`startedAt` is likewise already available** (`core/capture/pending.ts:34`) and
`captureBubbleCaption` never reads it — which is the whole of the "ageless chip"
defect in the sibling issue. Both halves are the same two files.

## Related

- [Cannot capture into a new chat](../closed/features/2026-08-20-cannot-capture-into-a-new-chat.md)
  — the gate that produced the throwaway opener in step 1.
- [Failed capture chip cannot be discarded](../closed/bugs/2026-08-20-failed-capture-chip-cannot-be-discarded.md)
  — the other half of this asymmetry: failure that never goes away.
- [Capture upload error/retry affordance is weak](2026-08-03-capture-upload-error-retry-affordance-weak.md)
  — same family, on the overlay surface.

## What landed (2026-08-21)

- The working caption names its step and, past 45 seconds, reports how long it
  has been at it (`still preparing — 2 min`). The minute of preparation is no
  longer silent.
- The `delivered` event is no longer discarded. `useCaptureBubbles` holds the
  row for 3 seconds wearing a resolved face, then lets it go — so the swap from
  pending row to transcript message is visible as a transition rather than as a
  disappearance.
- The same mechanism gives discard a resolved face, so both endings look alike.

Not addressed, deliberately: **reaching a user who has left the chat.** That is
a notification-channel question, not a chip question, and folding it in would
have added a delivery path to a UI change. Filed separately as
[capture confirmation does not reach a user who left the chat](../features/2026-08-21-capture-confirmation-misses-a-user-who-left.md).

One gap remains by design: a capture that delivers *before* its pending row has
ever been rendered (delivery beating the first query round-trip) still has no
row to resolve, so it appears only as the transcript message. The hook cannot
invent a bubble for it — the `capture-status` payload carries no media counts.

## Manual testing

1. From the phone, capture a photo and a short clip into a chat, then **stay in
   the chat**. The bubble must show `preparing…`, then report its age if
   preparation runs long, then turn green and read `delivered` for about three
   seconds before the row leaves and the capture message stands in its place.
2. Repeat, but leave the chat during preparation and come back. The capture
   message must be there; nothing should be stuck.
3. Confirm you no longer feel the need to re-capture to check.