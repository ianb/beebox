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

## `fallBackRequested`: late if not ready, claimed+result if the race is already won

Falling back before HQ is ready moves to `late`:

```ts continue
const late = apply(started, { type: "fallBackRequested", emissionId: "emission-1", sessionId: "chat-1" });
JSON.stringify(late.handoff)
=> {"mode":"late","emissionId":"emission-1"}
```

A repeat fallback by the same emission is idempotent:

```ts continue
const lateAgain = nextVoiceState(late, { type: "fallBackRequested", emissionId: "emission-1", sessionId: "chat-1" });
JSON.stringify({ ok: lateAgain.ok, unchanged: lateAgain.ok && lateAgain.value === late })
=> {"ok":true,"unchanged":true}
```

The claim/fall-back race: if HQ becomes ready before the client's fallback
call lands, fallback answers `claimed` with the result instead of `late` — the
client sends HQ text after all:

```ts continue
const wonByHq = apply(ready, { type: "fallBackRequested", emissionId: "emission-1", sessionId: "chat-1" });
JSON.stringify({ handoff: wonByHq.handoff, hq: wonByHq.hq })
=> {"handoff":{"mode":"claimed","emissionId":"emission-1"},"hq":{"state":"ready","result":{"text":"hello world","diarized":true,"service":"mai-diarized","pieces":2}}}
```

The other direction of the race: once the client has already chosen `late`,
a subsequent claim for the same emission is refused rather than silently
switching horses — the client already sent realtime text:

```ts continue
JSON.stringify(apply(late, { type: "claimRequested", emissionId: "emission-1" }))
=> {"refused":"invalid-handoff-state"}
```

## The first message of a new chat: `fallBackRequested` names the session

A recording finalized before its chat had a session carries
`hqRequest.sessionId: null`. The fallback names the session the realtime
message went to, and writes it into `hqRequest` — late delivery needs it:

```ts continue
const unbound = apply(NONE_OPEN, {
  type: "requested", requestedAt: "2026-09-10T18:05:00.000Z", service: "whisper",
  emissionId: "emission-new", sessionId: null,
});
unbound.hqRequest.sessionId
=> null

const named = apply(unbound, { type: "fallBackRequested", emissionId: "emission-new", sessionId: "chat-new" });
JSON.stringify({ handoff: named.handoff, sessionId: named.hqRequest.sessionId })
=> {"handoff":{"mode":"late","emissionId":"emission-new"},"sessionId":"chat-new"}
```

A fallback naming a DIFFERENT session than one already recorded is refused:

```ts continue
const bound = apply(NONE_OPEN, {
  type: "requested", requestedAt: "2026-09-10T18:05:00.000Z", service: "whisper",
  emissionId: "emission-1", sessionId: "chat-1",
});
JSON.stringify(apply(bound, { type: "fallBackRequested", emissionId: "emission-1", sessionId: "chat-other" }))
=> {"refused":"session-mismatch"}
```

A repeat for the same emission is idempotent only from the same chat: after
`late` is recorded for `chat-new`, a stale client naming another chat is
refused rather than told its realtime text will be corrected there.

```ts continue
JSON.stringify(apply(named, { type: "fallBackRequested", emissionId: "emission-new", sessionId: "chat-else" }))
=> {"refused":"session-mismatch"}

nextVoiceState(named, { type: "fallBackRequested", emissionId: "emission-new", sessionId: "chat-new" }).value === named
=> true
```

## `lateDeliveryStarted` and `landedConfirmed`: the correction's own at-most-once send

Late delivery only starts once HQ is ready. Given a `late` handoff whose HQ
result has arrived:

```ts continue
const lateReady = { ...late, hq: ready.hq };
const startedDelivery = apply(lateReady, { type: "lateDeliveryStarted", originalLanded: true });
JSON.stringify(startedDelivery.handoff)
=> {"mode":"delivering","emissionId":"emission-1"}
```

If the original realtime message hasn't landed in the transcript yet, delivery
stays `late` (no send) rather than risk an orphan correction:

```ts continue
const notLandedYet = nextVoiceState(lateReady, { type: "lateDeliveryStarted", originalLanded: false });
JSON.stringify({ ok: notLandedYet.ok, unchanged: notLandedYet.ok && notLandedYet.value === lateReady })
=> {"ok":true,"unchanged":true}
```

A failed HQ result with a `late` handoff never delivers — `lateDeliveryStarted`
requires `hq.state === "ready"`:

```ts continue
const lateFailed = { ...late, hq: { state: "failed", failure: { kind: "permanent", code: "x", message: "x" } } };
JSON.stringify(apply(lateFailed, { type: "lateDeliveryStarted", originalLanded: true }))
=> {"refused":"invalid-hq-state"}
```

Once delivering, `landedConfirmed` finishes the handoff:

```ts continue
const delivered = apply(startedDelivery, { type: "landedConfirmed", messageId: "msg-42" });
JSON.stringify(delivered.handoff)
=> {"mode":"delivered","emissionId":"emission-1","messageId":"msg-42"}
```

A `fallBack` repeat for the same emission stays idempotent even once late
delivery has moved past `late` — a lost HTTP response and a retry can land
after the correction reached `delivering` or `delivered`, and the client is
still asking the same question ("what happened to my fallback?"):

```ts continue
JSON.stringify({
  ok: nextVoiceState(startedDelivery, { type: "fallBackRequested", emissionId: "emission-1", sessionId: "chat-1" }).ok,
  unchanged: nextVoiceState(startedDelivery, { type: "fallBackRequested", emissionId: "emission-1", sessionId: "chat-1" }).value === startedDelivery,
})
=> {"ok":true,"unchanged":true}

JSON.stringify({
  ok: nextVoiceState(delivered, { type: "fallBackRequested", emissionId: "emission-1", sessionId: "chat-1" }).ok,
  unchanged: nextVoiceState(delivered, { type: "fallBackRequested", emissionId: "emission-1", sessionId: "chat-1" }).value === delivered,
})
=> {"ok":true,"unchanged":true}
```

`landedConfirmed` outside `delivering` is refused (nothing to confirm):

```ts continue
JSON.stringify(apply(lateReady, { type: "landedConfirmed", messageId: "msg-42" }))
=> {"refused":"invalid-handoff-state"}
```
