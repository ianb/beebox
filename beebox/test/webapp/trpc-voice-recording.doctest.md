# `voiceRecording` tRPC procedures: status, claim, fallBack

The client half of the voice-recording handoff
(`docs/plans/resilient-voice-recording.md`, Track 1). `status`/`statusByMessage`
are read-only ground truth for the pending bubble/badge; `claim`/`fallBack`
apply one event through the same `nextVoiceState` machine the HQ job and
finalize route already drive — this router adds no side effect beyond that one
write, and both mutations are idempotent by `(recordingId, emissionId)`.

```ts setup
import { appRouter } from "../../src/webapp/trpc/router.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
import { createEventBus } from "../../src/core/event-bus.js";
import { createStagingSession, readStagingSession } from "../../src/core/capture/staging-store.js";
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
    boxRoot: box.root, id: session.id,
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

## fallBack before ready is `late`; after ready HQ wins with `claimed`

```ts
const box = await makeTmpBox();
const late = await stageVoiceRecording(box, { targetSessionId: "chat-1" });
await requestHq(box, late, { emissionId: "em-late" });
const c = caller(box);

JSON.stringify(await c.voiceRecording.fallBack({ recordingId: late.id, emissionId: "em-late", sessionId: "chat-1" }))
=> {"outcome":"late"}
```

```ts continue
const wonByHq = await stageVoiceRecording(box, { targetSessionId: "chat-1" });
await requestHq(box, wonByHq, { emissionId: "em-won" });
await applyVoiceEvent({
  boxRoot: box.root, id: wonByHq.id,
  event: { type: "allPiecesDone", result: READY_RESULT },
});

JSON.stringify(await c.voiceRecording.fallBack({ recordingId: wonByHq.id, emissionId: "em-won", sessionId: "chat-1" }))
=> {"outcome":"claimed","result":{"text":"hello world","diarized":false,"service":"whisper","pieces":1}}
```

```ts cleanup
await box.cleanup();
```

## fallBack names the session for the first message of a new chat

A recording started in a chat with no session is finalized with
`hq.sessionId: null`. `fallBack` carries the session the realtime message
was sent to and writes it into `hqRequest`, where late delivery reads it; a
later fallBack naming another session is a CONFLICT.

```ts
const box = await makeTmpBox();
const session = await stageVoiceRecording(box, { targetSessionId: null });
await requestHq(box, session, { emissionId: "em-new" });
const c = caller(box);

JSON.stringify(await c.voiceRecording.fallBack({ recordingId: session.id, emissionId: "em-new", sessionId: "chat-new" }))
=> {"outcome":"late"}

(await readStagingSession({ boxRoot: box.root, id: session.id })).voice.hqRequest.sessionId
=> chat-new

await c.voiceRecording.fallBack({ recordingId: session.id, emissionId: "em-other", sessionId: "chat-else" }).then(() => "no error", (e) => e.code)
=> CONFLICT
```

```ts cleanup
await box.cleanup();
```

## fallBack after a terminal HQ failure reports `failed`, not `late`

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

JSON.stringify(await c.voiceRecording.fallBack({ recordingId: session.id, emissionId: "em-1", sessionId: "chat-1" }))
=> {"outcome":"failed","failure":{"kind":"permanent","code":"http_401","message":"missing key"}}
```

```ts cleanup
await box.cleanup();
```

## fallBack stays idempotent even after late delivery advances past `late`

A `fallBack` response can be lost in transit after it already recorded
`late`; a retry can arrive after late delivery has moved on to `delivering`
or `delivered`. Both must answer the same `late` outcome, not a conflict:

```ts
const box = await makeTmpBox();
const session = await stageVoiceRecording(box, { targetSessionId: "chat-1" });
await requestHq(box, session, { emissionId: "em-1" });
const c = caller(box);

JSON.stringify(await c.voiceRecording.fallBack({ recordingId: session.id, emissionId: "em-1", sessionId: "chat-1" }))
=> {"outcome":"late"}
```

```ts continue
await applyVoiceEvent({
  boxRoot: box.root, id: session.id,
  event: { type: "allPiecesDone", result: READY_RESULT },
});
await applyVoiceEvent({
  boxRoot: box.root, id: session.id,
  event: { type: "lateDeliveryStarted", originalLanded: true },
});

JSON.stringify(await c.voiceRecording.fallBack({ recordingId: session.id, emissionId: "em-1", sessionId: "chat-1" }))
=> {"outcome":"late"}
```

```ts continue
await applyVoiceEvent({
  boxRoot: box.root, id: session.id,
  event: { type: "landedConfirmed", messageId: session.id },
});

JSON.stringify(await c.voiceRecording.fallBack({ recordingId: session.id, emissionId: "em-1", sessionId: "chat-1" }))
=> {"outcome":"late"}
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

## statusByMessage finds a recording by its HQ emission id, and by its own recording id

Before a claim, only `hqRequest.emissionId` points at the recording — the
handoff carries no emission id yet (still `open`):

```ts
const box = await makeTmpBox();
const session = await stageVoiceRecording(box, { targetSessionId: "chat-1" });
await requestHq(box, session, { emissionId: "em-1" });
const c = caller(box);

const byEmission = await c.voiceRecording.statusByMessage({ messageId: "em-1" });
JSON.stringify({ recordingId: byEmission.recordingId, hqState: byEmission.hq.state })
=> {"recordingId":"«*»","hqState":"queued"}
```

Once claimed, the recording is also addressable by its OWN id — the shape a
late-delivered correction's `message-id` uses to point back at itself:

```ts continue
await applyVoiceEvent({
  boxRoot: box.root, id: session.id,
  event: { type: "allPiecesDone", result: READY_RESULT },
});
await c.voiceRecording.claim({ recordingId: session.id, emissionId: "em-1" });

const byRecordingId = await c.voiceRecording.statusByMessage({ messageId: session.id });
JSON.stringify({ hqState: byRecordingId.hq.state, handoff: byRecordingId.handoff })
=> {"hqState":"ready","handoff":{"mode":"claimed","emissionId":"em-1"}}

await c.voiceRecording.statusByMessage({ messageId: "no-such-message" })
=> null
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
