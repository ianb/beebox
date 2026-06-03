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
import { composerMachine } from "../src/frontend/src/machines/composerMachine.js";

// Build a started actor whose device-command seams record into `calls`,
// leaving the pure context assigns intact.
function mk(input) {
  const calls = [];
  const seam = (name) => () => { calls.push(name); };
  const actor = createActor(
    composerMachine.provide({
      actions: {
        startMic: seam("startMic"),
        resumeMic: seam("resumeMic"),
        cancelMic: seam("cancelMic"),
        playSpeech: seam("playSpeech"),
        stopSpeech: seam("stopSpeech"),
        markPlayed: seam("markPlayed"),
      },
    }),
    { input: input ?? {} },
  );
  actor.start();
  return { actor, calls };
}

const queued = { type: "SPEECH_QUEUED", messageId: "m1", segments: [], baseIndex: 0 };
```

## Starting dictation

`START_DICTATION` marks a turn active and commands the mic. The voice overlay
stays `idle` — "recording" is the transcription machine's state, not ours.

```
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

```
const { actor, calls } = mk();
actor.send({ type: "RECORDING", value: true });
actor.send(queued);
actor.getSnapshot().matches({ voice: "pausedForSpeech" })
=> true

calls.join(",")
=> cancelMic,playSpeech
```

When playback finishes, the mic auto-resumes (the whole point of `voicePaused`):

``` continue
actor.send({ type: "SPEECH_DONE" });
actor.getSnapshot().matches({ voice: "idle" })
=> true

calls.join(",")
=> cancelMic,playSpeech,resumeMic
```

## Stopping speech from the paused state resumes the mic

`STOP_SPEECH` (e.g. the SpeechMenu Stop) while paused hands recording back —
the fix that used to be a hand-written `if (voicePausedRef.current)` branch.

```
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

```
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

```
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

```
const { actor, calls } = mk();
actor.send({ type: "SET_MUTE", value: true });
actor.send(queued);
actor.getSnapshot().matches({ voice: "idle" })
=> true

calls.join(",")
=> markPlayed
```

## Speech with the mic idle plays, then returns to idle

```
const { actor, calls } = mk();
actor.send(queued);
actor.getSnapshot().matches({ voice: "speaking" })
=> true

calls.join(",")
=> playSpeech
```

``` continue
actor.send({ type: "SPEECH_DONE" });
actor.getSnapshot().matches({ voice: "idle" })
=> true
```

## Speech during an active turn reopens the mic on completion

`turnTaking` (set by START_DICTATION) makes a completed `speaking` reopen the
mic — the non-paused auto-restart.

```
const { actor, calls } = mk();
actor.send({ type: "START_DICTATION" });
actor.send(queued);
actor.getSnapshot().matches({ voice: "speaking" })
=> true
```

``` continue
actor.send({ type: "SPEECH_DONE" });
actor.getSnapshot().matches({ voice: "idle" })
=> true

calls.join(",")
=> startMic,playSpeech,startMic
```

## Manually starting the mic while speaking stops the speech

Closes the latent "recording while speech still playing" edge: a fresh
START_DICTATION stops playback first.

```
const { actor, calls } = mk();
actor.send(queued);
actor.send({ type: "START_DICTATION" });
actor.getSnapshot().matches({ voice: "idle" })
=> true

calls.join(",")
=> playSpeech,stopSpeech,startMic
```

## Manual stop ends the turn

A user-driven `STOP_DICTATION` ends turn-taking (so the agent won't auto-reopen
the mic after its next reply). Mic teardown is the handler's job, not the
machine's.

```
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

```
const { actor, calls } = mk();
actor.send({ type: "RECORDING", value: true });
actor.send({ type: "SPEECH_EXTERNAL" });
actor.getSnapshot().matches({ voice: "pausedForSpeech" })
=> true

calls.join(",")
=> cancelMic
```

From an idle mic it just reflects that speech is playing:

```
const { actor, calls } = mk();
actor.send({ type: "SPEECH_EXTERNAL" });
actor.getSnapshot().matches({ voice: "speaking" })
=> true

JSON.stringify(calls)
=> []
```

## Narration HQ round-trip

`START_HQ` parks the realtime text and lights the in-flight region; `HQ_DONE`
clears it.

```
const { actor } = mk();
actor.send({ type: "START_HQ", text: "draft text" });
const s = actor.getSnapshot();
s.matches({ hq: "inFlight" })
=> true

s.context.pendingHqText
=> draft text
```

``` continue
actor.send({ type: "HQ_DONE" });
const s2 = actor.getSnapshot();
s2.matches({ hq: "idle" })
=> true

JSON.stringify(s2.context.pendingHqText)
=> null
```

## Mobile keyboard region

Opens, locks, and auto-closes on send only when unlocked.

```
const { actor } = mk();
actor.send({ type: "OPEN_KEYBOARD" });
actor.getSnapshot().matches({ keyboard: { open: "unlocked" } })
=> true
```

An unlocked keyboard closes when a message is sent:

``` continue
actor.send({ type: "MESSAGE_SENT" });
actor.getSnapshot().matches({ keyboard: "closed" })
=> true
```

A locked keyboard stays open across a send:

```
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

```
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
```
