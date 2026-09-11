/**
 * tRPC router for the client half of the voice-recording handoff
 * (`docs/plans/resilient-voice-recording.md`, Track 1's `voiceRecording`
 * router). `status` is the pending bubble's server-derived ground truth;
 * `claim`/`fallBack` are the two ways a client
 * resolves a sealed recording's handoff. Both mutations apply one
 * {@link VoiceEvent} through {@link applyVoiceEvent} (already idempotent by
 * `(recordingId, emissionId)` — see `state.ts`), so a retried call is a safe
 * replay; this router adds no side effect beyond that one write.
 *
 * Owner check mirrors `authorizeCaptureSessionOwner` (`webapp/capture-request-owner.ts`):
 * the caller's authenticated email must match the session's `createdBy`.
 * `ctx.user` is cookie/hub identity only — unlike the raw capture routes, the
 * tRPC context does not yet resolve a mobile bearer's identity into `ctx.user`
 * (`webapp/server-box-scope.ts` folds mobile auth only into `ctx.authed`), so a
 * mobile-authenticated caller reads here as `createdBy: null`. That parity gap
 * is pre-existing (not introduced here) and is Track 6's problem to close when
 * the native app starts calling this router.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "../trpc.js";
import {
  readStagingSession,
  isVoiceSession,
  type StagingSession,
  type StagingVoice,
  type VoiceHqState,
  type VoiceHandoff,
  type HqFailure,
  type VoiceHqResult,
} from "../../../core/capture/staging-store.js";
import { applyVoiceEvent, VoiceTransitionRefusedError } from "../../../core/voice-recording/voice-staging.js";
import { toError } from "../../../lib/error-guards.js";
import type { TrpcContext } from "../context.js";

/** The DTO `status` returns. */
interface VoiceStatusDto {
  recordingId: string;
  hq: VoiceHqState;
  handoff: VoiceHandoff;
  sealed: boolean;
  /** The HQ service the request resolved to, once HQ was requested (names a failure notice). */
  service: string | null;
}

/** A staging session known to be voice-kind — narrows `voice` off its optional declaration. */
interface VoiceStagingSession extends StagingSession {
  voice: StagingVoice;
}

function isVoiceStagingSession(session: StagingSession): session is VoiceStagingSession {
  return isVoiceSession(session) && session.voice !== undefined;
}

function toDto(session: VoiceStagingSession): VoiceStatusDto {
  return {
    recordingId: session.id,
    hq: session.voice.hq,
    handoff: session.voice.handoff,
    sealed: session.voice.sealedAt !== undefined,
    service: session.voice.hqRequest?.service ?? null,
  };
}

/** True once a voice session is loaded and its `createdBy` matches this caller. */
function isOwnedByCaller(session: StagingSession, ctx: TrpcContext): boolean {
  return session.createdBy === (ctx.user?.email ?? null);
}

async function loadOwnedVoiceSession(opts: {
  ctx: TrpcContext;
  recordingId: string;
}): Promise<VoiceStagingSession | null> {
  const { ctx, recordingId } = opts;
  const session = await readStagingSession({ boxRoot: ctx.boxRoot, id: recordingId });
  if (session === null || !isVoiceStagingSession(session) || !isOwnedByCaller(session, ctx)) return null;
  return session;
}

type ClaimOutcome =
  | { outcome: "claimed"; result: VoiceHqResult }
  | { outcome: "pending"; hq: VoiceHqState }
  | { outcome: "failed"; failure: HqFailure };

type FallBackOutcome =
  | { outcome: "claimed"; result: VoiceHqResult }
  | { outcome: "fellBack" }
  | { outcome: "failed"; failure: HqFailure };

/**
 * After a claim/fallBack event applies, classify the resulting voice object
 * into the outcome shape both mutations share. `fellBack` is reachable only
 * from `fallBack` (`applyClaimRequested` never produces it), `pending` only
 * from `claim` (a fallback always decides the handoff).
 */
function classifyHandoffOutcome(voice: StagingVoice): ClaimOutcome | FallBackOutcome {
  if (voice.hq.state === "failed") return { outcome: "failed", failure: voice.hq.failure };
  if (voice.handoff.mode === "claimed" && voice.hq.state === "ready") {
    return { outcome: "claimed", result: voice.hq.result };
  }
  if (voice.handoff.mode === "fellBack") return { outcome: "fellBack" };
  return { outcome: "pending", hq: voice.hq };
}

function throwRefusalAsConflict(error: unknown): never {
  if (error instanceof VoiceTransitionRefusedError) {
    throw new TRPCError({ code: "CONFLICT", message: error.refusal.message, cause: error });
  }
  throw toError(error);
}

export const voiceRecordingRouter = router({
  status: authedProcedure
    .input(z.object({ recordingId: z.string().min(1) }))
    .query(async ({ ctx, input }): Promise<VoiceStatusDto> => {
      const session = await loadOwnedVoiceSession({ ctx, recordingId: input.recordingId });
      if (session === null) {
        throw new TRPCError({ code: "NOT_FOUND", message: "No such voice recording" });
      }
      return toDto(session);
    }),

  claim: authedProcedure
    .input(z.object({ recordingId: z.string().min(1), emissionId: z.string().min(1) }))
    .mutation(async ({ ctx, input }): Promise<ClaimOutcome> => {
      const session = await loadOwnedVoiceSession({ ctx, recordingId: input.recordingId });
      if (session === null) {
        throw new TRPCError({ code: "NOT_FOUND", message: "No such voice recording" });
      }
      let voice: StagingVoice;
      try {
        voice = await applyVoiceEvent({
          boxRoot: ctx.boxRoot,
          id: input.recordingId,
          event: { type: "claimRequested", emissionId: input.emissionId },
        });
      } catch (error) {
        throwRefusalAsConflict(error);
      }
      const outcome = classifyHandoffOutcome(voice);
      // `classifyHandoffOutcome` is shared with fallBack, whose union includes
      // "fellBack" — `applyClaimRequested` never produces that handoff.
      if (outcome.outcome === "fellBack") {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "claim produced an unexpected fellBack handoff" });
      }
      return outcome;
    }),

  /**
   * The client sends realtime text instead of HQ. Answers `claimed` when HQ
   * was ready after all (the client sends the HQ text), `failed` when the HQ
   * pass failed for good, else `fellBack`.
   */
  fallBack: authedProcedure
    .input(z.object({ recordingId: z.string().min(1), emissionId: z.string().min(1) }))
    .mutation(async ({ ctx, input }): Promise<FallBackOutcome> => {
      const session = await loadOwnedVoiceSession({ ctx, recordingId: input.recordingId });
      if (session === null) {
        throw new TRPCError({ code: "NOT_FOUND", message: "No such voice recording" });
      }
      let voice: StagingVoice;
      try {
        voice = await applyVoiceEvent({
          boxRoot: ctx.boxRoot,
          id: input.recordingId,
          event: { type: "fallBackRequested", emissionId: input.emissionId },
        });
      } catch (error) {
        throwRefusalAsConflict(error);
      }
      const outcome = classifyHandoffOutcome(voice);
      if (outcome.outcome === "pending") {
        // `applyFallBackRequested` never leaves a `pending`-shaped handoff — it
        // only produces `claimed` (HQ beat the fallback) or `fellBack`.
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "fallBack produced an unexpected pending state" });
      }
      return outcome;
    }),
});
