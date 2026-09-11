# `voiceRecording` tRPC procedures: status, claim, fallBack

The client half of the voice-recording handoff
(`docs/plans/resilient-voice-recording.md`, Track 1). `status` is read-only
ground truth for the pending bubble; `claim`/`fallBack`
apply one event through the same `nextVoiceState` machine the HQ job and
finalize route already drive — this router adds no side effect beyond that one
write, and both mutations are idempotent by `(recordingId, emissionId)`.

```ts setup
import { appRouter } from "../../src/webapp/trpc/router.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { createEventBus } from "../../src/core/event-bus.js";
import { createStagingSession } from "../../src/core/capture/staging-store.js";
import { sealVoiceSession, applyVoiceEvent } from "../../src/core/voice-recording/voice-staging.js";

function caller(box, opts) {
  return appRouter.createCaller({
    boxRoot: box.root,
    boxSlug: "test",
    eventBus: createEventBus(box.root),
    services: {},
    user: (opts && opts.user) || { email: "owner@example.com", name: "Owner" },
    authed: true,
    isOwner: true,
  });
}

async function stageVoiceRecording(box, { targetSessionId, createdBy }) {
  return createStagingSession({
    boxRoot: box.root, targetSessionId, createdBy: createdBy ?? "owner@example.com", kind: "voice",
  });
}

async function requestHq(box, session, { emissionId, service, requestedAt }) {
  return sealVoiceSession({
    boxRoot: box.root, id: session.id, emissionId,
    hq: {
      emissionId, sessionId: session.voice.targetSessionId,
      service: service ?? "whisper", requestedAt: requestedAt ?? "2026-09-10T18:00:00.000Z",
    },
  });
}

const READY_RESULT = { text: "hello world", diarized: false, service: "whisper", pieces: 1 };
```

## claim before ready is `pending`; after ready it is `claimed` and idempotent

```ts
const box = await makeTmpBox();
const session = await stageVoiceRecording(box, { targetSessionId: "chat-1" });
await requestHq(box, session, { emissionId: "em-1" });
const c = caller(box);

JSON.stringify(await c.voiceRecording.claim({ recordingId: session.id, emissionId: "em-1" }))
=> {"outcome":"pending","hq":{"state":"queued"}}
```

```ts continue
await applyVoiceEvent({
  boxRoot: box.root, id: session.id,
  event: { type: "allPiecesDone", result: READY_RESULT },
});

const claimed = await c.voiceRecording.claim({ recordingId: session.id, emissionId: "em-1" });
JSON.stringify(claimed)
=> {"outcome":"claimed","result":{"text":"hello world","diarized":false,"service":"whisper","pieces":1}}

// Idempotent repeat — same call again, same outcome, no error.
JSON.stringify(await c.voiceRecording.claim({ recordingId: session.id, emissionId: "em-1" }))
=> {"outcome":"claimed","result":{"text":"hello world","diarized":false,"service":"whisper","pieces":1}}
```

```ts cleanup
await box.cleanup();
```

## fallBack before ready is `fellBack`; after ready HQ wins with `claimed`

```ts
const box = await makeTmpBox();
const fellBack = await stageVoiceRecording(box, { targetSessionId: "chat-1" });
await requestHq(box, fellBack, { emissionId: "em-live" });
const c = caller(box);

JSON.stringify(await c.voiceRecording.fallBack({ recordingId: fellBack.id, emissionId: "em-live" }))
=> {"outcome":"fellBack"}

// Idempotent repeat (a lost response, retried) — even after HQ finishes.
await applyVoiceEvent({
  boxRoot: box.root, id: fellBack.id,
  event: { type: "allPiecesDone", result: READY_RESULT },
});
JSON.stringify(await c.voiceRecording.fallBack({ recordingId: fellBack.id, emissionId: "em-live" }))
=> {"outcome":"fellBack"}
```

```ts continue
const wonByHq = await stageVoiceRecording(box, { targetSessionId: "chat-1" });
await requestHq(box, wonByHq, { emissionId: "em-won" });
await applyVoiceEvent({
  boxRoot: box.root, id: wonByHq.id,
  event: { type: "allPiecesDone", result: READY_RESULT },
});

JSON.stringify(await c.voiceRecording.fallBack({ recordingId: wonByHq.id, emissionId: "em-won" }))
=> {"outcome":"claimed","result":{"text":"hello world","diarized":false,"service":"whisper","pieces":1}}
```

```ts cleanup
await box.cleanup();
```

## fallBack after a terminal HQ failure reports `failed`

```ts
const box = await makeTmpBox();
const session = await stageVoiceRecording(box, { targetSessionId: "chat-1" });
await requestHq(box, session, { emissionId: "em-1" });
await applyVoiceEvent({
  boxRoot: box.root, id: session.id,
  event: {
    type: "pieceFailed", classification: "permanent", pieceSeconds: 300, attempt: 1,
    nextAttemptAt: "2026-09-10T18:00:00.000Z",
    failure: { code: "http_401", message: "missing key" },
  },
});
const c = caller(box);

JSON.stringify(await c.voiceRecording.fallBack({ recordingId: session.id, emissionId: "em-1" }))
=> {"outcome":"failed","failure":{"kind":"permanent","code":"http_401","message":"missing key"}}
```

```ts cleanup
await box.cleanup();
```

## A mismatched emission id is a CONFLICT, never a silent no-op

```ts
const box = await makeTmpBox();
const session = await stageVoiceRecording(box, { targetSessionId: "chat-1" });
await requestHq(box, session, { emissionId: "em-1" });
const c = caller(box);

await c.voiceRecording.claim({ recordingId: session.id, emissionId: "wrong-emission" }).then(() => "no error", (e) => e.code)
=> CONFLICT
```

```ts cleanup
await box.cleanup();
```

## A recording created by another user is invisible: NOT_FOUND, not FORBIDDEN

Owner check mirrors `authorizeCaptureSessionOwner`: the caller's authenticated
email must match the session's `createdBy`. A mismatch answers NOT_FOUND
(hiding existence) rather than disclosing that a recording exists under
someone else's account.

```ts
const box = await makeTmpBox();
const session = await stageVoiceRecording(box, { targetSessionId: "chat-1", createdBy: "someone-else@example.com" });
await requestHq(box, session, { emissionId: "em-1" });
const stranger = caller(box);

await stranger.voiceRecording.status({ recordingId: session.id }).then(() => "no error", (e) => e.code)
=> NOT_FOUND
```

```ts cleanup
await box.cleanup();
```
