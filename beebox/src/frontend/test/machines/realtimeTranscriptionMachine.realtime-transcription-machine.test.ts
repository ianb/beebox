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
import "@ianbicking/tap-check/tap";
import { is } from "@ianbicking/tap-check/check";
import { SimulatedClock, createActor, fromCallback } from "xstate";
import {
  realtimeTranscriptionMachine,
  transcriptionStateOf,
} from "../../src/machines/realtimeTranscriptionMachine.js";
import { NO_LIVE_TEXT_TIMEOUT_MS, type TranscriptionActorCommand, type TranscriptionActorInput, type TranscriptionEvent } from "../../src/machines/transcription-events.js";

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

function segment(opts?: { delays?: Record<string, number>; autoDone?: boolean; cues?: boolean; clock?: SimulatedClock }) {
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
    log.push(`actor start target=${String(input.targetSessionId)}${input.held ? " held" : ""}`);
    receive((event) => {
      log.push(event.type === "HOLD" ? `HOLD ${String(event.held)}` : event.type);
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
    { clock: opts?.clock ?? unrefClock },
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

type Ctx = ReturnType<ReturnType<typeof segment>["context"]>;
const contextWith = (over: Partial<Ctx>): Ctx => ({
  finalTranscript: "",
  interimTranscript: "",
  finalWords: null,
  error: null,
  errorLevel: "error",
  recording: null,
  liveTextCue: "none",
  targetSessionId: "chat-1",
  held: false,
  ...over,
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ## The mic goes live before any socket exists
//
// `START` passes the chat's session id to the actor. `MIC_LIVE` moves
// `connecting` to `recordingLocal`, and the first socket open moves it on to
// `recording`.
void test("START passes the chat's session id to the actor.", async (t) => {
  const s = segment();
  t.check(s.state(), "connecting");

  t.check(s.log, ["actor start target=chat-1"]);

  s.emit({ type: "MIC_LIVE" });
  t.check(s.state(), "recordingLocal");

  s.emit({ type: "WS_CONNECTED" });
  t.check(s.state(), "recording");
});

// ## Holding the mic for speech keeps the segment
//
// While the agent's speech plays, the mic is held: the actor records silence,
// and the segment keeps its text and its recording. Ending the segment later
// hands over one recording that covers the words from before the hold, for the
// HQ pass (issues/closed/bugs/2026-10-20-replaying-agent-audio-drops-the-recording.md).
void test("HOLD keeps the open segment, its text, and its recording.", async (t) => {
  const s = segment();
  s.emit({ type: "MIC_LIVE" });
  s.emit({ type: "WS_CONNECTED" });
  s.emit({ type: "TEXT_UPDATE", finalText: "before the replay", interimText: "", finalWords: null });
  s.actor.send({ type: "HOLD", held: true });
  t.check(s.state(), "recording");

  t.check(s.context(), contextWith({ finalTranscript: "before the replay", held: true }));

  s.actor.send({ type: "HOLD", held: false });
  s.actor.send({ type: "STOP" });
  t.check(s.state(), "idle");

  t.check(s.log, ["actor start target=chat-1", "HOLD true", "HOLD false", "STOP", "actor stopped"]);
  t.check(s.context(), contextWith({ finalTranscript: "before the replay", recording: s.recording }));
});

// Speech longer than the idle timeout does not auto-stop a held segment;
// releasing the hold starts the idle timer over.
void test("A held segment outlasts the idle timeout, which restarts on release.", async (t) => {
  const s = segment({ delays: { NO_LIVE_TEXT_TIMEOUT: 80 } });
  s.emit({ type: "MIC_LIVE" });
  s.emit({ type: "WS_CONNECTED" });
  s.actor.send({ type: "HOLD", held: true });
  await sleep(160);
  t.check(s.state(), "recording");

  s.actor.send({ type: "HOLD", held: false });
  t.check(s.state(), "recording");

  await sleep(200);
  t.check(s.state(), "idle");
});

// The hold belongs to the mic, not the segment: a segment that starts while
// speech still plays (a send re-arms the mic) starts held.
void test("A segment started while held starts held.", async (t) => {
  const s = segment();
  s.emit({ type: "MIC_LIVE" });
  s.actor.send({ type: "HOLD", held: true });
  s.actor.send({ type: "STOP" });
  t.check(s.state(), "idle");

  t.check(s.context().held, true);

  s.actor.send({ type: "START", targetSessionId: "chat-1" });
  t.check(s.log.at(-1), "actor start target=chat-1 held");

  s.actor.send({ type: "STOP" });
  s.actor.send({ type: "HOLD", held: false });
  t.check(s.context().held, false);
});

// ## A socket that never opens leaves the segment recording
//
// `CONNECT_TIMEOUT` bounds only reaching `MIC_LIVE` (mic permission and worklet
// startup). After that, a box that is down — or restarting for a minute —
// keeps the segment in `recordingLocal` for as long as the user talks.
void test("CONNECTTIMEOUT bounds only reaching MICLIVE (mic permission and worklet start...", async (t) => {
  const s = segment({ delays: { CONNECT_TIMEOUT: 10 } });
  s.emit({ type: "MIC_LIVE" });
  await sleep(40);
  t.check(s.state(), "recordingLocal");

  t.check(s.context(), contextWith({ error: null }));
});

// Without `MIC_LIVE` the start fails as before:
void test("Without MICLIVE the start fails as before:", async (t) => {
  const s = segment({ delays: { CONNECT_TIMEOUT: 10 } });
  await sleep(40);
  t.check(s.state(), "idle");


  // Nothing was recorded, so the chat bar shows it as an error the person must act
  // on (issues/bugs/2026-08-25-one-pink-bar-three-severities.md):

  t.check(s.context(), contextWith({ error: "Recording didn't start. Please try again.", errorLevel: "error" }));
});

// ## A network drop pauses live text, with no window
//
// `CONNECTION_DEGRADED` with cause `network` goes from `recording` to
// `recordingLocal`. The audio is still staging, so nothing bounds the drop:
// `RECONNECT_WINDOW` passes and the segment is still recording.
void test("CONNECTIONDEGRADED with cause network goes from recording to recordingLocal.", async (t) => {
  const s = segment({ delays: { RECONNECT_WINDOW: 10 } });
  s.emit({ type: "MIC_LIVE" });
  s.emit({ type: "WS_CONNECTED" });
  s.emit({ type: "CONNECTION_DEGRADED", cause: "network" });
  t.check(s.state(), "recordingLocal");

  await sleep(40);
  t.check(s.state(), "recordingLocal");

  s.emit({ type: "CONNECTION_RESTORED" });
  t.check(s.state(), "recording");
});

// ## A lost microphone is bounded, and expiry ends the segment
//
// Cause `microphone` goes to `reconnecting`: no audio flows, so the window
// applies. On expiry the machine STOPs the actor and waits in `finalizing` for
// `TRANSCRIPTION_DONE`, which carries the recording.
void test("Cause microphone goes to reconnecting:", async (t) => {
  const s = segment({ delays: { RECONNECT_WINDOW: 10 }, autoDone: false });
  s.emit({ type: "MIC_LIVE" });
  s.emit({ type: "WS_CONNECTED" });
  s.emit({ type: "CONNECTION_DEGRADED", cause: "microphone" });
  t.check(s.state(), "reconnecting");

  t.check(s.context(), contextWith({ error: "Microphone interrupted — recovering…", errorLevel: "warning" }));

  await sleep(40);
  t.check(s.state(), "finalizing");

  t.check(s.context(), contextWith({ error: "Recording stopped — the microphone was taken away", errorLevel: "warning" }));

  s.emit({ type: "TRANSCRIPTION_DONE", recording: s.recording });
  t.check(s.state(), "idle");

  t.check(s.context(), contextWith({ error: "Recording stopped — the microphone was taken away", errorLevel: "warning", recording: s.recording }));
  t.check(s.context().recording, is(s.recording));
});

// When the mic comes back but the socket has not, the actor reports `MIC_LIVE`
// and the segment resumes in `recordingLocal`:
void test("When the mic comes back but the socket has not, the actor reports MICLIVE and...", async (t) => {
  const s = segment();
  s.emit({ type: "MIC_LIVE" });
  s.emit({ type: "CONNECTION_DEGRADED", cause: "microphone" });
  t.check(s.state(), "reconnecting");

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
  const s = segment();
  s.emit({ type: "MIC_LIVE" });
  s.emit({ type: "WS_CONNECTED" });
  s.emit({ type: "WS_ERROR", message: "Live transcription unavailable (code 1008) — still recording" });
  t.check(s.state(), "recordingLocal");

  t.check(s.context(), contextWith({ error: "Live transcription unavailable (code 1008) — still recording", errorLevel: "warning", liveTextCue: "dropped" }));

  // The recording went on, so the chat bar shows this as a warning, not an error:

  t.check(s.context(), contextWith({ error: "Live transcription unavailable (code 1008) — still recording", errorLevel: "warning", liveTextCue: "dropped" }));

  s.emit({ type: "SERVER_ERROR", message: "upstream quota" });
  t.check(s.state(), "recordingLocal");

  const serverError = segment();
  serverError.emit({ type: "MIC_LIVE" });
  serverError.emit({ type: "WS_CONNECTED" });
  serverError.emit({ type: "SERVER_ERROR", message: "upstream quota" });
  t.check(serverError.state(), "recordingLocal");

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
  const s = segment({ cues: true });
  s.emit({ type: "MIC_LIVE" });
  s.emit({ type: "WS_CONNECTED" });
  s.emit({ type: "CONNECTION_DEGRADED", cause: "microphone" });
  s.emit({ type: "CONNECTION_RESTORED" });
  t.check(s.cues, ["MicLost", "RecordingResumed"]);
});

// Losing live text only pauses spoken keywords, and most drops heal within a
// second or two. A drop that heals inside `LIVE_TEXT_CUE_DELAY` makes no sound
// at all:
void test("Losing live text only pauses spoken keywords, and most drops heal within a se...", async (t) => {
  const s = segment({ cues: true, delays: { LIVE_TEXT_CUE_DELAY: 30 } });
  s.emit({ type: "MIC_LIVE" });
  s.emit({ type: "WS_CONNECTED" });
  s.emit({ type: "CONNECTION_DEGRADED", cause: "network" });
  s.emit({ type: "CONNECTION_RESTORED" });
  await sleep(60);
  t.check(s.cues, []);
});

// A drop that lasts plays the quiet pause cue once, and the return plays its
// mirror. A socket that can't be fixed (`WS_ERROR`) is the same kind of loss and
// gets the same quiet cue:
void test("A drop that lasts plays the quiet pause cue once, and the return plays its mi...", async (t) => {
  const s = segment({ cues: true, delays: { LIVE_TEXT_CUE_DELAY: 10 } });
  s.emit({ type: "MIC_LIVE" });
  s.emit({ type: "WS_CONNECTED" });
  s.emit({ type: "CONNECTION_DEGRADED", cause: "network" });
  await sleep(40);
  s.emit({ type: "CONNECTION_RESTORED" });
  t.check(s.cues, ["LiveTextPaused", "LiveTextResumed"]);

  const fatal = segment({ cues: true, delays: { LIVE_TEXT_CUE_DELAY: 10 } });
  fatal.emit({ type: "MIC_LIVE" });
  fatal.emit({ type: "WS_CONNECTED" });
  fatal.emit({ type: "WS_ERROR", message: "Live transcription unavailable (code 1008) — still recording" });
  await sleep(40);
  t.check(fatal.cues, ["LiveTextPaused"]);
});

// A segment whose first socket is slow to open never had live text, so waiting
// in `recordingLocal` at the start is silent:
void test("A segment whose first socket is slow to open never had live text, so waiting...", async (t) => {
  const s = segment({ cues: true, delays: { LIVE_TEXT_CUE_DELAY: 10 } });
  s.emit({ type: "MIC_LIVE" });
  await sleep(40);
  s.emit({ type: "WS_CONNECTED" });
  t.check(s.cues, []);
});

// ## STOP from `recordingLocal` ends the segment with its recording
void test("STOP from `recordingLocal` ends the segment with its recording", async (t) => {
  const s = segment();
  s.emit({ type: "MIC_LIVE" });
  s.actor.send({ type: "STOP" });
  t.check(s.state(), "idle");

  t.check(s.context(), contextWith({ recording: s.recording }));
  t.check(s.context().recording, is(s.recording));

  t.check(s.log, ["actor start target=chat-1", "STOP", "actor stopped"]);
});

// Nothing was sealed yet: sealing is the receiver's job (the hook, or the send
// it hands the recording to).
//
// ## CANCEL discards the recording
void test("Nothing was sealed yet:", async (t) => {
  const s = segment();
  s.emit({ type: "MIC_LIVE" });
  s.actor.send({ type: "CANCEL" });
  t.check(s.state(), "idle");

  t.check(s.log, ["actor start target=chat-1", "CANCEL", "discard", "actor stopped"]);

  t.check(s.context(), contextWith({ recording: null }));
});

// ## No idle timeout while live text is paused
//
// `NO_LIVE_TEXT_TIMEOUT` lives on `recording`, where new live text resets it.
// In `recordingLocal` no text can arrive, so it does not run there.
void test("NO_LIVE_TEXT_TIMEOUT runs in recording, not in recordingLocal.", async (t) => {
  const s = segment({ delays: { NO_LIVE_TEXT_TIMEOUT: 10 } });
  s.emit({ type: "MIC_LIVE" });
  await sleep(40);
  t.check(s.state(), "recordingLocal");

  s.emit({ type: "WS_CONNECTED" });
  await sleep(40);
  t.check(s.state(), "idle");
});

// ## The mic closes after five minutes with no new live text
//
// issues/features/2026-10-28-web-live-recorder-closes-mic-after-idle.md.
// Idle means no new live text, not a quiet mic: Deepgram answers noise with
// empty interim results and re-sends unchanged finals, and those must not keep
// the mic open. A change in the text restarts the timer.
const noise = (finalText: string): TranscriptionEvent => ({ type: "TEXT_UPDATE", finalText, interimText: "", finalWords: null });

void test("New live text restarts the idle timer; empty or unchanged updates do not.", async (t) => {
  const clock = new SimulatedClock();
  const s = segment({ clock });
  s.emit({ type: "MIC_LIVE" });
  s.emit({ type: "WS_CONNECTED" });
  clock.increment(NO_LIVE_TEXT_TIMEOUT_MS - 1000);
  s.emit({ type: "TEXT_UPDATE", finalText: "", interimText: "remind me", finalWords: null });
  clock.increment(NO_LIVE_TEXT_TIMEOUT_MS - 1000);
  s.emit(noise("remind me"));
  clock.increment(NO_LIVE_TEXT_TIMEOUT_MS - 1000);
  t.check(s.state(), "recording");

  s.emit(noise("remind me"));
  s.emit({ type: "TEXT_UPDATE", finalText: "remind me", interimText: " ", finalWords: null });
  clock.increment(999);
  t.check(s.state(), "recording");

  clock.increment(1);
  t.check(s.state(), "idle");
});

// The idle close ends the segment the way a manual stop does: the actor gets
// STOP, the text and the recording (for the HQ pass) stay in context. Only the
// notice differs, a warning that names why the mic closed.
void test("The idle close ends the segment like a manual stop, plus a notice.", async (t) => {
  const run = (end: (s: ReturnType<typeof segment>, clock: SimulatedClock) => void) => {
    const clock = new SimulatedClock();
    const s = segment({ clock, cues: true });
    s.emit({ type: "MIC_LIVE" });
    s.emit({ type: "WS_CONNECTED" });
    s.emit(noise("buy milk"));
    end(s, clock);
    return s;
  };
  const manual = run((s) => s.actor.send({ type: "STOP" }));
  const idle = run((_s, clock) => clock.increment(NO_LIVE_TEXT_TIMEOUT_MS));

  t.check(manual.state(), "idle");
  t.check(idle.state(), "idle");

  t.check(manual.log, ["actor start target=chat-1", "STOP", "actor stopped"]);
  t.check(idle.log, ["actor start target=chat-1", "STOP", "actor stopped"]);

  t.check(manual.context(), contextWith({ finalTranscript: "buy milk", recording: manual.recording }));
  t.check(idle.context(), contextWith({
    finalTranscript: "buy milk",
    recording: idle.recording,
    error: "Mic closed — nothing was said for 5 minutes",
    errorLevel: "warning",
  }));
  t.check(idle.cues, ["MicOffSound"]);
});

// ## MAX_DURATION submits the segment
//
// On expiry the machine emits `maxDurationReached` (the hook parks a submit on
// it, the same path as a spoken "send", and that send re-arms the mic), then
// STOPs. The segment ends with its recording in context.
void test("On expiry the machine emits maxDurationReached (the hook parks a submit on it...", async (t) => {
  const s = segment({ delays: { MAX_DURATION: 20 } });
  s.emit({ type: "MIC_LIVE" });
  await sleep(50);
  t.check(s.emitted, ["maxDurationReached"]);

  t.check(s.state(), "idle");

  t.check(s.context(), contextWith({ recording: s.recording }));
  t.check(s.context().recording, is(s.recording));

  t.check(s.log, ["actor start target=chat-1", "STOP", "actor stopped"]);
});
