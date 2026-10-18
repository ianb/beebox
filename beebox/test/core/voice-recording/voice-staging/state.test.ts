// # Voice recording HQ state machine
//
// `nextVoiceState(voice, event)` is the pure transition function over one
// recording's `hq` progress and `handoff` decision
// (`docs/plans/resilient-voice-recording.md`, Track 1). It returns the next
// `voice` object, the SAME object unchanged for an idempotent no-op, or a typed
// refusal for an event that doesn't apply from the current state.

import { test } from "tap";
import "agent-doctest/tap";
import { nextVoiceState } from "../../../../src/core/voice-recording/voice-staging/state.js";
import type { VoiceEvent } from "../../../../src/core/voice-recording/voice-staging/state.js";
import type { StagingVoice } from "../../../../src/core/capture/staging-schema.js";
import { invariant } from "../../../../src/shared/invariant.js";

const NONE_OPEN: StagingVoice = { targetSessionId: "chat-1", startedAt: "2026-09-10T18:00:00.000Z", hq: { state: "none" }, handoff: { mode: "open" } };

function apply(voice: StagingVoice, event: VoiceEvent) {
  const result = nextVoiceState(voice, event);
  return result.ok ? result.value : { refused: result.error.code };
}
/** The next voice for an event that must apply. */
function applied(voice: StagingVoice, event: VoiceEvent): StagingVoice {
  const result = nextVoiceState(voice, event);
  invariant(result.ok, "event applies from this state");
  return result.value;
}

// ## `requested`: none → queued, writes `hqRequest`
void test("`requested`: none → queued, writes `hqRequest`", async (t) => {
  // The states the sections below build on, each one transition past the last.
  const REQUESTED = applied(NONE_OPEN, {
    type: "requested", requestedAt: "2026-09-10T18:05:00.000Z", service: "mai-diarized",
    emissionId: "emission-1", sessionId: "chat-1",
  });
  const STARTED = applied(REQUESTED, { type: "pieceStarted", piece: 1, pieces: 2, attempt: 1, pieceSeconds: 300 });
  const READY = applied(STARTED, {
    type: "allPiecesDone", result: { text: "hello world", diarized: true, service: "mai-diarized", pieces: 2 },
  });

  // doctest:L32
  t.check(REQUESTED, { targetSessionId: "chat-1", startedAt: "2026-09-10T18:00:00.000Z", hq: { state: "queued" }, handoff: { mode: "open" }, hqRequest: { requestedAt: "2026-09-10T18:05:00.000Z", service: "mai-diarized", emissionId: "emission-1", sessionId: "chat-1" } });

  // A repeat with the SAME emission is a no-op (same object back):

  // doctest:L43
  const repeat = nextVoiceState(REQUESTED, {
    type: "requested", requestedAt: "2026-09-10T18:06:00.000Z", service: "mai-diarized",
    emissionId: "emission-1", sessionId: "chat-1",
  });
  t.check({ ok: repeat.ok, unchanged: repeat.ok && repeat.value === REQUESTED }, { ok: true, unchanged: true });

  // A DIFFERENT emission is refused — the request already belongs to another send:

  // doctest:L54
  t.check(
    apply(REQUESTED, {
      type: "requested", requestedAt: "2026-09-10T18:07:00.000Z", service: "mai-diarized",
      emissionId: "emission-2", sessionId: "chat-1",
    }),
    { refused: "emission-mismatch" },
  );

  // ## Job progress: pieceStarted, pieceFailed, allPiecesDone, expired

  // doctest:L64
  t.check(STARTED.hq, { state: "transcribing", piece: 1, pieces: 2, attempt: 1, pieceSeconds: 300 });

  // A transient failure moves to `retrying`, keeping the piece length:

  // doctest:L72
  const transientFail = applied(STARTED, {
    type: "pieceFailed", classification: "transient", pieceSeconds: 300, attempt: 1,
    nextAttemptAt: "2026-09-10T18:10:00.000Z",
    failure: { code: "http_502", message: "Bad Gateway" },
  });
  t.check(transientFail.hq, { state: "retrying", attempt: 1, nextAttemptAt: "2026-09-10T18:10:00.000Z", pieceSeconds: 300, failure: { code: "http_502", message: "Bad Gateway", kind: "transient" } });

  // `piece-too-long` also moves to `retrying`, with the job's already-halved
  // piece length:

  // doctest:L85
  const halved = applied(STARTED, {
    type: "pieceFailed", classification: "piece-too-long", pieceSeconds: 150, attempt: 1,
    nextAttemptAt: "2026-09-10T18:10:00.000Z",
    failure: { code: "http_408", message: "Timeout" },
  });
  t.check(halved.hq, { state: "retrying", attempt: 1, nextAttemptAt: "2026-09-10T18:10:00.000Z", pieceSeconds: 150, failure: { code: "http_408", message: "Timeout", kind: "transient" } });

  // A permanent failure is terminal:

  // doctest:L97
  const permFail = applied(STARTED, {
    type: "pieceFailed", classification: "permanent", pieceSeconds: 300, attempt: 1,
    nextAttemptAt: "2026-09-10T18:10:00.000Z",
    failure: { code: "missing_openrouter_key", message: "no key" },
  });
  t.check(permFail.hq, { state: "failed", failure: { code: "missing_openrouter_key", message: "no key", kind: "permanent" } });

  // Every piece done → `ready`:

  // doctest:L109
  t.check(READY.hq, { state: "ready", result: { text: "hello world", diarized: true, service: "mai-diarized", pieces: 2 } });

  // A job-progress event from a state it doesn't apply to (e.g. `pieceStarted`
  // before any request) is refused:

  // doctest:L120
  t.check(apply(NONE_OPEN, { type: "pieceStarted", piece: 1, pieces: 1, attempt: 1, pieceSeconds: 300 }), { refused: "invalid-hq-state" });

  // ## `expired`: 24h with no result → failed exhausted
  //
  // Expiring a `retrying` state preserves the failure's code/message but marks it exhausted:

  // doctest:L129
  const expired = applied(transientFail, { type: "expired" });
  t.check(expired.hq, { state: "failed", failure: { code: "http_502", message: "Bad Gateway", kind: "exhausted" } });

  // Expiring from `queued` (no prior failure recorded yet) still terminates, with a generic message:

  // doctest:L137
  const expiredFromQueued = applied(REQUESTED, { type: "expired" });
  t.check(expiredFromQueued.hq, { state: "failed", failure: { kind: "exhausted", code: "hq_retry_exhausted", message: "HQ transcription retry window elapsed" } });

  // Expiring an already-terminal or never-requested voice is an idempotent no-op:

  // doctest:L145
  const expiredAlreadyReady = nextVoiceState(READY, { type: "expired" });
  t.check({ ok: expiredAlreadyReady.ok, unchanged: expiredAlreadyReady.ok && expiredAlreadyReady.value === READY }, { ok: true, unchanged: true });

  // doctest:L149
  const expiredNever = nextVoiceState(NONE_OPEN, { type: "expired" });
  t.check({ ok: expiredNever.ok, unchanged: expiredNever.ok && expiredNever.value === NONE_OPEN }, { ok: true, unchanged: true });

  // ## `claimRequested`: only from `open`, only once `ready`, idempotent
  //
  // Claiming before the result is ready is a no-op — the caller reads the current
  // status from the returned (unchanged) `voice.hq`:

  // doctest:L160
  const notYet = nextVoiceState(STARTED, { type: "claimRequested", emissionId: "emission-1" });
  t.check({ ok: notYet.ok, unchanged: notYet.ok && notYet.value === STARTED, hqState: notYet.ok && notYet.value.hq.state }, { ok: true, unchanged: true, hqState: "transcribing" });

  // ## Claim and fallback: the handoff races the HQ result

  // Claiming once ready transitions the handoff to `claimed`:

  // doctest:L168
  const claimed = applied(READY, { type: "claimRequested", emissionId: "emission-1" });
  t.check(claimed.handoff, { mode: "claimed", emissionId: "emission-1" });

  // A repeat claim by the SAME emission is idempotent:

  // doctest:L176
  const claimAgain = nextVoiceState(claimed, { type: "claimRequested", emissionId: "emission-1" });
  t.check({ ok: claimAgain.ok, unchanged: claimAgain.ok && claimAgain.value === claimed }, { ok: true, unchanged: true });

  // A claim naming the wrong emission is refused:

  // doctest:L184
  t.check(apply(READY, { type: "claimRequested", emissionId: "some-other-emission" }), { refused: "emission-mismatch" });

  // A claim once handoff is no longer `open` (already claimed by a different flow,
  // or the client fell back) is refused:

  // doctest:L192
  t.check(apply(claimed, { type: "claimRequested", emissionId: "some-other-emission" }), { refused: "invalid-handoff-state" });

  // ## `fallBackRequested`: fellBack if not ready, claimed+result if the race is already won
  //
  // Falling back before HQ is ready moves to `fellBack`, which is terminal — a
  // later HQ result stays on the box and is never delivered as a message:

  // doctest:L202
  const fellBack = applied(STARTED, { type: "fallBackRequested", emissionId: "emission-1" });
  t.check(fellBack.handoff, { mode: "fellBack", emissionId: "emission-1" });

  // A repeat fallback by the same emission is idempotent (a lost response and a
  // retry), and the HQ job finishing afterwards leaves the handoff alone:

  // doctest:L211
  const fellBackAgain = nextVoiceState(fellBack, { type: "fallBackRequested", emissionId: "emission-1" });
  t.check({ ok: fellBackAgain.ok, unchanged: fellBackAgain.ok && fellBackAgain.value === fellBack }, { ok: true, unchanged: true });

  // doctest:L215
  invariant(READY.hq.state === "ready", "ready recording carries its result");
  t.check(applied(fellBack, { type: "allPiecesDone", result: READY.hq.result }).handoff, { mode: "fellBack", emissionId: "emission-1" });

  // The claim/fall-back race: if HQ becomes ready before the client's fallback
  // call lands, fallback answers `claimed` with the result instead — the client
  // sends HQ text after all:

  // doctest:L225
  const wonByHq = applied(READY, { type: "fallBackRequested", emissionId: "emission-1" });
  t.check({ handoff: wonByHq.handoff, hq: wonByHq.hq }, { handoff: { mode: "claimed", emissionId: "emission-1" }, hq: { state: "ready", result: { text: "hello world", diarized: true, service: "mai-diarized", pieces: 2 } } });

  // The other direction of the race: once the client has fallen back, a claim
  // for the same emission is refused rather than silently switching horses — the
  // client already sent realtime text:

  // doctest:L235
  t.check(apply(fellBack, { type: "claimRequested", emissionId: "emission-1" }), { refused: "invalid-handoff-state" });

  // A fallback for a different emission than the HQ request's is refused:

  // doctest:L242
  t.check(apply(STARTED, { type: "fallBackRequested", emissionId: "emission-other" }), { refused: "emission-mismatch" });
});
