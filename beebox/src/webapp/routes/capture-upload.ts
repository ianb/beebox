import type { FastifyReply, FastifyRequest } from "fastify";
import { getBoxTimeISO } from "../../lib/time.js";
import {
  addAudioChunk,
  addFile,
  addPhoto,
  readStagingSession,
  resolveStagedFile,
  type StagingSession,
} from "../../core/capture/staging-store.js";
import {
  StagingPathError,
  StagingSessionNotOpenError,
  StagingUploadReplayConflictError,
} from "../../core/capture/staging-errors.js";
import {
  CaptureAudioFormatSchema,
  isCaptureAudioFormatError,
} from "../../core/capture/audio-format.js";
import { isStagingLimitError } from "../../core/capture/staging-limits.js";
import { authorizeCaptureSessionOwner } from "../capture-request-owner.js";

type UploadKind = "audio" | "photo" | "file";
type CaptureUploadRequest = FastifyRequest<{ Params: { id: string } }>;

const UPLOAD_KIND_SET = new Set<string>(["audio", "photo", "file"]);

function isUploadKind(value: string): value is UploadKind {
  return UPLOAD_KIND_SET.has(value);
}

async function readUploadBuffer(request: FastifyRequest): Promise<Buffer | null> {
  if (request.isMultipart()) {
    const file = await request.file();
    if (file) return file.toBuffer();
  }
  return request.body instanceof Buffer ? request.body : null;
}

/** Either the stage succeeded, or the route should answer with this status/error. */
type StageAudioResult = { ok: true } | { ok: false; status: number; error: string };

/**
 * The `audio` upload-kind branch, split out to keep `handleCaptureUpload`'s
 * complexity in budget. `pcm-s16le-16k` is the voice-recording format
 * (`docs/plans/resilient-voice-recording.md`) — a capture session staging it
 * would hand a capture card's write path raw PCM it never learned to
 * concatenate/convert, so it is refused on any session that isn't `voice`.
 */
async function stageAudioUpload(opts: {
  boxRoot: string;
  session: StagingSession;
  segmentId: string | undefined;
  audioFormatHeader: string | undefined;
  segmentStartedAtHeader: string | undefined;
  startedAt: string;
  filename: string;
  buffer: Buffer;
}): Promise<StageAudioResult> {
  const { boxRoot, session, segmentId, audioFormatHeader, segmentStartedAtHeader, startedAt, filename, buffer } = opts;
  if (!segmentId) return { ok: false, status: 400, error: "X-Capture-Segment-Id required for audio" };
  const formatResult = CaptureAudioFormatSchema.safeParse(audioFormatHeader ?? "webm-opus");
  if (!formatResult.success) return { ok: false, status: 400, error: "Unsupported X-Capture-Audio-Format" };
  if (formatResult.data === "pcm-s16le-16k" && session.kind !== "voice") {
    return { ok: false, status: 400, error: "pcm-s16le-16k audio is only accepted for voice sessions" };
  }
  await addAudioChunk({
    boxRoot,
    id: session.id,
    segmentId,
    segmentStartedAt: segmentStartedAtHeader ?? startedAt,
    filename,
    buffer,
    audioFormat: formatResult.data,
  });
  return { ok: true };
}

export async function handleCaptureUpload(opts: {
  boxRoot: string;
  request: CaptureUploadRequest;
  reply: FastifyReply;
}): Promise<unknown> {
  const { boxRoot, request, reply } = opts;
  const session = await readStagingSession({ boxRoot, id: request.params.id });
  if (!session) return reply.status(404).send({ error: "Session not found" });
  const authorization = await authorizeCaptureSessionOwner({ boxRoot, request, createdBy: session.createdBy });
  if (authorization.status === "rejected") {
    return reply.status(authorization.statusCode).send({ error: authorization.error });
  }
  if (session.state !== "open") {
    return reply
      .status(409)
      .send({ error: `Session is ${session.state}; uploads are only accepted while it is open` });
  }

  const header = (name: string): string | undefined => {
    const value = request.headers[name];
    return typeof value === "string" ? value : undefined;
  };
  const filename = header("x-capture-filename");
  if (!filename) return reply.status(400).send({ error: "X-Capture-Filename header required" });
  const kind = header("x-capture-kind") ?? "";
  if (!isUploadKind(kind)) {
    return reply.status(400).send({ error: "X-Capture-Kind must be audio, photo, or file" });
  }

  try {
    resolveStagedFile({ boxRoot, id: session.id, filename });
  } catch (error) {
    if (error instanceof StagingPathError) {
      return reply.status(400).send({ error: "Invalid filename" });
    }
    throw error;
  }

  const buffer = await readUploadBuffer(request);
  if (!buffer) {
    console.error(`[capture] No file data in upload for session ${session.id}, filename: ${filename}`);
    return reply.status(400).send({ error: "No file data received" });
  }
  const startedAt = header("x-capture-started-at") ?? getBoxTimeISO(boxRoot);

  try {
    if (kind === "audio") {
      const result = await stageAudioUpload({
        boxRoot,
        session,
        segmentId: header("x-capture-segment-id"),
        audioFormatHeader: header("x-capture-audio-format"),
        segmentStartedAtHeader: header("x-capture-segment-started-at"),
        startedAt,
        filename,
        buffer,
      });
      if (!result.ok) return reply.status(result.status).send({ error: result.error });
    } else if (kind === "photo") {
      await addPhoto({
        boxRoot,
        id: session.id,
        filename,
        capturedAt: startedAt,
        source: header("x-capture-source") ?? "camera-user",
        originalName: header("x-capture-original-name"),
        mimeType: header("x-capture-mime-type"),
        buffer,
      });
    } else {
      await addFile({
        boxRoot,
        id: session.id,
        filename,
        uploadedAt: startedAt,
        originalName: header("x-capture-original-name") ?? filename,
        mimeType: header("x-capture-mime-type") ?? "application/octet-stream",
        buffer,
      });
    }
  } catch (error) {
    if (isStagingLimitError(error)) return reply.status(413).send({ error: error.message });
    if (isCaptureAudioFormatError(error)) {
      return reply.status(409).send({ error: error.message });
    }
    if (error instanceof StagingUploadReplayConflictError) {
      return reply.status(409).send({ error: error.message });
    }
    // The session sealed while this body was still arriving. The pre-body check
    // above can't catch that; the staging store's in-lock barrier does.
    if (error instanceof StagingSessionNotOpenError) {
      return reply.status(409).send({ error: error.message });
    }
    throw error;
  }

  return { success: true, filename, size: buffer.length };
}
