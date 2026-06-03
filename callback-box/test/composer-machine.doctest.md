# Composer input machine

`composerMachine` orchestrates the chat composer's modal input state — the
`voice` region (`idle | dictating | committing | speaking | pausedForSpeech`),
the narration `hq` region, and the mobile `keyboard` region. It commands the
real mic/TTS devices through named action seams; here we replace those seams
with spies and assert the *decisions*. See `docs/composer-input-machine.md`.

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
        cancelMic: seam("cancelMic"),
        playSpeech: seam("playSpeech"),
        stopSpeech: seam("stopSpeech"),
        markPlayed: seam("markPlayed"),
        commitSend: ({ event }) => {
          calls.push(event.type === "KEYWORD_SEND" ? `commitSend:${event.text}` : "commitSend");
        },
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

`START_DICTATION` enters `dictating`, marks a turn active, and commands the mic.

```
const { actor, calls } = mk();
actor.send({ type: "START_DICTATION" });
const s = actor.getSnapshot();
s.matches({ voice: "dictating" })
=> true

s.context.turnTaking
=> true

calls.join(",")
=> startMic
```

## Speech while dictating pauses the mic (playback → recording)

A queued segment arriving mid-recording (empty transcript) cancels the mic and
plays — landing in `pausedForSpeech`, which remembers to resume.

```
const { actor, calls } = mk();
actor.send({ type: "START_DICTATION" });
actor.send(queued);
actor.getSnapshot().matches({ voice: "pausedForSpeech" })
=> true

calls.join(",")
=> startMic,cancelMic,playSpeech
```

When playback finishes, the mic auto-resumes (the whole point of `voicePaused`):

``` continue
actor.send({ type: "SPEECH_DONE" });
actor.getSnapshot().matches({ voice: "dictating" })
=> true

calls.join(",")
=> startMic,cancelMic,playSpeech,startMic
```

## Stopping speech from the paused state resumes the mic

`STOP_SPEECH` (e.g. the SpeechMenu Stop) while paused hands recording back —
the fix that used to be a hand-written `if (voicePausedRef.current)` branch.

```
const { actor, calls } = mk();
actor.send({ type: "START_DICTATION" });
actor.send(queued);
actor.send({ type: "STOP_SPEECH" });
actor.getSnapshot().matches({ voice: "dictating" })
=> true

calls.join(",")
=> startMic,cancelMic,playSpeech,stopSpeech,startMic
```

`RESUME` (tapping the pulsing mic) does the same — stop the speech, resume mic:

```
const { actor, calls } = mk();
actor.send({ type: "START_DICTATION" });
actor.send(queued);
actor.send({ type: "RESUME" });
actor.getSnapshot().matches({ voice: "dictating" })
=> true

calls.join(",")
=> startMic,cancelMic,playSpeech,stopSpeech,startMic
```

## Talking suppresses the agent's voice (recording → speech output)

If the transcript already has text when speech is queued, it is marked played
but never spoken — the user isn't talked over. Stays in `dictating`.

```
const { actor, calls } = mk();
actor.send({ type: "START_DICTATION" });
actor.send({ type: "TRANSCRIPT", nonEmpty: true });
actor.send(queued);
actor.getSnapshot().matches({ voice: "dictating" })
=> true

calls.join(",")
=> startMic,markPlayed
```

## Muted speech never plays

```
const { actor, calls } = mk();
actor.send({ type: "SET_MUTE", value: true });
actor.send(queued);
const s = actor.getSnapshot();
s.matches({ voice: "idle" })
=> true

calls.join(",")
=> markPlayed
```

## Speech from idle (no turn-taking) plays, then returns to idle

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

## Speech during an active turn resumes the mic on completion

`turnTaking` survives a mic that ended on its own (`MIC_OFF`), so when speech
later completes the mic comes back.

```
const { actor, calls } = mk();
actor.send({ type: "START_DICTATION" });
actor.send({ type: "MIC_OFF" });
actor.send(queued);
actor.getSnapshot().matches({ voice: "speaking" })
=> true
```

``` continue
actor.send({ type: "SPEECH_DONE" });
actor.getSnapshot().matches({ voice: "dictating" })
=> true

calls.join(",")
=> startMic,playSpeech,startMic
```

## Manually starting the mic while speaking stops the speech

Closes the latent `isTranscribing && speechPlaying` edge: entering `dictating`
from `speaking` stops playback first.

```
const { actor, calls } = mk();
actor.send(queued);
actor.send({ type: "START_DICTATION" });
actor.getSnapshot().matches({ voice: "dictating" })
=> true

calls.join(",")
=> playSpeech,stopSpeech,startMic
```

## Keyword send commits, then restarts the mic to keep talking

```
const { actor, calls } = mk();
actor.send({ type: "START_DICTATION" });
actor.send({ type: "KEYWORD_SEND", text: "hello world", audioBlob: null });
actor.getSnapshot().matches({ voice: "dictating" })
=> true

calls.join(",")
=> startMic,commitSend:hello world,startMic
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

## A send always ends the turn (root handler runs alongside the region)

`MESSAGE_SENT` resets `turnTaking` via the root handler even as the keyboard
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
