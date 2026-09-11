# Realtime transcription machine — the recording outlives the live socket

`realtimeTranscriptionMachine` (`machines/realtimeTranscriptionMachine.ts`)
separates the recording from the live transcription socket
(`docs/plans/resilient-voice-recording.md`, Track 3). Once the actor reports
`MIC_LIVE`, audio is staging to the box, and the live socket is a preview that
may come and go: `recordingLocal` is "recording, no live text". Only a lost
microphone is bounded by a window, because only then does audio stop.

The real actor needs the audio worklet, so these examples drive the machine
with a fake one that answers the way the real actor does: `STOP` gets an
immediate `TRANSCRIPTION_DONE` carrying the recording, and `CANCEL` discards
it. `s.emit(event)` plays the actor's side. Delays are shortened per example;
earcon actions are silenced.

```ts setup
import { createActor, fromCallback } from "xstate";
import {
  realtimeTranscriptionMachine,
  transcriptionStateOf,
} from "../../src/frontend/src/machines/realtimeTranscriptionMachine.js";

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

const quiet = () => {};
const SILENT_EARCONS = {
  playRecordingDropped: quiet,
  playRecordingResumed: quiet,
  playMicOffSound: quiet,
  playStartFailedSound: quiet,
};

function segment(opts?: { delays?: Record<string, number>; autoDone?: boolean }) {
  const log: string[] = [];
  const recording = {
    recordingId: "rec-1",
    seal: (hq: { emissionId: string } | null) => log.push(`seal ${hq === null ? "null" : hq.emissionId}`),
    discard: () => log.push("discard"),
  };
  let toMachine = (_event: unknown) => {};
  const emitted: string[] = [];
  const fake = fromCallback(({ sendBack, receive, input }) => {
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
      actions: SILENT_EARCONS,
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
    recording,
    emitted,
    emit: (event: unknown) => toMachine(event),
    state: () => transcriptionStateOf(actor.getSnapshot()),
    context: () => actor.getSnapshot().context,
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
```

## The mic goes live before any socket exists

`START` passes the chat's session id to the actor. `MIC_LIVE` moves
`connecting` to `recordingLocal`, and the first socket open moves it on to
`recording`.

```ts
const s = segment();
s.state()
=> connecting

s.log.join(",")
=> actor start target=chat-1

s.emit({ type: "MIC_LIVE" });
s.state()
=> recordingLocal

s.emit({ type: "WS_CONNECTED" });
s.state()
=> recording
```

## A socket that never opens leaves the segment recording

`CONNECT_TIMEOUT` bounds only reaching `MIC_LIVE` (mic permission and worklet
startup). After that, a box that is down — or restarting for a minute —
keeps the segment in `recordingLocal` for as long as the user talks.

```ts
const s = segment({ delays: { CONNECT_TIMEOUT: 10 } });
s.emit({ type: "MIC_LIVE" });
await sleep(40);
s.state()
=> recordingLocal

s.context().error
=> null
```

Without `MIC_LIVE` the start fails as before:

```ts
const s = segment({ delays: { CONNECT_TIMEOUT: 10 } });
await sleep(40);
s.state()
=> idle

s.context().error
=> Recording didn't start. Please try again.
```

## A network drop pauses live text, with no window

`CONNECTION_DEGRADED` with cause `network` goes from `recording` to
`recordingLocal`. The audio is still staging, so nothing bounds the drop:
`RECONNECT_WINDOW` passes and the segment is still recording.

```ts
const s = segment({ delays: { RECONNECT_WINDOW: 10 } });
s.emit({ type: "MIC_LIVE" });
s.emit({ type: "WS_CONNECTED" });
s.emit({ type: "CONNECTION_DEGRADED", cause: "network" });
s.state()
=> recordingLocal

await sleep(40);
s.state()
=> recordingLocal

s.emit({ type: "CONNECTION_RESTORED" });
s.state()
=> recording
```

## A lost microphone is bounded, and expiry ends the segment

Cause `microphone` goes to `reconnecting`: no audio flows, so the window
applies. On expiry the machine STOPs the actor and waits in `finalizing` for
`TRANSCRIPTION_DONE`, which carries the recording.

```ts
const s = segment({ delays: { RECONNECT_WINDOW: 10 }, autoDone: false });
s.emit({ type: "MIC_LIVE" });
s.emit({ type: "WS_CONNECTED" });
s.emit({ type: "CONNECTION_DEGRADED", cause: "microphone" });
s.state()
=> reconnecting

s.context().error
=> Microphone interrupted — recovering…

await sleep(40);
s.state()
=> finalizing

s.context().error
=> Recording stopped — the microphone was taken away

s.emit({ type: "TRANSCRIPTION_DONE", recording: s.recording });
s.state()
=> idle

s.context().recording === s.recording
=> true
```

When the mic comes back but the socket has not, the actor reports `MIC_LIVE`
and the segment resumes in `recordingLocal`:

```ts
const s = segment();
s.emit({ type: "MIC_LIVE" });
s.emit({ type: "CONNECTION_DEGRADED", cause: "microphone" });
s.state()
=> reconnecting

s.emit({ type: "MIC_LIVE" });
s.state()
=> recordingLocal
```

## A socket that can't be fixed ends live text, not the recording

A non-retryable close (`1003`/`1008`), reported as `WS_ERROR`, moves
`recording` to `recordingLocal` and keeps the message for the error banner.
A service error and a bare close do the same. None of them reaches `idle`,
which would strand the audio.

```ts
const s = segment();
s.emit({ type: "MIC_LIVE" });
s.emit({ type: "WS_CONNECTED" });
s.emit({ type: "WS_ERROR", message: "Live transcription unavailable (code 1008) — still recording" });
s.state()
=> recordingLocal

s.context().error
=> Live transcription unavailable (code 1008) — still recording

s.emit({ type: "SERVER_ERROR", message: "upstream quota" });
s.state()
=> recordingLocal

const serverError = segment();
serverError.emit({ type: "MIC_LIVE" });
serverError.emit({ type: "WS_CONNECTED" });
serverError.emit({ type: "SERVER_ERROR", message: "upstream quota" });
serverError.state()
=> recordingLocal

const bareClose = segment();
bareClose.emit({ type: "MIC_LIVE" });
bareClose.emit({ type: "WS_CONNECTED" });
bareClose.emit({ type: "WS_CLOSED" });
bareClose.state()
=> recordingLocal
```

## STOP from `recordingLocal` ends the segment with its recording

```ts
const s = segment();
s.emit({ type: "MIC_LIVE" });
s.actor.send({ type: "STOP" });
s.state()
=> idle

s.context().recording === s.recording
=> true

s.log.join(",")
=> actor start target=chat-1,STOP,actor stopped
```

Nothing was sealed yet: sealing is the receiver's job (the hook, or the send
it hands the recording to).

## CANCEL discards the recording

```ts
const s = segment();
s.emit({ type: "MIC_LIVE" });
s.actor.send({ type: "CANCEL" });
s.state()
=> idle

s.log.join(",")
=> actor start target=chat-1,CANCEL,discard,actor stopped

s.context().recording
=> null
```

## No silence timeout while live text is paused

`SILENCE_TIMEOUT` lives on `recording`, where each live-text update resets it.
In `recordingLocal` no text arrives to reset it, so it does not run there.

```ts
const s = segment({ delays: { SILENCE_TIMEOUT: 10 } });
s.emit({ type: "MIC_LIVE" });
await sleep(40);
s.state()
=> recordingLocal

s.emit({ type: "WS_CONNECTED" });
await sleep(40);
s.state()
=> idle
```

## MAX_DURATION submits the segment

On expiry the machine emits `maxDurationReached` (the hook parks a submit on
it, the same path as a spoken "send", and that send re-arms the mic), then
STOPs. The segment ends with its recording in context.

```ts
const s = segment({ delays: { MAX_DURATION: 20 } });
s.emit({ type: "MIC_LIVE" });
await sleep(50);
s.emitted.join(",")
=> maxDurationReached

s.state()
=> idle

s.context().recording === s.recording
=> true

s.log.includes("STOP")
=> true
```
