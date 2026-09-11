# The HQ transcription job

`runHqJob` (`docs/plans/resilient-voice-recording.md`, Track 1) concatenates a
voice recording's staged PCM chunks, transcribes them piece by piece, retries
a transient/piece-too-long failure, and persists every transition through
`nextVoiceState` — emitting `voice-recording-status` on the event bus each
time. `clock` and `transcribePiece` are injectable so these tests never wait
a real backoff or reach a real HQ service.

```ts setup
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
import { createEventBus } from "../../../src/core/event-bus.js";
import { createStagingSession, addAudioChunk, readStagingSession } from "../../../src/core/capture/staging-store.js";
import { sealVoiceSession, applyVoiceEvent } from "../../../src/core/voice-recording/voice-staging.js";
import { runHqJob } from "../../../src/core/voice-recording/hq-job.js";

const GITIGNORE = ["_tmp/", ".beebox/"].join("\n") + "\n";

async function configureBox(box) {
  await box.write(".gitignore", GITIGNORE);
  box.commitAll("configure");
}

// A no-op clock: `now()` is fixed unless advanced, `wait()` resolves
// immediately so a scripted backoff never actually sleeps in a test.
function fakeClock(startIso) {
  let current = new Date(startIso);
  return {
    now: () => current,
    wait: async (_ms) => {},
    advance(ms) {
      current = new Date(current.getTime() + ms);
    },
  };
}

// Scripts a sequence of transcribePiece outcomes, consumed in call order.
// An entry is `{ error }` (thrown, error carries permanent/status/body) or a
// success result `{ text, diarized? }`.
function scriptedTranscribe(script) {
  let i = 0;
  return async (_params, _opts) => {
    if (i >= script.length) throw new Error(`scriptedTranscribe: no more scripted outcomes (call ${i + 1})`);
    const entry = script[i];
    i++;
    if (entry.error) throw entry.error;
    return entry;
  };
}

class ScriptedTranscriptionError extends Error {
  constructor(message, { permanent, status, body }) {
    super(message);
    this.permanent = permanent;
    if (status !== undefined) this.status = status;
    if (body !== undefined) this.body = body;
  }
}

async function stageVoiceRecording(box, { targetSessionId, bytes }) {
  const session = await createStagingSession({ boxRoot: box.root, targetSessionId, createdBy: null, kind: "voice" });
  await addAudioChunk({
    boxRoot: box.root, id: session.id, segmentId: session.id, segmentStartedAt: "2026-09-10T18:00:00.000Z",
    filename: "pcm-000001.raw", buffer: Buffer.alloc(bytes), audioFormat: "pcm-s16le-16k",
  });
  return session;
}

async function requestHq(box, session, opts) {
  const { requestedAt, service } = opts || {};
  const seal = await sealVoiceSession({
    boxRoot: box.root, id: session.id, emissionId: "emission-1",
    hq: { emissionId: "emission-1", sessionId: session.voice.targetSessionId, service: service ?? "whisper", requestedAt: requestedAt ?? "2026-09-10T18:00:00.000Z" },
  });
  return seal;
}

function collectBusEvents(eventBus) {
  const events = [];
  eventBus.subscribe({ listener: (e) => { if (e.event === "voice-recording-status") events.push(e.data); } });
  return events;
}
```

## A transient failure retries the same piece, then succeeds

```ts
const box = await makeTmpBox({ git: true });
await configureBox(box);
const session = await stageVoiceRecording(box, { targetSessionId: "chat-1", bytes: 1000 });
await requestHq(box, session);
const eventBus = createEventBus(box.root);
const events = collectBusEvents(eventBus);

const transcribePiece = scriptedTranscribe([
  { error: new ScriptedTranscriptionError("network blip", { permanent: undefined }) },
  { text: "hello world" },
]);
const clock = fakeClock("2026-09-10T18:01:00.000Z");
await runHqJob({ boxRoot: box.root, id: session.id, eventBus, clock, transcribePiece });

const after = await readStagingSession({ boxRoot: box.root, id: session.id });
JSON.stringify(after.voice.hq)
=> {"state":"ready","result":{"text":"hello world","diarized":false,"service":"whisper","pieces":1}}
```

A `voice-recording-status` event was emitted for each transition — the first
attempt, the retry, the second attempt, and the final ready state:

```ts continue
JSON.stringify({ count: events.length, last: events[events.length - 1].hq.state })
=> {"count":4,"last":"ready"}
```

```ts cleanup
await box.cleanup();
```

## A piece-too-long failure halves the piece length and restarts

12,000,000 bytes at the default 300 s piece length (9,600,000 bytes/piece) is
two pieces; a 413 on the first attempt halves to 150 s and restarts from
piece 1 — three pieces at the new length, all of which succeed:

```ts
const box = await makeTmpBox({ git: true });
await configureBox(box);
const session = await stageVoiceRecording(box, { targetSessionId: "chat-1", bytes: 12_000_000 });
await requestHq(box, session);
const eventBus = createEventBus(box.root);

const transcribePiece = scriptedTranscribe([
  { error: new ScriptedTranscriptionError("too long", { permanent: false, status: 413 }) },
  { text: "one" },
  { text: "two" },
  { text: "three" },
]);
const clock = fakeClock("2026-09-10T18:01:00.000Z");
await runHqJob({ boxRoot: box.root, id: session.id, eventBus, clock, transcribePiece });

const after = await readStagingSession({ boxRoot: box.root, id: session.id });
JSON.stringify(after.voice.hq)
=> {"state":"ready","result":{"text":"one\n\ntwo\n\nthree","diarized":false,"service":"whisper","pieces":3}}
```

```ts cleanup
await box.cleanup();
```

## A permanent failure fails the recording; the HQ badge gets a reason

```ts
const box = await makeTmpBox({ git: true });
await configureBox(box);
const session = await stageVoiceRecording(box, { targetSessionId: "chat-1", bytes: 1000 });
await requestHq(box, session);
const eventBus = createEventBus(box.root);

const transcribePiece = scriptedTranscribe([
  { error: new ScriptedTranscriptionError("missing key", { permanent: true, status: 401, body: "no api key" }) },
]);
const clock = fakeClock("2026-09-10T18:01:00.000Z");
await runHqJob({ boxRoot: box.root, id: session.id, eventBus, clock, transcribePiece });

const after = await readStagingSession({ boxRoot: box.root, id: session.id });
JSON.stringify(after.voice.hq)
=> {"state":"failed","failure":{"kind":"permanent","code":"http_401","message":"missing key","upstreamStatus":401,"upstreamBody":"no api key"}}
```

```ts cleanup
await box.cleanup();
```

## 24h without a result gives up, even before the first attempt on a fresh restart

`hqRequest.requestedAt` is checked before every attempt — including the very
first one on a resumed job — so a request that's already 25h old expires
without ever calling `transcribePiece`:

```ts
const box = await makeTmpBox({ git: true });
await configureBox(box);
const session = await stageVoiceRecording(box, { targetSessionId: "chat-1", bytes: 1000 });
await requestHq(box, session, { requestedAt: "2026-09-09T18:00:00.000Z" });
const eventBus = createEventBus(box.root);

const transcribePiece = async () => { throw new Error("must not be called"); };
const clock = fakeClock("2026-09-10T19:00:01.000Z"); // 25h + 1s later
await runHqJob({ boxRoot: box.root, id: session.id, eventBus, clock, transcribePiece });

const after = await readStagingSession({ boxRoot: box.root, id: session.id });
JSON.stringify(after.voice.hq)
=> {"state":"failed","failure":{"kind":"exhausted","code":"hq_retry_exhausted","message":"HQ transcription retry window elapsed"}}
```

```ts cleanup
await box.cleanup();
```

## Diarized multi-piece results are relabeled per piece with part markers

20,000,000 bytes is three pieces at 300 s (9,600,000 + 9,600,000 + 800,000).
With no prior transcript, speaker letters start at A and advance per piece:

```ts
const box = await makeTmpBox({ git: true });
await configureBox(box);
const session = await stageVoiceRecording(box, { targetSessionId: "chat-diarized", bytes: 20_000_000 });
await requestHq(box, session, { service: "mai-diarized" });
const eventBus = createEventBus(box.root);

const transcribePiece = scriptedTranscribe([
  { text: "Speaker 0: hi", diarized: true },
  { text: "Speaker 0: there", diarized: true },
  { text: "Speaker 0: bye", diarized: true },
]);
const clock = fakeClock("2026-09-10T18:01:00.000Z");
await runHqJob({ boxRoot: box.root, id: session.id, eventBus, clock, transcribePiece });

const after = await readStagingSession({ boxRoot: box.root, id: session.id });
JSON.stringify(after.voice.hq)
=> {"state":"ready","result":{"text":"— part 1 of 3 —\nSpeaker 1A: hi\n\n— part 2 of 3 —\nSpeaker 1B: there\n\n— part 3 of 3 —\nSpeaker 1C: bye","diarized":true,"service":"mai-diarized","pieces":3}}
```

```ts cleanup
await box.cleanup();
```

## A resumed job continues the attempt counter, not just the piece length

If a process restart interrupts a `retrying` job, `runHqJob`'s backoff must
pick up where the attempt counter left off — re-warming from attempt 1 after
every restart would retry faster than `jitteredBackoff`'s exponential curve
intends. Drive the manifest straight to `retrying` at attempt 5 (as if four
prior attempts already failed), then resume it:

```ts
const box = await makeTmpBox({ git: true });
await configureBox(box);
const session = await stageVoiceRecording(box, { targetSessionId: "chat-1", bytes: 1000 });
await requestHq(box, session);
await applyVoiceEvent({
  boxRoot: box.root, id: session.id,
  event: { type: "pieceStarted", piece: 1, pieces: 1, attempt: 5, pieceSeconds: 300 },
});
await applyVoiceEvent({
  boxRoot: box.root, id: session.id,
  event: {
    type: "pieceFailed", classification: "transient", pieceSeconds: 300, attempt: 5,
    nextAttemptAt: "2026-09-10T18:00:00.000Z", // already past — the resumed job needn't wait
    failure: { code: "network_error", message: "blip" },
  },
});

const eventBus = createEventBus(box.root);
const events = [];
eventBus.subscribe({ listener: (e) => { if (e.event === "voice-recording-status") events.push(e.data); } });

const transcribePiece = scriptedTranscribe([{ text: "resumed" }]);
const clock = fakeClock("2026-09-10T18:05:00.000Z"); // well past nextAttemptAt
await runHqJob({ boxRoot: box.root, id: session.id, eventBus, clock, transcribePiece });

// The resumed attempt should be 6 (continuing from the persisted 5), not 1.
JSON.stringify({ resumedAttempt: events[0].hq.state === "transcribing" ? events[0].hq.attempt : null })
=> {"resumedAttempt":6}
```

```ts cleanup
await box.cleanup();
```
