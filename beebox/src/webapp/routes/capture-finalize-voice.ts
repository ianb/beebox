/**
 * `POST /api/capture/sessions/:id/finalize` — the voice-recording branch
 * (`docs/plans/resilient-voice-recording.md`, Track 1). Split out of
 * `capture.ts` to keep its route-registration function under the line budget,
 * mirroring `capture-create.ts`.
 *
 * A voice finalize body is `{ chunkCount, hq: null | { emissionId, sessionId } }`;
 * `sessionId` is null for the first message of a new chat (the session is
 * assigned after the send).
 * Before sealing, it verifies the manifest's staged chunks are EXACTLY
 * `pcm-000001.raw … pcm-<chunkCount>.raw` — uploads are refused once the
 * session isn't `open`, so a chunk that arrives after the seal is lost for
 * good, and finalizing over a gap would silently transcribe a recording
 * missing a piece of itself. A gap answers 409 `missing-chunks` and does not
 * seal. Finalize is idempotent: a repeat once sealed returns the current
 * state (200); a repeat with a different `hq.emissionId` is refused (409).
 */

import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { EventBus } from "../../core/event-bus.js";
import { pcmChunkFilename } from "../../core/capture/audio-format.js";
import { loadTranscriptionConfig } from "../../core/transcription/index.js";
import { getBoxTimeISO } from "../../lib/time.js";
import type { StagingSession } from "../../core/capture/staging-store.js";
import { sealVoiceSession, VoiceTransitionRefusedError } from "../../core/voice-recording/voice-staging.js";
import { runHqJob } from "../../core/voice-recording/hq-job.js";

const VoiceFinalizeBodySchema = z.object({
  chunkCount: z.number().int().nonnegative(),
  hq: z.object({ emissionId: z.string().min(1), sessionId: z.string().min(1).nullable() }).nullable(),
});

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
  const { chunkCount, hq } = parsedBody.data;

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

  const hqRequest =
    hq === null
      ? null
      : {
          emissionId: hq.emissionId,
          sessionId: hq.sessionId,
          service: (await loadTranscriptionConfig(boxRoot)).hqService,
          requestedAt: getBoxTimeISO(boxRoot),
        };

  let seal;
  try {
    seal = await sealVoiceSession({ boxRoot, id: session.id, hq: hqRequest });
  } catch (error) {
    if (error instanceof VoiceTransitionRefusedError) {
      return reply.status(409).send({ error: error.message, code: error.refusal.code });
    }
    throw error;
  }

  if (seal.sealed && hqRequest !== null) {
    void runHqJob({ boxRoot, id: session.id, eventBus }).catch((error: unknown) => {
      console.error(`[voice-recording] HQ job for ${session.id} failed:`, error);
    });
  }

  return { sessionId: session.id, staged: true, hq: seal.voice.hq, handoff: seal.voice.handoff };
}
