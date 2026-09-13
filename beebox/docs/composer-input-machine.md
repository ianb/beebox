# Composer input machine

Current reference for the shipped composer coordination overlay. The companion
[`composer-states.md`](composer-states.md) enumerates rendered states with
screenshots. The unbuilt child-actor design is separate in
[`plans/composer-child-actors.md`](plans/composer-child-actors.md).

## Ownership

`src/frontend/src/machines/composerMachine.ts` is a parallel XState machine
with three regions:

- `voice`: `idle | speaking | pausedForSpeech`
- `hq`: `idle | inFlight`
- `keyboard`: `closed | open.{unlocked,locked}`

The machine is a coordination overlay. It does not own microphone or playback
device lifecycles. `realtimeTranscriptionMachine` owns microphone states and
`speechPlaybackMachine` owns playback. `InteractiveChat-voice.ts` mirrors
device facts into the composer and executes the device commands it emits.

## Voice coordination

`recording` and `transcriptNonEmpty` are mirrored context flags. A queued speech
segment follows these rules:

| Current condition | Result |
|---|---|
| muted | mark the segment played without playback |
| transcript has text | mark the segment played without playback |
| microphone is recording | cancel the mic, play speech, enter `pausedForSpeech` |
| otherwise | play speech and enter `speaking` |

When ordinary playback finishes, the machine returns to `idle` and restarts the
mic if `turnTaking` is set. When playback finishes or is stopped in
`pausedForSpeech`, it returns to `idle` and resumes the mic. Starting dictation
while speech plays stops speech first.

The rendered `voicePaused` flag is
`composerSnapshot.matches({ voice: "pausedForSpeech" })`. Recording appearance
and `isTranscribing` still come from the transcription machine.

## HQ coordination

The `hq` region tracks zero or more pending HQ transcription requests. The
first `START_HQ` enters `inFlight`; later requests append to `pendingHq`.
`HQ_STATUS` updates one row, `HQ_SEND_LIVE` emits the fallback send command,
and `HQ_DONE` removes one row. The region returns to `idle` after the last
pending request completes.

HQ request work stays in `InteractiveChat-voice.ts`; the machine owns visible
coordination state and emitted commands.

## Mobile keyboard coordination

The machine defines this region:

```text
keyboard (initial: closed)
  closed: OPEN_KEYBOARD → open.unlocked
  open:
    CLOSE_KEYBOARD → closed
    unlocked: TOGGLE_LOCK → locked; MESSAGE_SENT → closed
    locked: TOGGLE_LOCK → unlocked; MESSAGE_SENT stays open
```

The current React view still owns `typingMode` and `typingLocked` and renders
the mobile typing row when `typingMode || isTranscribing`. The keyboard region
therefore records the intended transitions and has doctest coverage, but the
view has not yet been wired to read it.

## Verification owner

`test/frontend/composer-machine.doctest.md` covers voice, HQ, and keyboard
transitions. The React wiring lives in
`src/frontend/src/components/chat/InteractiveChat-voice.ts`, and the remaining
component-owned keyboard state lives in `InteractiveChat.tsx` and
`InteractiveChat-layout.tsx`.
