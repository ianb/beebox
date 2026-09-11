/**
 * tRPC router for the client half of the voice-recording handoff
 * (`docs/plans/resilient-voice-recording.md`, Track 1's `voiceRecording`
 * router). `status`/`statusByMessage` are the pending-bubble/badge's
 * server-derived ground truth; `claim`/`fallBack` are the two ways a client
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
  listStagingSessions,
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

/** The DTO both `status` and `statusByMessage` return. */
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
  | { outcome: "late" }
  | { outcome: "failed"; failure: HqFailure };

/**
 * After a claim/fallBack event applies, classify the resulting voice object
 * into the outcome shape both mutations share. `delivering`/`delivered` are
 * reachable ONLY from a `fallBack` repeat whose earlier `late` outcome
 * already reached the client, or whose response was lost and late delivery
 * advanced before the retry arrived (`state.ts`'s `applyFallBackRequested`
 * treats all four non-open modes as an idempotent repeat) — from the
 * caller's perspective both mean the same thing "late" did: realtime text
 * stands, and a correction is (or already was) delivered separately.
 */
function classifyHandoffOutcome(voice: StagingVoice): ClaimOutcome | FallBackOutcome {
  if (voice.hq.state === "failed") return { outcome: "failed", failure: voice.hq.failure };
  if (voice.handoff.mode === "claimed" && voice.hq.state === "ready") {
    return { outcome: "claimed", result: voice.hq.result };
  }
  if (voice.handoff.mode === "late" || voice.handoff.mode === "delivering" || voice.handoff.mode === "delivered") {
    return { outcome: "late" };
  }
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

  statusByMessage: authedProcedure
    .input(z.object({ messageId: z.string().min(1) }))
    .query(async ({ ctx, input }): Promise<VoiceStatusDto | null> => {
      const sessions = (await listStagingSessions({ boxRoot: ctx.boxRoot })).filter(isVoiceStagingSession);
      const match = sessions.find((session) => {
        if (!isOwnedByCaller(session, ctx)) return false;
        if (session.id === input.messageId) return true;
        const { hqRequest, handoff } = session.voice;
        if (hqRequest?.emissionId === input.messageId) return true;
        return "emissionId" in handoff && handoff.emissionId === input.messageId;
      });
      return match === undefined ? null : toDto(match);
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
      // "late" — claim's transition function (`applyClaimRequested`) never
      // produces a `late` handoff, so this branch is unreachable from here.
      if (outcome.outcome === "late") {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "claim produced an unexpected late handoff" });
      }
      return outcome;
    }),

  /**
   * `sessionId` is the chat the realtime message was sent to. It fills in a
   * null `hqRequest.sessionId` (the first message of a new chat), which late
   * delivery needs; a different non-null session is a CONFLICT.
   */
  fallBack: authedProcedure
    .input(z.object({ recordingId: z.string().min(1), emissionId: z.string().min(1), sessionId: z.string().min(1) }))
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
          event: { type: "fallBackRequested", emissionId: input.emissionId, sessionId: input.sessionId },
        });
      } catch (error) {
        throwRefusalAsConflict(error);
      }
      const outcome = classifyHandoffOutcome(voice);
      if (outcome.outcome === "pending") {
        // `applyFallBackRequested` never leaves a `pending`-shaped handoff — it
        // only produces `claimed` (HQ beat the fallback) or `late`.
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "fallBack produced an unexpected pending state" });
      }
      return outcome;
    }),
});
