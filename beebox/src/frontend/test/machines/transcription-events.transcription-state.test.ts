// # Transcription state: the flat state and `segmentCapturing`
//
// `useRealtimeTranscription` reports the machine's nested state as one flat
// `TranscriptionState` (`transcriptionStateOf`, in
// `machines/realtimeTranscriptionMachine.ts`), and every "is a segment live"
// check in the hook and the chat — `stop()`, a manual send, cross-tab mic
// eviction, `isTranscribing` — goes through one predicate, `segmentCapturing`
// (`machines/transcription-events.ts`). A check written against state names
// would miss `recordingLocal`, where audio records with no live text
// (`docs/plans/resilient-voice-recording.md`, Track 3).

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { createActor, fromCallback } from "xstate";
import { segmentCapturing } from "../../src/machines/transcription-events.js";
import type { TranscriptionActorCommand, TranscriptionActorInput, TranscriptionEvent } from "../../src/machines/transcription-events.js";
import {
  realtimeTranscriptionMachine,
  transcriptionStateOf,
} from "../../src/machines/realtimeTranscriptionMachine.js";

// ## `segmentCapturing` is true for the three live states
//
// Keyword spotting is deliberately not a `segmentCapturing` site: it needs live
// text, which only `recording` has.
void test("Keyword spotting is deliberately not a segmentCapturing site:", async (t) => {
  // doctest:L28
  const states = ["idle", "connecting", "recordingLocal", "recording", "reconnecting", "finalizing"] as const;
  t.check(states.map((s) => `${s}:${String(segmentCapturing(s))}`).join(" "), "idle:false connecting:false recordingLocal:true recording:true reconnecting:true finalizing:false");
});

// ## The flat state follows the machine through a segment
//
// A fake actor stands in for the real one (which needs the audio worklet); it
// leaves `STOP` unanswered so `finalizing` stays observable.
void test("A fake actor stands in for the real one (which needs the audio worklet); it l...", async (t) => {
  // doctest:L39
  let toMachine: (event: TranscriptionEvent) => void = () => {};
  const fake = fromCallback<TranscriptionActorCommand, TranscriptionActorInput, TranscriptionEvent>(({ sendBack }) => {
    toMachine = sendBack;
    return () => {};
  });
  const quiet = () => {};
  const actor = createActor(
    realtimeTranscriptionMachine.provide({
      actors: { transcriptionActor: fake },
      actions: { playMicLost: quiet, playRecordingResumed: quiet, playLiveTextPaused: quiet, playLiveTextResumed: quiet, playMicOffSound: quiet, playStartFailedSound: quiet },
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
  t.check(seen.join(" → "), "idle → connecting → recordingLocal → recording → reconnecting → recordingLocal → finalizing → idle");
});
