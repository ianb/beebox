# Transcription state: the flat state and `segmentCapturing`

`useRealtimeTranscription` reports the machine's nested state as one flat
`TranscriptionState` (`transcriptionStateOf`, in
`machines/realtimeTranscriptionMachine.ts`), and every "is a segment live"
check in the hook and the chat — `stop()`, a manual send, cross-tab mic
eviction, `isTranscribing` — goes through one predicate, `segmentCapturing`
(`machines/transcription-events.ts`). A check written against state names
would miss `recordingLocal`, where audio records with no live text
(`docs/plans/resilient-voice-recording.md`, Track 3).

```ts setup
import { createActor, fromCallback } from "xstate";
import { segmentCapturing } from "../../../src/frontend/src/machines/transcription-events.js";
import {
  realtimeTranscriptionMachine,
  transcriptionStateOf,
} from "../../../src/frontend/src/machines/realtimeTranscriptionMachine.js";
```

## `segmentCapturing` is true for the three live states

Keyword spotting is deliberately not a `segmentCapturing` site: it needs live
text, which only `recording` has.

```ts
const states = ["idle", "connecting", "recordingLocal", "recording", "reconnecting", "finalizing"] as const;
states.map((s) => `${s}:${String(segmentCapturing(s))}`).join(" ")
=> idle:false connecting:false recordingLocal:true recording:true reconnecting:true finalizing:false
```

## The flat state follows the machine through a segment

A fake actor stands in for the real one (which needs the audio worklet); it
leaves `STOP` unanswered so `finalizing` stays observable.

```ts
let toMachine = (_event: unknown) => {};
const fake = fromCallback(({ sendBack }) => {
  toMachine = sendBack;
  return () => {};
});
const quiet = () => {};
const actor = createActor(
  realtimeTranscriptionMachine.provide({
    actors: { transcriptionActor: fake },
    actions: { playRecordingDropped: quiet, playRecordingResumed: quiet, playMicOffSound: quiet, playStartFailedSound: quiet },
  }),
);
actor.start();
const seen = [transcriptionStateOf(actor.getSnapshot())];
const note = () => { seen.push(transcriptionStateOf(actor.getSnapshot())); };
actor.send({ type: "START", targetSessionId: null });
note();
toMachine({ type: "MIC_LIVE" });
note();
toMachine({ type: "WS_CONNECTED" });
note();
toMachine({ type: "CONNECTION_DEGRADED", cause: "microphone" });
note();
toMachine({ type: "MIC_LIVE" });
note();
actor.send({ type: "STOP" });
note();
toMachine({ type: "TRANSCRIPTION_DONE", recording: { recordingId: "r", seal: quiet, discard: quiet } });
note();
seen.join(" → ")
=> idle → connecting → recordingLocal → recording → reconnecting → recordingLocal → finalizing → idle
```
