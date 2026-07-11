/**
 * Capture session routes — audio recording + photo/file capture from the web UI.
 *
 * Uploads stage into the box at `tmp/capture-staging/<session-id>/` with a
 * `session.json` manifest (see `core/capture/staging-store.ts`). Finalize seals
 * the session and fires the background preparation worker
 * (`core/capture/prepare.ts`), which writes + commits the capture document under
 * the target chat's `tmp-capture/` and delivers a `<capture>` message.
 *
 * These stay raw Fastify routes (not tRPC): multipart upload + custom
 * `X-Capture-*` headers don't fit the tRPC request/response shape. They run
 * inside the per-box auth scope (server-box-scope.ts), so mobile-bearer and
 * cookie auth both apply; the frontend sends the mobile token via
 * `withMobileAuth()`.
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import type { EventBus } from "../../core/event-bus.js";
import { getBoxTimeISO } from "../../lib/time.js";
import {
  createStagingSession,
  readStagingSession,
  cleanupStagingSession,
  sealStagingSession,
  addAudioChunk,
  addPhoto,
  addFile,
  resolveStagedFile,
  StagingPathError,
} from "../../core/capture/staging-store.js";
import { isStagingLimitError } from "../../core/capture/staging-limits.js";
import { prepareCaptureSession, markCapturePreparationFailed } from "../../core/capture/prepare.js";
import { getSessionUser } from "../auth.js";
import { resumeStagingSessions } from "../../core/capture/resume.js";
import { sweepAbandonedCaptures } from "../../core/capture/sweep.js";
import { startAwakeTimeout, type AwakeTimeout } from "../../lib/awake-timeout.js";
import { getChatRuntime, type ChatRuntime } from "../chat-runtime.js";

/** How much awake time between abandonment sweeps (Track 5). */
const SWEEP_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Run the abandonment sweep every {@link SWEEP_INTERVAL_MS} of *awake* time
 * (never wall time — a plain interval fires instantly after a macOS sleep and
 * would mass-finalize sessions that were "abandoned" only by the laptop lid).
 * Self-rearms after each run; returns a cancel handle wired to server close so
 * the timer never outlives the box scope.
 */
function scheduleAbandonmentSweep(opts: {
  boxRoot: string;
  eventBus: EventBus;
  runtime: ChatRuntime;
}): () => void {
  const { boxRoot, eventBus, runtime } = opts;
  let timer: AwakeTimeout | null = null;
  let stopped = false;

  const runOnce = async (): Promise<void> => {
    await sweepAbandonedCaptures({
      boxRoot,
      firePreparation: (id) => {
        void prepareCaptureSession({
          boxRoot,
          id,
          eventBus,
          registry: runtime.registry,
          wireSession: runtime.wireSession,
        }).catch(async (err: unknown) => {
          console.error(`[capture] Swept preparation of ${id} failed:`, err);
          await markCapturePreparationFailed({ boxRoot, id, eventBus });
        });
      },
    });
  };

  const arm = (): void => {
    if (stopped) return;
    timer = startAwakeTimeout({
      timeoutMs: SWEEP_INTERVAL_MS,
      onTimeout: () => {
        void runOnce()
          .catch((err: unknown) => {
            console.error(`[capture] Abandonment sweep failed for box=${boxRoot}:`, err);
          })
          .finally(() => arm());
      },
    });
  };

  arm();
  return () => {
    stopped = true;
    timer?.stop();
  };
}

interface RegisterCaptureRoutesOptions {
  server: FastifyInstance;
  boxRoot: string;
  eventBus: EventBus;
}

type UploadKind = "audio" | "photo" | "file";

const UPLOAD_KINDS: readonly UploadKind[] = ["audio", "photo", "file"];
const UPLOAD_KIND_SET = new Set<string>(UPLOAD_KINDS);

function isUploadKind(value: string): value is UploadKind {
  return UPLOAD_KIND_SET.has(value);
}

/** Read the request's file bytes from multipart, falling back to a raw body. */
async function readUploadBuffer(request: FastifyRequest): Promise<Buffer | null> {
  const file = await request.file();
  if (file) return file.toBuffer();
  const rawBody = request.body;
  if (rawBody instanceof Buffer) return rawBody;
  return null;
}

export async function registerCaptureRoutes(options: RegisterCaptureRoutesOptions): Promise<void> {
  const { server, boxRoot, eventBus } = options;

  // POST /api/capture/sessions — create a new staging session.
  server.post<{ Body: { targetSessionId?: string | null } | undefined }>(
    "/api/capture/sessions",
    async (request, _reply) => {
      const targetSessionId = request.body?.targetSessionId ?? null;
      // Attribute the session to the authenticated user so the resume query can
      // scope by owner (X4). Null when auth is disabled (local dev).
      const createdBy = getSessionUser(request)?.email ?? null;
      const session = await createStagingSession({ boxRoot, targetSessionId, createdBy });
      return { sessionId: session.id, startedAt: session.createdAt };
    },
  );

  // POST /api/capture/sessions/:id/upload — stage one file into the session.
  server.post<{ Params: { id: string } }>(
    "/api/capture/sessions/:id/upload",
    async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const session = await readStagingSession({ boxRoot, id: request.params.id });
      if (!session) return reply.status(404).send({ error: "Session not found" });

      // Uploads are only accepted while the session is open; a sealed/preparing/
      // delivered/failed session is past the point of accepting media (X3). 409
      // rather than 404 so the client can tell "gone" from "no longer open".
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

      const kindHeader = header("x-capture-kind") ?? "";
      if (!isUploadKind(kindHeader)) {
        return reply.status(400).send({ error: "X-Capture-Kind must be audio, photo, or file" });
      }

      // Path-traversal guard (clean 400; the store re-guards as an invariant).
      try {
        resolveStagedFile({ boxRoot, id: session.id, filename });
      } catch (e) {
        if (e instanceof StagingPathError) {
          return reply.status(400).send({ error: "Invalid filename" });
        }
        throw e;
      }

      const buffer = await readUploadBuffer(request);
      if (!buffer) {
        console.error(`[capture] No file data in upload for session ${session.id}, filename: ${filename}`);
        return reply.status(400).send({ error: "No file data received" });
      }

      const now = getBoxTimeISO(boxRoot);
      const startedAt = header("x-capture-started-at") ?? now;

      try {
        if (kindHeader === "audio") {
          const segmentId = header("x-capture-segment-id");
          if (!segmentId) {
            return reply.status(400).send({ error: "X-Capture-Segment-Id required for audio" });
          }
          const segmentStartedAt = header("x-capture-segment-started-at") ?? startedAt;
          await addAudioChunk({ boxRoot, id: session.id, segmentId, segmentStartedAt, filename, buffer });
        } else if (kindHeader === "photo") {
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
      } catch (e) {
        // Over a per-session cap → 413 with the error's message as the body (X3).
        if (isStagingLimitError(e)) return reply.status(413).send({ error: e.message });
        throw e;
      }

      return { success: true, filename, size: buffer.length };
    },
  );

  // DELETE /api/capture/sessions/:id — cancel and discard the session.
  server.delete<{ Params: { id: string } }>(
    "/api/capture/sessions/:id",
    async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const session = await readStagingSession({ boxRoot, id: request.params.id });
      if (!session) return reply.status(404).send({ error: "Session not found" });
      await cleanupStagingSession({ boxRoot, id: session.id });
      return { success: true };
    },
  );

  // POST /api/capture/sessions/:id/finalize — seal the session and kick off
  // the background preparation worker (Track 3), returning immediately. The
  // worker writes + commits the capture document under the target chat's
  // `tmp-capture/`, then delivers a `<capture>` message.
  server.post<{ Params: { id: string } }>(
    "/api/capture/sessions/:id/finalize",
    async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const session = await readStagingSession({ boxRoot, id: request.params.id });
      if (!session) return reply.status(404).send({ error: "Session not found" });

      const runtime = getChatRuntime(boxRoot);
      if (!runtime) {
        console.error(`[capture] No chat runtime for box; cannot prepare capture ${session.id}`);
        return reply.status(503).send({ error: "Chat runtime unavailable" });
      }

      // Compare-and-swap into `sealed` so two concurrent finalize POSTs can't
      // both fire preparation. Only a true fire-eligible transition (open, or a
      // failed:* retry) kicks off the worker; an already-sealed/in-flight
      // session returns the same success response without re-firing.
      const seal = await sealStagingSession({ boxRoot, id: session.id });
      if (seal.sealed) {
        void prepareCaptureSession({
          boxRoot,
          id: session.id,
          eventBus,
          registry: runtime.registry,
          wireSession: runtime.wireSession,
        }).catch(async (err: unknown) => {
          console.error(`[capture] Preparation of ${session.id} failed:`, err);
          await markCapturePreparationFailed({ boxRoot, id: session.id, eventBus });
        });
      }

      return { sessionId: session.id, staged: true };
    },
  );

  // On startup, resume any staged captures left mid-preparation by a crash or
  // restart, and start the periodic abandonment sweep. Fire-and-forget; the
  // chat runtime is registered before this route.
  const runtime = getChatRuntime(boxRoot);
  if (runtime) {
    void resumeStagingSessions({
      boxRoot,
      eventBus,
      registry: runtime.registry,
      wireSession: runtime.wireSession,
    }).catch((err: unknown) => {
      console.error("[capture] Staging resume scan failed:", err);
    });

    const cancelSweep = scheduleAbandonmentSweep({ boxRoot, eventBus, runtime });
    server.addHook("onClose", async () => {
      cancelSweep();
    });
  } else {
    console.warn("[capture] Chat runtime not ready; skipping staging resume scan + sweep");
  }
}
