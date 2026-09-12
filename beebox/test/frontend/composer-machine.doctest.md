# Composer input machine

`composerMachine` is the coordination overlay for the chat composer's speech ↔
mic interplay: the `voice` region (`idle | speaking | pausedForSpeech`), the
narration `hq` region, and the mobile `keyboard` region. Whether the mic is
recording lives in the transcription machine and is mirrored in as the
`recording` flag. The machine commands the real mic/TTS devices through named
action seams; here we replace those seams with spies and assert the
*decisions*. See `docs/composer-input-machine.md`.

```ts setup
import { createActor } from "xstate";
import { composerMachine } from "../../src/frontend/src/machines/composerMachine.js";

// Build a started actor that records the device commands it emits into `calls`.
function mk(input) {
  const calls = [];
  const actor = createActor(composerMachine, { input: input ?? {} });
  actor.on("command", ({ command }) => { calls.push(command.type); });
  actor.start();
  return { actor, calls };
}

const queued = { type: "SPEECH_QUEUED", messageId: "m1", segments: [], baseIndex: 0 };
```

## Starting dictation

`START_DICTATION` marks a turn active and commands the mic. The voice overlay
stays `idle` — "recording" is the transcription machine's state, not ours.

```ts
const { actor, calls } = mk();
actor.send({ type: "START_DICTATION" });
const s = actor.getSnapshot();
s.matches({ voice: "idle" })
=> true

s.context.turnTaking
=> true

calls.join(",")
=> startMic
```

## Speech while recording pauses the mic (playback → recording)

With the mic recording (empty transcript), a queued segment cancels the mic
and plays — landing in `pausedForSpeech`, which remembers to resume.

```ts
const { actor, calls } = mk();
actor.send({ type: "RECORDING", value: true });
actor.send(queued);
actor.getSnapshot().matches({ voice: "pausedForSpeech" })
=> true

calls.join(",")
=> cancelMic,playSpeech
```

When playback finishes, the mic auto-resumes (the whole point of `voicePaused`):

```ts continue
actor.send({ type: "SPEECH_DONE" });
actor.getSnapshot().matches({ voice: "idle" })
=> true

calls.join(",")
=> cancelMic,playSpeech,resumeMic
```

## Stopping speech from the paused state resumes the mic

`STOP_SPEECH` (e.g. the SpeechMenu Stop) while paused hands recording back —
the fix that used to be a hand-written `if (voicePausedRef.current)` branch.

```ts
const { actor, calls } = mk();
actor.send({ type: "RECORDING", value: true });
actor.send(queued);
actor.send({ type: "STOP_SPEECH" });
actor.getSnapshot().matches({ voice: "idle" })
=> true

calls.join(",")
=> cancelMic,playSpeech,stopSpeech,resumeMic
```

`RESUME` (tapping the pulsing mic) does the same:

```ts
const { actor, calls } = mk();
actor.send({ type: "RECORDING", value: true });
actor.send(queued);
actor.send({ type: "RESUME" });
actor.getSnapshot().matches({ voice: "idle" })
=> true

calls.join(",")
=> cancelMic,playSpeech,stopSpeech,resumeMic
```

## Talking suppresses the agent's voice (recording → speech output)

If the transcript already has text when speech is queued, it is marked played
but never spoken — the user isn't talked over.

```ts
const { actor, calls } = mk();
actor.send({ type: "RECORDING", value: true });
actor.send({ type: "TRANSCRIPT", nonEmpty: true });
actor.send(queued);
actor.getSnapshot().matches({ voice: "idle" })
=> true

calls.join(",")
=> markPlayed
```

## Muted speech never plays

```ts
const { actor, calls } = mk();
actor.send({ type: "SET_MUTE", value: true });
actor.send(queued);
actor.getSnapshot().matches({ voice: "idle" })
=> true

calls.join(",")
=> markPlayed
```

## Speech with the mic idle plays, then returns to idle

```ts
const { actor, calls } = mk();
actor.send(queued);
actor.getSnapshot().matches({ voice: "speaking" })
=> true

calls.join(",")
=> playSpeech
```

```ts continue
actor.send({ type: "SPEECH_DONE" });
actor.getSnapshot().matches({ voice: "idle" })
=> true
```

## Speech during an active turn reopens the mic on completion

`turnTaking` (set by START_DICTATION) makes a completed `speaking` reopen the
mic — the non-paused auto-restart.

```ts
const { actor, calls } = mk();
actor.send({ type: "START_DICTATION" });
actor.send(queued);
actor.getSnapshot().matches({ voice: "speaking" })
=> true
```

```ts continue
actor.send({ type: "SPEECH_DONE" });
actor.getSnapshot().matches({ voice: "idle" })
=> true

calls.join(",")
=> startMic,playSpeech,startMic
```

## Manually starting the mic while speaking stops the speech

Closes the latent "recording while speech still playing" edge: a fresh
START_DICTATION stops playback first.

```ts
const { actor, calls } = mk();
actor.send(queued);
actor.send({ type: "START_DICTATION" });
actor.getSnapshot().matches({ voice: "idle" })
=> true

calls.join(",")
=> playSpeech,stopSpeech,startMic
```

## Native barge-in stops the speech without opening the web mic

The iOS record button opens the *native* microphone itself and asks this page
only to stop talking (mobile-contract §4.9). That command lands as `STOP_SPEECH`
rather than `START_DICTATION`: the page is the speaker but not the listener, so
it must not `startMic`, and `turnTaking` must stay false or the next
`SPEECH_DONE` would reopen a microphone nobody is watching.

```ts
const { actor, calls } = mk();
actor.send(queued);
actor.send({ type: "STOP_SPEECH" });
const s = actor.getSnapshot();
s.matches({ voice: "idle" })
=> true

s.context.turnTaking
=> false

calls.join(",")
=> playSpeech,stopSpeech
```

## Manual stop ends the turn

A user-driven `STOP_DICTATION` ends turn-taking (so the agent won't auto-reopen
the mic after its next reply). Mic teardown is the handler's job, not the
machine's.

```ts
const { actor, calls } = mk();
actor.send({ type: "START_DICTATION" });
actor.send({ type: "STOP_DICTATION" });
const s = actor.getSnapshot();
s.context.turnTaking
=> false

calls.join(",")
=> startMic
```

## Manual replay pauses the mic without re-playing

`SPEECH_EXTERNAL` (the SpeechMenu Replay, which plays on its own) pauses an
active recording — `pausedForSpeech` with no `playSpeech` call.

```ts
const { actor, calls } = mk();
actor.send({ type: "RECORDING", value: true });
actor.send({ type: "SPEECH_EXTERNAL" });
actor.getSnapshot().matches({ voice: "pausedForSpeech" })
=> true

calls.join(",")
=> cancelMic
```

From an idle mic it just reflects that speech is playing:

```ts
const { actor, calls } = mk();
actor.send({ type: "SPEECH_EXTERNAL" });
actor.getSnapshot().matches({ voice: "speaking" })
=> true

JSON.stringify(calls)
=> []
```

## Voice sends waiting for HQ

Each voice send that waits for its HQ transcript is a pending bubble
(`docs/plans/resilient-voice-recording.md`, Track 4). `START_HQ` adds one and
lights the in-flight region; several can wait at once. `HQ_STATUS` updates
one bubble's status line.

```ts
const { actor, calls } = mk();
actor.send({ type: "START_HQ", id: "m1", text: "first draft" });
actor.send({ type: "START_HQ", id: "m2", text: "second draft" });
actor.send({ type: "HQ_STATUS", id: "m1", status: "Transcribing part 2 of 3" });
const s = actor.getSnapshot();
s.matches({ hq: "inFlight" })
=> true

JSON.stringify(s.context.pendingHq)
=> [{"id":"m1","text":"first draft","status":"Transcribing part 2 of 3"},{"id":"m2","text":"second draft","status":"Uploading audio…"}]
```

`HQ_SEND_LIVE` is the bubble's "Send live text now" control: it marks the
bubble and emits the command the wiring routes to that send's HQ wait.

```ts continue
actor.send({ type: "HQ_SEND_LIVE", id: "m2" });
JSON.stringify({ calls, status: actor.getSnapshot().context.pendingHq[1]?.status })
=> {"calls":["sendHqLive"],"status":"Sending live text…"}
```

`HQ_DONE` removes one bubble; the region goes idle only with the last.

```ts continue
actor.send({ type: "HQ_DONE", id: "m1" });
const s2 = actor.getSnapshot();
JSON.stringify({ inFlight: s2.matches({ hq: "inFlight" }), ids: s2.context.pendingHq.map((p) => p.id) })
=> {"inFlight":true,"ids":["m2"]}

actor.send({ type: "HQ_DONE", id: "m2" });
actor.getSnapshot().matches({ hq: "idle" })
=> true
```

## Mobile keyboard region

Opens, locks, and auto-closes on send only when unlocked.

```ts
const { actor } = mk();
actor.send({ type: "OPEN_KEYBOARD" });
actor.getSnapshot().matches({ keyboard: { open: "unlocked" } })
=> true
```

An unlocked keyboard closes when a message is sent:

```ts continue
actor.send({ type: "MESSAGE_SENT" });
actor.getSnapshot().matches({ keyboard: "closed" })
=> true
```

A locked keyboard stays open across a send:

```ts
const { actor } = mk();
actor.send({ type: "OPEN_KEYBOARD" });
actor.send({ type: "TOGGLE_LOCK" });
actor.send({ type: "MESSAGE_SENT" });
actor.getSnapshot().matches({ keyboard: { open: "locked" } })
=> true
```

## A send always ends the turn (region runs alongside the keyboard)

`MESSAGE_SENT` resets `turnTaking` via the voice region even as the keyboard
region closes — confirming the parallel regions both process the event.

```ts
const { actor } = mk();
actor.send({ type: "START_DICTATION" });
actor.send({ type: "OPEN_KEYBOARD" });
actor.send({ type: "MESSAGE_SENT" });
const s = actor.getSnapshot();
s.context.turnTaking
=> false

s.matches({ keyboard: "closed" })
=> true
```
```ts
