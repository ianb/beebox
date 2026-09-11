/**
 * Pure state machine for one voice recording's HQ pass and handoff
 * (`docs/plans/resilient-voice-recording.md`, Track 1). `nextVoiceState`
 * takes the manifest's current `voice` object plus one event and returns
 * either the next `voice` object (unchanged, for an idempotent no-op) or a
 * typed refusal for an event that doesn't apply from the current state. All
 * IO — persisting the result, deciding retry timing —
 * belongs to the job/route layer (later chunks); this module only decides
 * what the next state IS.
 */

import { err, ok, type Result } from "../../lib/result.js";
import { assertNever } from "../../lib/invariant.js";
import type { HqTranscriptionService } from "../../shared/transcription-services.js";
import type { HqFailure, StagingVoice, VoiceHqResult } from "../capture/staging-schema.js";
import type { HqErrorClassification } from "./classify.js";

export type VoiceEvent =
  /**
   * A finalize that asks for HQ. Only fires the request once per recording.
   * `sessionId` is null for the first message of a new chat.
   */
  | { type: "requested"; requestedAt: string; service: HqTranscriptionService; emissionId: string; sessionId: string | null }
  /** The job started transcribing one piece. */
  | { type: "pieceStarted"; piece: number; pieces: number; attempt: number; pieceSeconds: number }
  /**
   * One piece attempt failed. `pieceSeconds` is the length to use on the next
   * attempt — already halved by the job (via `nextPieceSeconds`) when
   * `classification` is `"piece-too-long"`; unchanged for `"transient"`.
   * `classification: "permanent"` is also what the job reports once halving
   * would cross the floor (`nextPieceSeconds` returned `null`) — there is no
   * further piece-too-long retry to represent here.
   */
  | {
      type: "pieceFailed";
      classification: HqErrorClassification;
      pieceSeconds: number;
      attempt: number;
      nextAttemptAt: string;
      failure: Omit<HqFailure, "kind">;
    }
  /** Every piece transcribed and joined. */
  | { type: "allPiecesDone"; result: VoiceHqResult }
  /** 24h since `hqRequest.requestedAt` elapsed with no result. */
  | { type: "expired" }
  /** The client wants to send the HQ text. */
  | { type: "claimRequested"; emissionId: string }
  /**
   * The client is sending realtime text instead (budget expired, by choice,
   * or HQ failed). Terminal for the handoff: the HQ result, if it comes,
   * stays on the box for `get-last-audio` / `bbx chat retranscribe`.
   */
  | { type: "fallBackRequested"; emissionId: string };

export interface VoiceTransitionRefusal {
  code: "emission-mismatch" | "invalid-handoff-state" | "invalid-hq-state";
  message: string;
}

export type VoiceTransitionOutcome = Result<StagingVoice, VoiceTransitionRefusal>;

/**
 * Apply one event to a `voice` manifest object, returning the next object (or
 * the same object, unchanged, for an idempotent no-op) or a typed refusal.
 * Exhaustive over {@link VoiceEvent}; a new event member fails to compile here.
 */
export function nextVoiceState(voice: StagingVoice, event: VoiceEvent): VoiceTransitionOutcome {
  switch (event.type) {
    case "requested":
      return applyRequested(voice, event);
    case "pieceStarted":
      return applyPieceStarted(voice, event);
    case "pieceFailed":
      return applyPieceFailed(voice, event);
    case "allPiecesDone":
      return applyAllPiecesDone(voice, event);
    case "expired":
      return applyExpired(voice);
    case "claimRequested":
      return applyClaimRequested(voice, event);
    case "fallBackRequested":
      return applyFallBackRequested(voice, event);
    default:
      return assertNever(event);
  }
}

function applyRequested(
  voice: StagingVoice,
  event: Extract<VoiceEvent, { type: "requested" }>,
): VoiceTransitionOutcome {
  if (voice.hq.state === "none") {
    return ok({
      ...voice,
      hqRequest: {
        requestedAt: event.requestedAt,
        service: event.service,
        emissionId: event.emissionId,
        sessionId: event.sessionId,
      },
      hq: { state: "queued" },
    });
  }
  if (voice.hqRequest?.emissionId === event.emissionId) {
    return ok(voice); // idempotent repeat of the same request
  }
  return err({
    code: "emission-mismatch",
    message: "HQ was already requested for this recording under a different emission",
  });
}

/** In-progress HQ states — the only ones a job-progress event may advance from. */
function isHqInProgress(voice: StagingVoice): boolean {
  return voice.hq.state === "queued" || voice.hq.state === "transcribing" || voice.hq.state === "retrying";
}

function applyPieceStarted(
  voice: StagingVoice,
  event: Extract<VoiceEvent, { type: "pieceStarted" }>,
): VoiceTransitionOutcome {
  if (!isHqInProgress(voice)) {
    return err({ code: "invalid-hq-state", message: `pieceStarted is not valid from hq state ${voice.hq.state}` });
  }
  return ok({
    ...voice,
    hq: { state: "transcribing", piece: event.piece, pieces: event.pieces, attempt: event.attempt, pieceSeconds: event.pieceSeconds },
  });
}

function applyPieceFailed(
  voice: StagingVoice,
  event: Extract<VoiceEvent, { type: "pieceFailed" }>,
): VoiceTransitionOutcome {
  if (!isHqInProgress(voice)) {
    return err({ code: "invalid-hq-state", message: `pieceFailed is not valid from hq state ${voice.hq.state}` });
  }
  if (event.classification === "permanent") {
    return ok({ ...voice, hq: { state: "failed", failure: { ...event.failure, kind: "permanent" } } });
  }
  // "transient" and "piece-too-long" both mean "retry" — the job has already
  // decided (and passed in) the piece length for the next attempt.
  return ok({
    ...voice,
    hq: {
      state: "retrying",
      attempt: event.attempt,
      nextAttemptAt: event.nextAttemptAt,
      pieceSeconds: event.pieceSeconds,
      failure: { ...event.failure, kind: "transient" },
    },
  });
}

function applyAllPiecesDone(
  voice: StagingVoice,
  event: Extract<VoiceEvent, { type: "allPiecesDone" }>,
): VoiceTransitionOutcome {
  if (!isHqInProgress(voice)) {
    return err({ code: "invalid-hq-state", message: `allPiecesDone is not valid from hq state ${voice.hq.state}` });
  }
  return ok({ ...voice, hq: { state: "ready", result: event.result } });
}

function applyExpired(voice: StagingVoice): VoiceTransitionOutcome {
  if (!isHqInProgress(voice)) {
    return ok(voice); // already terminal (or never requested) — idempotent no-op
  }
  const priorFailure = voice.hq.state === "retrying" ? voice.hq.failure : undefined;
  const failure: HqFailure = priorFailure
    ? { ...priorFailure, kind: "exhausted" }
    : { kind: "exhausted", code: "hq_retry_exhausted", message: "HQ transcription retry window elapsed" };
  return ok({ ...voice, hq: { state: "failed", failure } });
}

function applyClaimRequested(
  voice: StagingVoice,
  event: Extract<VoiceEvent, { type: "claimRequested" }>,
): VoiceTransitionOutcome {
  if (voice.handoff.mode === "claimed" && voice.handoff.emissionId === event.emissionId) {
    return ok(voice); // idempotent repeat
  }
  if (voice.handoff.mode !== "open") {
    return err({ code: "invalid-handoff-state", message: `cannot claim from handoff mode ${voice.handoff.mode}` });
  }
  if (voice.hqRequest?.emissionId !== event.emissionId) {
    return err({ code: "emission-mismatch", message: "claim emissionId does not match the recording's HQ request" });
  }
  if (voice.hq.state !== "ready") {
    return ok(voice); // not ready yet — no transition; caller reads status from voice.hq
  }
  return ok({ ...voice, handoff: { mode: "claimed", emissionId: event.emissionId } });
}

function applyFallBackRequested(
  voice: StagingVoice,
  event: Extract<VoiceEvent, { type: "fallBackRequested" }>,
): VoiceTransitionOutcome {
  if (voice.handoff.mode !== "open") {
    // A client's `fallBack` response can be lost in transit and retried; a
    // repeat for the same emission answers from whichever mode it reached.
    if (voice.handoff.emissionId === event.emissionId) {
      return ok(voice); // idempotent repeat
    }
    return err({ code: "invalid-handoff-state", message: `cannot fall back from handoff mode ${voice.handoff.mode}` });
  }
  if (voice.hqRequest?.emissionId !== event.emissionId) {
    return err({ code: "emission-mismatch", message: "fallback emissionId does not match the recording's HQ request" });
  }
  if (voice.hq.state === "ready") {
    // HQ beat the fallback: the client uses HQ text after all.
    return ok({ ...voice, handoff: { mode: "claimed", emissionId: event.emissionId } });
  }
  return ok({ ...voice, handoff: { mode: "fellBack", emissionId: event.emissionId } });
}
