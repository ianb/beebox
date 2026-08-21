---
title: "A capture that succeeds says nothing — success is a chip disappearing, so the user assumes it failed and re-captures"
workstream: unattached
area: callback-box
labels: [capture, chat, ui, feedback]
filed-by: agent
discovered-by: Ian
discovered-in: main session — boxholder could not tell whether a capture had landed
---

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
  ([and cannot be discarded](2026-08-20-failed-capture-chip-cannot-be-discarded.md)).
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

## Related

- [Cannot capture into a new chat](../closed/features/2026-08-20-cannot-capture-into-a-new-chat.md)
  — the gate that produced the throwaway opener in step 1.
- [Failed capture chip cannot be discarded](2026-08-20-failed-capture-chip-cannot-be-discarded.md)
  — the other half of this asymmetry: failure that never goes away.
- [Capture upload error/retry affordance is weak](2026-08-03-capture-upload-error-retry-affordance-weak.md)
  — same family, on the overlay surface.
