/**
 * `POST /api/capture/sessions` — create a new staging session.
 *
 * Also the voice-recording entry point
 * (`docs/plans/resilient-voice-recording.md`): `kind: "voice"` with a
 * client-generated `id` lets the browser start staging before the box
 * confirms the session exists, and a repeat of the same id/kind/owner is
 * idempotent rather than 409ing. Capture sessions (the default) keep
 * server-assigned ids.
 */

import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { createStagingSession, readStagingSession } from "../../core/capture/staging-store.js";
import { resolveCaptureRequestOwner } from "../capture-request-owner.js";

export const CAPTURE_CAPABILITIES = {
  acceptedAudioFormats: ["webm-opus", "m4a-aac"],
  acceptedUploadEncodings: ["raw-body-v1"],
} as const;

/**
 * A client-generated recording id for a voice session. UUID v4 only: the
 * client mints this before the box confirms anything exists, and a
 * predictable/attacker-chosen id would let one user guess and collide with
 * another's in-flight recording.
 */
const VOICE_SESSION_ID_PATTERN = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;
const VoiceSessionIdSchema = z.string().regex(VOICE_SESSION_ID_PATTERN);

const CreateSessionBodySchema = z.object({
  targetSessionId: z.string().nullable().optional(),
  id: z.string().optional(),
  kind: z.literal("voice").optional(),
});

export async function handleCreateCaptureSession(opts: {
  boxRoot: string;
  request: FastifyRequest;
  reply: FastifyReply;
}): Promise<unknown> {
  const { boxRoot, request, reply } = opts;
  const owner = await resolveCaptureRequestOwner({ boxRoot, request });
  if (owner.status === "ownerless-mobile") {
    return reply.status(403).send({
      error: "This paired device predates mobile identity. Re-pair it before using Capture.",
    });
  }
  if (owner.status === "unauthenticated") {
    return reply.status(401).send({ error: "Not authenticated" });
  }
  if (owner.status === "auth-store-unavailable") {
    return reply.status(503).send({ error: "Authentication temporarily unavailable" });
  }

  const parsedBody = CreateSessionBodySchema.safeParse(request.body ?? {});
  if (!parsedBody.success) {
    return reply.status(400).send({ error: "Invalid session-create request" });
  }
  const body = parsedBody.data;

  if (body.kind === "voice") {
    return handleCreateVoiceSession({ boxRoot, reply, body, createdBy: owner.email });
  }

  const targetSessionId = body.targetSessionId ?? null;
  const session = await createStagingSession({ boxRoot, targetSessionId, createdBy: owner.email });
  return { sessionId: session.id, startedAt: session.createdAt, capabilities: CAPTURE_CAPABILITIES };
}

async function handleCreateVoiceSession(opts: {
  boxRoot: string;
  reply: FastifyReply;
  body: z.infer<typeof CreateSessionBodySchema>;
  createdBy: string | null;
}): Promise<unknown> {
  const { boxRoot, reply, body, createdBy } = opts;
  if (!body.targetSessionId) {
    return reply.status(400).send({ error: "targetSessionId is required for a voice session" });
  }
  if (body.id !== undefined && !VoiceSessionIdSchema.safeParse(body.id).success) {
    return reply.status(400).send({ error: "id must be a UUID v4" });
  }
  if (body.id !== undefined) {
    const existing = await readStagingSession({ boxRoot, id: body.id });
    if (existing) {
      if (existing.kind !== "voice" || existing.createdBy !== createdBy) {
        return reply.status(409).send({ error: "Session id already used by a different recording" });
      }
      return { sessionId: existing.id, startedAt: existing.createdAt, capabilities: CAPTURE_CAPABILITIES };
    }
  }
  const session = await createStagingSession({
    boxRoot,
    targetSessionId: body.targetSessionId,
    createdBy,
    kind: "voice",
    ...(body.id !== undefined && { id: body.id }),
  });
  return { sessionId: session.id, startedAt: session.createdAt, capabilities: CAPTURE_CAPABILITIES };
}
