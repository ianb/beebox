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
  setStagingState,
  addAudioChunk,
  addPhoto,
  addFile,
  resolveStagedFile,
  StagingPathError,
} from "../../core/capture/staging-store.js";
import { prepareCaptureSession } from "../../core/capture/prepare.js";
import { resumeStagingSessions } from "../../core/capture/resume.js";
import { getChatRuntime } from "../chat-runtime.js";

interface RegisterCaptureRoutesOptions {
  server: FastifyInstance;
  boxRoot: string;
  eventBus: EventBus;
}

type UploadKind = "audio" | "photo" | "file";

const UPLOAD_KINDS: readonly UploadKind[] = ["audio", "photo", "file"];

function isUploadKind(value: string): value is UploadKind {
  return (UPLOAD_KINDS as readonly string[]).includes(value);
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
      const session = await createStagingSession({ boxRoot, targetSessionId });
      return { sessionId: session.id, startedAt: session.createdAt };
    },
  );

  // POST /api/capture/sessions/:id/upload — stage one file into the session.
  server.post<{ Params: { id: string } }>(
    "/api/capture/sessions/:id/upload",
    async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const session = await readStagingSession({ boxRoot, id: request.params.id });
      if (!session) return reply.status(404).send({ error: "Session not found" });

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

      // Re-fire only from a fresh (open) or previously-failed session; an
      // already-sealed/preparing one is left to its in-flight worker.
      const shouldFire = session.state === "open" || session.state.startsWith("failed:");
      if (shouldFire) {
        const runtime = getChatRuntime(boxRoot);
        if (!runtime) {
          console.error(`[capture] No chat runtime for box; cannot prepare capture ${session.id}`);
          return reply.status(503).send({ error: "Chat runtime unavailable" });
        }
        await setStagingState({ boxRoot, id: session.id, state: "sealed" });
        void prepareCaptureSession({
          boxRoot,
          id: session.id,
          eventBus,
          registry: runtime.registry,
          wireSession: runtime.wireSession,
        }).catch(async (err: unknown) => {
          console.error(`[capture] Preparation of ${session.id} failed:`, err);
          await setStagingState({ boxRoot, id: session.id, state: "failed:prepare" }).catch(() => {});
        });
      }

      return { sessionId: session.id, staged: true };
    },
  );

  // On startup, resume any staged captures left mid-preparation by a crash or
  // restart. Fire-and-forget; the chat runtime is registered before this route.
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
  } else {
    console.warn("[capture] Chat runtime not ready; skipping staging resume scan");
  }
}
