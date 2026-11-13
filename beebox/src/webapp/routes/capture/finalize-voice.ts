/**
 * `POST /api/capture/sessions/:id/finalize` — the voice-recording branch
 * (`docs/implemented-plans/resilient-voice-recording.md`, Track 1). Split out of
 * `capture.ts` to keep its route-registration function under the line budget,
 * mirroring `capture-create.ts`.
 *
 * A voice finalize body is
 * `{ chunkCount, emissionId: string | null, hq: null | { emissionId, sessionId } }`.
 * `emissionId` names the message this recording sealed for, independent of
 * whether HQ was requested — it is null only when the segment produced no
 * message (unconsumed/cancel/unmount seals) — so `get-last-audio`
 * (`staged-audio.ts`) can find a non-HQ send's recording too. When `hq` is
 * given its `emissionId` must equal the top-level one; a mismatch is refused
 * (409) before anything is sealed. `hq.sessionId` is null for the first
 * message of a new chat (the session is assigned after the send).
 * Before sealing, it verifies the manifest's staged chunks are EXACTLY
 * `pcm-000001.raw … pcm-<chunkCount>.raw` — uploads are refused once the
 * session isn't `open`, so a chunk that arrives after the seal is lost for
 * good, and finalizing over a gap would silently transcribe a recording
 * missing a piece of itself. A gap answers 409 `missing-chunks` and does not
 * seal. Finalize is idempotent: a repeat once sealed returns the current
 * state (200); a repeat with a different `hq.emissionId` is refused (409).
 *
 * A call recording (docs/plans/chat-calls.md, Track F) sends `call:
 * { callId, firstAudioAtMs }` and `hq: null`: HQ always runs, with word timing
 * and no emission, since the call fold waits for it rather than a composer.
 */

import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { EventBus } from "../../../core/event-bus/core.js";
import { pcmChunkFilename } from "../../../core/capture/audio-format.js";
import { loadTranscriptionConfig } from "../../../core/transcription/dispatch/core.js";
import { getBoxTimeISO } from "../../../lib/time.js";
import type { StagingSession } from "../../../core/capture/staging-store/core.js";
import type { HqTranscriptionService } from "../../../shared/transcription-services.js";
import { sealVoiceSession, VoiceTransitionRefusedError } from "../../../core/voice-recording/voice-staging/core.js";
import { runHqJob } from "../../../core/voice-recording/hq-job/core.js";
import { withoutBoxWork } from "../../../lib/box-maintenance/admission.js";

/** Exported so a contract test can parse the client's real request-body builder with it. */
export const VoiceFinalizeBodySchema = z.object({
  chunkCount: z.number().int().nonnegative(),
  emissionId: z.string().min(1).nullable(),
  hq: z.object({ emissionId: z.string().min(1), sessionId: z.string().min(1).nullable() }).nullable(),
  call: z.object({ callId: z.string().min(1), firstAudioAtMs: z.number().int().positive() }).optional(),
});
type VoiceFinalizeBody = z.infer<typeof VoiceFinalizeBodySchema>;

/** A call recording needs word timing; the whisper-llm variants never return it. */
function callRecordingService(service: HqTranscriptionService): HqTranscriptionService {
  return service === "whisper-llm" || service === "whisper-llm-mini" ? "whisper" : service;
}

async function hqRequestFor(boxRoot: string, { hq, call }: Pick<VoiceFinalizeBody, "hq" | "call">) {
  if (hq === null && call === undefined) return null;
  const { hqService } = await loadTranscriptionConfig(boxRoot);
  const requestedAt = getBoxTimeISO(boxRoot);
  if (hq === null) return { emissionId: null, sessionId: null, service: callRecordingService(hqService), requestedAt };
  return { emissionId: hq.emissionId, sessionId: hq.sessionId, service: hqService, requestedAt };
}

/** The manifest's staged filenames for this recording's one segment, in upload order. */
function stagedChunkFilenames(session: StagingSession): string[] {
  const segment = session.segments.find((s) => s.id === session.id);
  return segment?.chunks ?? [];
}

function expectedChunkFilenames(chunkCount: number): string[] {
  return Array.from({ length: chunkCount }, (_, i) => pcmChunkFilename(i + 1));
}

function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

export async function handleVoiceFinalize(opts: {
  boxRoot: string;
  session: StagingSession;
  request: FastifyRequest;
  reply: FastifyReply;
  eventBus: EventBus;
}): Promise<unknown> {
  const { boxRoot, session, request, reply, eventBus } = opts;
  const parsedBody = VoiceFinalizeBodySchema.safeParse(request.body ?? {});
  if (!parsedBody.success) {
    return reply.status(400).send({ error: "Invalid voice finalize request" });
  }
  const { chunkCount, emissionId, hq, call } = parsedBody.data;
  if (call !== undefined && hq !== null) {
    return reply.status(400).send({ error: "A call recording carries no hq request" });
  }

  if (hq !== null && hq.emissionId !== emissionId) {
    return reply.status(409).send({
      error: "hq.emissionId does not match the finalize's emissionId",
      code: "emission-mismatch",
    });
  }

  if (session.state === "open") {
    const expected = expectedChunkFilenames(chunkCount);
    const staged = stagedChunkFilenames(session);
    if (!arraysEqual(expected, staged)) {
      return reply.status(409).send({
        error: "Recording is missing chunks; it cannot be sealed",
        code: "missing-chunks",
      });
    }
  }

  const hqRequest = await hqRequestFor(boxRoot, { hq, call });

  let seal;
  try {
    seal = await sealVoiceSession({ boxRoot, id: session.id, emissionId, hq: hqRequest, ...(call !== undefined && { call }) });
  } catch (error) {
    if (error instanceof VoiceTransitionRefusedError) {
      return reply.status(409).send({ error: error.message, code: error.refusal.code });
    }
    throw error;
  }

  if (seal.sealed && hqRequest !== null) {
    // Detached from this request, which releases its admission before the job ends.
    void withoutBoxWork(() => runHqJob({ boxRoot, id: session.id, eventBus })).catch((error: unknown) => {
      console.error(`[voice-recording] HQ job for ${session.id} failed:`, error);
    });
  }

  return { sessionId: session.id, staged: true, hq: seal.voice.hq, handoff: seal.voice.handoff };
}
