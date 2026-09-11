# Voice recording HQ state machine

`nextVoiceState(voice, event)` is the pure transition function over one
recording's `hq` progress and `handoff` decision
(`docs/plans/resilient-voice-recording.md`, Track 1). It returns the next
`voice` object, the SAME object unchanged for an idempotent no-op, or a typed
refusal for an event that doesn't apply from the current state.

```ts setup
import { nextVoiceState } from "../../../src/core/voice-recording/state.js";

const NONE_OPEN = { targetSessionId: "chat-1", startedAt: "2026-09-10T18:00:00.000Z", hq: { state: "none" }, handoff: { mode: "open" } };

function apply(voice, event) {
  const result = nextVoiceState(voice, event);
  return result.ok ? result.value : { refused: result.error.code };
}
```

## `requested`: none → queued, writes `hqRequest`

```ts
const requested = apply(NONE_OPEN, {
  type: "requested", requestedAt: "2026-09-10T18:05:00.000Z", service: "mai-diarized",
  emissionId: "emission-1", sessionId: "chat-1",
});
JSON.stringify(requested)
=> {"targetSessionId":"chat-1","startedAt":"2026-09-10T18:00:00.000Z","hq":{"state":"queued"},"handoff":{"mode":"open"},"hqRequest":{"requestedAt":"2026-09-10T18:05:00.000Z","service":"mai-diarized","emissionId":"emission-1","sessionId":"chat-1"}}
```

A repeat with the SAME emission is a no-op (same object back):

```ts continue
const repeat = nextVoiceState(requested, {
  type: "requested", requestedAt: "2026-09-10T18:06:00.000Z", service: "mai-diarized",
  emissionId: "emission-1", sessionId: "chat-1",
});
JSON.stringify({ ok: repeat.ok, unchanged: repeat.ok && repeat.value === requested })
=> {"ok":true,"unchanged":true}
```

A DIFFERENT emission is refused — the request already belongs to another send:

```ts continue
JSON.stringify(apply(requested, {
  type: "requested", requestedAt: "2026-09-10T18:07:00.000Z", service: "mai-diarized",
  emissionId: "emission-2", sessionId: "chat-1",
}))
=> {"refused":"emission-mismatch"}
```

## Job progress: pieceStarted, pieceFailed, allPiecesDone

```ts continue
const started = apply(requested, { type: "pieceStarted", piece: 1, pieces: 2, attempt: 1, pieceSeconds: 300 });
JSON.stringify(started.hq)
=> {"state":"transcribing","piece":1,"pieces":2,"attempt":1,"pieceSeconds":300}
```

A transient failure moves to `retrying`, keeping the piece length:

```ts continue
const transientFail = apply(started, {
  type: "pieceFailed", classification: "transient", pieceSeconds: 300, attempt: 1,
  nextAttemptAt: "2026-09-10T18:10:00.000Z",
  failure: { code: "http_502", message: "Bad Gateway" },
});
JSON.stringify(transientFail.hq)
=> {"state":"retrying","attempt":1,"nextAttemptAt":"2026-09-10T18:10:00.000Z","pieceSeconds":300,"failure":{"code":"http_502","message":"Bad Gateway","kind":"transient"}}
```

`piece-too-long` also moves to `retrying`, with the job's already-halved
piece length:

```ts continue
const halved = apply(started, {
  type: "pieceFailed", classification: "piece-too-long", pieceSeconds: 150, attempt: 1,
  nextAttemptAt: "2026-09-10T18:10:00.000Z",
  failure: { code: "http_408", message: "Timeout" },
});
JSON.stringify(halved.hq)
=> {"state":"retrying","attempt":1,"nextAttemptAt":"2026-09-10T18:10:00.000Z","pieceSeconds":150,"failure":{"code":"http_408","message":"Timeout","kind":"transient"}}
```

A permanent failure is terminal:

```ts continue
const permFail = apply(started, {
  type: "pieceFailed", classification: "permanent", pieceSeconds: 300, attempt: 1,
  nextAttemptAt: "2026-09-10T18:10:00.000Z",
  failure: { code: "missing_openrouter_key", message: "no key" },
});
JSON.stringify(permFail.hq)
=> {"state":"failed","failure":{"code":"missing_openrouter_key","message":"no key","kind":"permanent"}}
```

Every piece done → `ready`:

```ts continue
const ready = apply(started, {
  type: "allPiecesDone", result: { text: "hello world", diarized: true, service: "mai-diarized", pieces: 2 },
});
JSON.stringify(ready.hq)
=> {"state":"ready","result":{"text":"hello world","diarized":true,"service":"mai-diarized","pieces":2}}
```

A job-progress event from a state it doesn't apply to (e.g. `pieceStarted`
before any request) is refused:

```ts continue
JSON.stringify(apply(NONE_OPEN, { type: "pieceStarted", piece: 1, pieces: 1, attempt: 1, pieceSeconds: 300 }))
=> {"refused":"invalid-hq-state"}
```

## `expired`: 24h with no result → failed exhausted

Expiring a `retrying` state preserves the failure's code/message but marks it exhausted:

```ts continue
const expired = apply(transientFail, { type: "expired" });
JSON.stringify(expired.hq)
=> {"state":"failed","failure":{"code":"http_502","message":"Bad Gateway","kind":"exhausted"}}
```

Expiring from `queued` (no prior failure recorded yet) still terminates, with a generic message:

```ts continue
const expiredFromQueued = apply(requested, { type: "expired" });
JSON.stringify(expiredFromQueued.hq)
=> {"state":"failed","failure":{"kind":"exhausted","code":"hq_retry_exhausted","message":"HQ transcription retry window elapsed"}}
```

Expiring an already-terminal or never-requested voice is an idempotent no-op:

```ts continue
const expiredAlreadyReady = nextVoiceState(ready, { type: "expired" });
JSON.stringify({ ok: expiredAlreadyReady.ok, unchanged: expiredAlreadyReady.ok && expiredAlreadyReady.value === ready })
=> {"ok":true,"unchanged":true}

const expiredNever = nextVoiceState(NONE_OPEN, { type: "expired" });
JSON.stringify({ ok: expiredNever.ok, unchanged: expiredNever.ok && expiredNever.value === NONE_OPEN })
=> {"ok":true,"unchanged":true}
```

## `claimRequested`: only from `open`, only once `ready`, idempotent

Claiming before the result is ready is a no-op — the caller reads the current
status from the returned (unchanged) `voice.hq`:

```ts continue
const notYet = nextVoiceState(started, { type: "claimRequested", emissionId: "emission-1" });
JSON.stringify({ ok: notYet.ok, unchanged: notYet.ok && notYet.value === started, hqState: notYet.ok && notYet.value.hq.state })
=> {"ok":true,"unchanged":true,"hqState":"transcribing"}
```

Claiming once ready transitions the handoff to `claimed`:

```ts continue
const claimed = apply(ready, { type: "claimRequested", emissionId: "emission-1" });
JSON.stringify(claimed.handoff)
=> {"mode":"claimed","emissionId":"emission-1"}
```

A repeat claim by the SAME emission is idempotent:

```ts continue
const claimAgain = nextVoiceState(claimed, { type: "claimRequested", emissionId: "emission-1" });
JSON.stringify({ ok: claimAgain.ok, unchanged: claimAgain.ok && claimAgain.value === claimed })
=> {"ok":true,"unchanged":true}
```

A claim naming the wrong emission is refused:

```ts continue
JSON.stringify(apply(ready, { type: "claimRequested", emissionId: "some-other-emission" }))
=> {"refused":"emission-mismatch"}
```

A claim once handoff is no longer `open` (already claimed by a different flow,
or the client fell back) is refused:

```ts continue
JSON.stringify(apply(claimed, { type: "claimRequested", emissionId: "some-other-emission" }))
=> {"refused":"invalid-handoff-state"}
```

## `fallBackRequested`: fellBack if not ready, claimed+result if the race is already won

Falling back before HQ is ready moves to `fellBack`, which is terminal — a
later HQ result stays on the box and is never delivered as a message:

```ts continue
const fellBack = apply(started, { type: "fallBackRequested", emissionId: "emission-1" });
JSON.stringify(fellBack.handoff)
=> {"mode":"fellBack","emissionId":"emission-1"}
```

A repeat fallback by the same emission is idempotent (a lost response and a
retry), and the HQ job finishing afterwards leaves the handoff alone:

```ts continue
const fellBackAgain = nextVoiceState(fellBack, { type: "fallBackRequested", emissionId: "emission-1" });
JSON.stringify({ ok: fellBackAgain.ok, unchanged: fellBackAgain.ok && fellBackAgain.value === fellBack })
=> {"ok":true,"unchanged":true}

JSON.stringify(apply(fellBack, { type: "allPiecesDone", result: ready.hq.result }).handoff)
=> {"mode":"fellBack","emissionId":"emission-1"}
```

The claim/fall-back race: if HQ becomes ready before the client's fallback
call lands, fallback answers `claimed` with the result instead — the client
sends HQ text after all:

```ts continue
const wonByHq = apply(ready, { type: "fallBackRequested", emissionId: "emission-1" });
JSON.stringify({ handoff: wonByHq.handoff, hq: wonByHq.hq })
=> {"handoff":{"mode":"claimed","emissionId":"emission-1"},"hq":{"state":"ready","result":{"text":"hello world","diarized":true,"service":"mai-diarized","pieces":2}}}
```

The other direction of the race: once the client has fallen back, a claim
for the same emission is refused rather than silently switching horses — the
client already sent realtime text:

```ts continue
JSON.stringify(apply(fellBack, { type: "claimRequested", emissionId: "emission-1" }))
=> {"refused":"invalid-handoff-state"}
```

A fallback for a different emission than the HQ request's is refused:

```ts continue
JSON.stringify(apply(started, { type: "fallBackRequested", emissionId: "emission-other" }))
=> {"refused":"emission-mismatch"}
```
