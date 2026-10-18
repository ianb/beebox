// # Realtime transcription machine — the recording outlives the live socket
//
// `realtimeTranscriptionMachine` (`machines/realtimeTranscriptionMachine.ts`)
// separates the recording from the live transcription socket
// (`docs/plans/resilient-voice-recording.md`, Track 3). Once the actor reports
// `MIC_LIVE`, audio is staging to the box, and the live socket is a preview that
// may come and go: `recordingLocal` is "recording, no live text". Only a lost
// microphone is bounded by a window, because only then does audio stop.
//
// The real actor needs the audio worklet, so these examples drive the machine
// with a fake one that answers the way the real actor does: `STOP` gets an
// immediate `TRANSCRIPTION_DONE` carrying the recording, and `CANCEL` discards
// it. `s.emit(event)` plays the actor's side. Delays are shortened per example;
// earcon actions are silenced, or logged as `cue <name>` where an example asks
// for `cues: true`.

import { test } from "tap";
import "agent-doctest/tap";
import { createActor, fromCallback } from "xstate";
import {
  realtimeTranscriptionMachine,
  transcriptionStateOf,
} from "../../src/machines/realtimeTranscriptionMachine.js";
import type { TranscriptionActorCommand, TranscriptionActorInput, TranscriptionEvent } from "../../src/machines/transcription-events.js";

// Most examples leave a segment mid-recording with its long timers pending
// (MAX_DURATION is an hour); unref'd timers let the test process exit anyway.
const unrefClock = {
  setTimeout: (fn: () => void, ms: number) => {
    const handle = setTimeout(fn, ms);
    handle.unref();
    return handle;
  },
  clearTimeout: (handle: ReturnType<typeof setTimeout>) => clearTimeout(handle),
};

const EARCON_ACTIONS = ["playMicLost", "playRecordingResumed", "playLiveTextPaused", "playLiveTextResumed", "playMicOffSound", "playStartFailedSound"] as const;

function segment(opts?: { delays?: Record<string, number>; autoDone?: boolean; cues?: boolean }) {
  const log: string[] = [];
  const cues: string[] = [];
  const earcons = Object.fromEntries(
    EARCON_ACTIONS.map((name) => [name, () => { if (opts?.cues) cues.push(name.replace(/^play/, "")); }]),
  );
  const recording = {
    recordingId: "rec-1",
    seal: (sealing: { emissionId: string | null; hq: { emissionId: string } | null }) => log.push(`seal ${sealing.hq === null ? "null" : sealing.hq.emissionId}`),
    discard: () => log.push("discard"),
  };
  let toMachine: (event: TranscriptionEvent) => void = () => {};
  const emitted: string[] = [];
  const fake = fromCallback<TranscriptionActorCommand, TranscriptionActorInput, TranscriptionEvent>(({ sendBack, receive, input }) => {
    toMachine = sendBack;
    log.push(`actor start target=${String(input.targetSessionId)}`);
    receive((event) => {
      log.push(event.type);
      if (event.type === "STOP" && opts?.autoDone !== false) sendBack({ type: "TRANSCRIPTION_DONE", recording });
      if (event.type === "CANCEL") recording.discard();
    });
    return () => log.push("actor stopped");
  });
  const actor = createActor(
    realtimeTranscriptionMachine.provide({
      actors: { transcriptionActor: fake },
      actions: earcons,
      delays: opts?.delays ?? {},
    }),
    { clock: unrefClock },
  );
  actor.on("maxDurationReached", (event) => emitted.push(event.type));
  actor.start();
  actor.send({ type: "START", targetSessionId: "chat-1" });
  return {
    actor,
    log,
    cues,
    recording,
    emitted,
    emit: (event: TranscriptionEvent) => toMachine(event),
    state: () => transcriptionStateOf(actor.getSnapshot()),
    context: () => actor.getSnapshot().context,
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ## The mic goes live before any socket exists
//
// `START` passes the chat's session id to the actor. `MIC_LIVE` moves
// `connecting` to `recordingLocal`, and the first socket open moves it on to
// `recording`.
void test("START passes the chat's session id to the actor.", async (t) => {
  // doctest:L94
  const s = segment();
  t.check(s.state(), "connecting");

  // doctest:L98
  t.check(s.log.join(","), "actor start target=chat-1");

  // doctest:L101
  s.emit({ type: "MIC_LIVE" });
  t.check(s.state(), "recordingLocal");

  // doctest:L105
  s.emit({ type: "WS_CONNECTED" });
  t.check(s.state(), "recording");
});

// ## A socket that never opens leaves the segment recording
//
// `CONNECT_TIMEOUT` bounds only reaching `MIC_LIVE` (mic permission and worklet
// startup). After that, a box that is down — or restarting for a minute —
// keeps the segment in `recordingLocal` for as long as the user talks.
void test("CONNECTTIMEOUT bounds only reaching MICLIVE (mic permission and worklet start...", async (t) => {
  // doctest:L117
  const s = segment({ delays: { CONNECT_TIMEOUT: 10 } });
  s.emit({ type: "MIC_LIVE" });
  await sleep(40);
  t.check(s.state(), "recordingLocal");

  // doctest:L123
  t.check(s.context().error, null);
});

// Without `MIC_LIVE` the start fails as before:
void test("Without MICLIVE the start fails as before:", async (t) => {
  // doctest:L130
  const s = segment({ delays: { CONNECT_TIMEOUT: 10 } });
  await sleep(40);
  t.check(s.state(), "idle");

  // doctest:L135
  t.check(s.context().error, "Recording didn't start. Please try again.");

  // Nothing was recorded, so the chat bar shows it as an error the person must act
  // on (issues/bugs/2026-08-25-one-pink-bar-three-severities.md):

  // doctest:L143
  t.check(s.context().errorLevel, "error");
});

// ## A network drop pauses live text, with no window
//
// `CONNECTION_DEGRADED` with cause `network` goes from `recording` to
// `recordingLocal`. The audio is still staging, so nothing bounds the drop:
// `RECONNECT_WINDOW` passes and the segment is still recording.
void test("CONNECTIONDEGRADED with cause network goes from recording to recordingLocal.", async (t) => {
  // doctest:L154
  const s = segment({ delays: { RECONNECT_WINDOW: 10 } });
  s.emit({ type: "MIC_LIVE" });
  s.emit({ type: "WS_CONNECTED" });
  s.emit({ type: "CONNECTION_DEGRADED", cause: "network" });
  t.check(s.state(), "recordingLocal");

  // doctest:L161
  await sleep(40);
  t.check(s.state(), "recordingLocal");

  // doctest:L165
  s.emit({ type: "CONNECTION_RESTORED" });
  t.check(s.state(), "recording");
});

// ## A lost microphone is bounded, and expiry ends the segment
//
// Cause `microphone` goes to `reconnecting`: no audio flows, so the window
// applies. On expiry the machine STOPs the actor and waits in `finalizing` for
// `TRANSCRIPTION_DONE`, which carries the recording.
void test("Cause microphone goes to reconnecting:", async (t) => {
  // doctest:L177
  const s = segment({ delays: { RECONNECT_WINDOW: 10 }, autoDone: false });
  s.emit({ type: "MIC_LIVE" });
  s.emit({ type: "WS_CONNECTED" });
  s.emit({ type: "CONNECTION_DEGRADED", cause: "microphone" });
  t.check(s.state(), "reconnecting");

  // doctest:L184
  t.check(s.context().error, "Microphone interrupted — recovering…");

  // doctest:L187
  await sleep(40);
  t.check(s.state(), "finalizing");

  // doctest:L191
  t.check(s.context().error, "Recording stopped — the microphone was taken away");

  // doctest:L194
  s.emit({ type: "TRANSCRIPTION_DONE", recording: s.recording });
  t.check(s.state(), "idle");

  // doctest:L198
  await t.checkText(s.context().recording === s.recording, "true");
});

// When the mic comes back but the socket has not, the actor reports `MIC_LIVE`
// and the segment resumes in `recordingLocal`:
void test("When the mic comes back but the socket has not, the actor reports MICLIVE and...", async (t) => {
  // doctest:L206
  const s = segment();
  s.emit({ type: "MIC_LIVE" });
  s.emit({ type: "CONNECTION_DEGRADED", cause: "microphone" });
  t.check(s.state(), "reconnecting");

  // doctest:L212
  s.emit({ type: "MIC_LIVE" });
  t.check(s.state(), "recordingLocal");
});

// ## A socket that can't be fixed ends live text, not the recording
//
// A non-retryable close (`1003`/`1008`), reported as `WS_ERROR`, moves
// `recording` to `recordingLocal` and keeps the message for the error banner.
// A service error and a bare close do the same. None of them reaches `idle`,
// which would strand the audio.
void test("A non-retryable close (1003/1008), reported as WSERROR, moves recording to re...", async (t) => {
  // doctest:L225
  const s = segment();
  s.emit({ type: "MIC_LIVE" });
  s.emit({ type: "WS_CONNECTED" });
  s.emit({ type: "WS_ERROR", message: "Live transcription unavailable (code 1008) — still recording" });
  t.check(s.state(), "recordingLocal");

  // doctest:L232
  t.check(s.context().error, "Live transcription unavailable (code 1008) — still recording");

  // The recording went on, so the chat bar shows this as a warning, not an error:

  // doctest:L239
  t.check(s.context().errorLevel, "warning");

  // doctest:L242
  s.emit({ type: "SERVER_ERROR", message: "upstream quota" });
  t.check(s.state(), "recordingLocal");

  // doctest:L246
  const serverError = segment();
  serverError.emit({ type: "MIC_LIVE" });
  serverError.emit({ type: "WS_CONNECTED" });
  serverError.emit({ type: "SERVER_ERROR", message: "upstream quota" });
  t.check(serverError.state(), "recordingLocal");

  // doctest:L253
  const bareClose = segment();
  bareClose.emit({ type: "MIC_LIVE" });
  bareClose.emit({ type: "WS_CONNECTED" });
  bareClose.emit({ type: "WS_CLOSED" });
  t.check(bareClose.state(), "recordingLocal");
});

// ## Each loss gets the cue its consequence calls for
//
// A lost microphone means no audio is being recorded, so it plays the urgent
// `MicLost` cue at once, and its return plays the go-live cue:
void test("A lost microphone means no audio is being recorded, so it plays the urgent Mi...", async (t) => {
  // doctest:L267
  const s = segment({ cues: true });
  s.emit({ type: "MIC_LIVE" });
  s.emit({ type: "WS_CONNECTED" });
  s.emit({ type: "CONNECTION_DEGRADED", cause: "microphone" });
  s.emit({ type: "CONNECTION_RESTORED" });
  t.check(s.cues.join(","), "MicLost,RecordingResumed");
});

// Losing live text only pauses spoken keywords, and most drops heal within a
// second or two. A drop that heals inside `LIVE_TEXT_CUE_DELAY` makes no sound
// at all:
void test("Losing live text only pauses spoken keywords, and most drops heal within a se...", async (t) => {
  // doctest:L281
  const s = segment({ cues: true, delays: { LIVE_TEXT_CUE_DELAY: 30 } });
  s.emit({ type: "MIC_LIVE" });
  s.emit({ type: "WS_CONNECTED" });
  s.emit({ type: "CONNECTION_DEGRADED", cause: "network" });
  s.emit({ type: "CONNECTION_RESTORED" });
  await sleep(60);
  t.check(s.cues.join(","), "");
});

// A drop that lasts plays the quiet pause cue once, and the return plays its
// mirror. A socket that can't be fixed (`WS_ERROR`) is the same kind of loss and
// gets the same quiet cue:
void test("A drop that lasts plays the quiet pause cue once, and the return plays its mi...", async (t) => {
  // doctest:L296
  const s = segment({ cues: true, delays: { LIVE_TEXT_CUE_DELAY: 10 } });
  s.emit({ type: "MIC_LIVE" });
  s.emit({ type: "WS_CONNECTED" });
  s.emit({ type: "CONNECTION_DEGRADED", cause: "network" });
  await sleep(40);
  s.emit({ type: "CONNECTION_RESTORED" });
  t.check(s.cues.join(","), "LiveTextPaused,LiveTextResumed");

  // doctest:L305
  const fatal = segment({ cues: true, delays: { LIVE_TEXT_CUE_DELAY: 10 } });
  fatal.emit({ type: "MIC_LIVE" });
  fatal.emit({ type: "WS_CONNECTED" });
  fatal.emit({ type: "WS_ERROR", message: "Live transcription unavailable (code 1008) — still recording" });
  await sleep(40);
  t.check(fatal.cues.join(","), "LiveTextPaused");
});

// A segment whose first socket is slow to open never had live text, so waiting
// in `recordingLocal` at the start is silent:
void test("A segment whose first socket is slow to open never had live text, so waiting...", async (t) => {
  // doctest:L318
  const s = segment({ cues: true, delays: { LIVE_TEXT_CUE_DELAY: 10 } });
  s.emit({ type: "MIC_LIVE" });
  await sleep(40);
  s.emit({ type: "WS_CONNECTED" });
  t.check(s.cues.join(","), "");
});

// ## STOP from `recordingLocal` ends the segment with its recording
void test("STOP from `recordingLocal` ends the segment with its recording", async (t) => {
  // doctest:L329
  const s = segment();
  s.emit({ type: "MIC_LIVE" });
  s.actor.send({ type: "STOP" });
  t.check(s.state(), "idle");

  // doctest:L335
  await t.checkText(s.context().recording === s.recording, "true");

  // doctest:L338
  t.check(s.log.join(","), "actor start target=chat-1,STOP,actor stopped");
});

// Nothing was sealed yet: sealing is the receiver's job (the hook, or the send
// it hands the recording to).
//
// ## CANCEL discards the recording
void test("Nothing was sealed yet:", async (t) => {
  // doctest:L348
  const s = segment();
  s.emit({ type: "MIC_LIVE" });
  s.actor.send({ type: "CANCEL" });
  t.check(s.state(), "idle");

  // doctest:L354
  t.check(s.log.join(","), "actor start target=chat-1,CANCEL,discard,actor stopped");

  // doctest:L357
  t.check(s.context().recording, null);
});

// ## No silence timeout while live text is paused
//
// `SILENCE_TIMEOUT` lives on `recording`, where each live-text update resets it.
// In `recordingLocal` no text arrives to reset it, so it does not run there.
void test("SILENCETIMEOUT lives on recording, where each live-text update resets it.", async (t) => {
  // doctest:L367
  const s = segment({ delays: { SILENCE_TIMEOUT: 10 } });
  s.emit({ type: "MIC_LIVE" });
  await sleep(40);
  t.check(s.state(), "recordingLocal");

  // doctest:L373
  s.emit({ type: "WS_CONNECTED" });
  await sleep(40);
  t.check(s.state(), "idle");
});

// ## MAX_DURATION submits the segment
//
// On expiry the machine emits `maxDurationReached` (the hook parks a submit on
// it, the same path as a spoken "send", and that send re-arms the mic), then
// STOPs. The segment ends with its recording in context.
void test("On expiry the machine emits maxDurationReached (the hook parks a submit on it...", async (t) => {
  // doctest:L386
  const s = segment({ delays: { MAX_DURATION: 20 } });
  s.emit({ type: "MIC_LIVE" });
  await sleep(50);
  t.check(s.emitted.join(","), "maxDurationReached");

  // doctest:L392
  t.check(s.state(), "idle");

  // doctest:L395
  await t.checkText(s.context().recording === s.recording, "true");

  // doctest:L398
  await t.checkText(s.log.includes("STOP"), "true");
});
