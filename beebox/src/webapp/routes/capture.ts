/**
 * Capture session routes — audio recording + photo/file capture from the web UI.
 *
 * Uploads stage into the box at `_tmp/capture-staging/<session-id>/` with a
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
import { z } from "zod";
import type { EventBus } from "../../core/event-bus.js";
import {
  readStagingSession,
  sealStagingSession,
  listStagingSessions,
} from "../../core/capture/staging-store.js";
import { discardStagingSessionIfCancellable, type DiscardResult } from "../../core/capture/staging-teardown.js";
import { StagingSessionGoneError } from "../../core/capture/staging-errors.js";
import { prepareCaptureSession, markCapturePreparationFailed } from "../../core/capture/prepare.js";
import { selectResumableCaptures } from "../../core/capture/pending.js";
import {
  authorizeCaptureSessionOwner,
  resolveCaptureRequestOwner,
} from "../capture-request-owner.js";
import { resumeStagingSessions } from "../../core/capture/resume.js";
import { sweepAbandonedCaptures } from "../../core/capture/sweep.js";
import { startAwakeTimeout, type AwakeTimeout } from "../../lib/awake-timeout.js";
import { getChatRuntime, type ChatRuntime } from "../chat-runtime.js";
import { handleCaptureUpload } from "./capture-upload.js";
import { handleCreateCaptureSession } from "./capture-create.js";
import { handleVoiceFinalize } from "./capture-finalize-voice.js";
import { scheduleVoiceSweep } from "./voice-lifecycle.js";

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

const ResumableQuerySchema = z.object({
  targetSessionId: z.string().nullable().optional(),
  clientSessionId: z.string().nullable().optional(),
});

export async function registerCaptureRoutes(options: RegisterCaptureRoutesOptions): Promise<void> {
  const { server, boxRoot, eventBus } = options;

  if (!server.hasContentTypeParser("application/octet-stream")) {
    server.addContentTypeParser(
      "application/octet-stream",
      { parseAs: "buffer" },
      async (_request: FastifyRequest, body: Buffer) => body,
    );
  }

  // POST /api/capture/sessions — create a new staging session (capture or voice).
  server.post<{ Body: unknown }>(
    "/api/capture/sessions",
    async (request, reply) => handleCreateCaptureSession({ boxRoot, request, reply }),
  );

  server.get<{
    Querystring: { targetSessionId?: string | null; clientSessionId?: string | null };
  }>("/api/capture/sessions/resumable", async (request, reply) => {
    const parsed = ResumableQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid resumable capture query" });
    }
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
    const sessions = await listStagingSessions({ boxRoot });
    return {
      resumable: selectResumableCaptures({
        sessions,
        targetSessionId: parsed.data.targetSessionId ?? null,
        clientSessionId: parsed.data.clientSessionId ?? null,
        requestingUser: owner.email,
      }),
    };
  });

  // POST /api/capture/sessions/:id/upload — stage one file into the session.
  server.post<{ Params: { id: string } }>(
    "/api/capture/sessions/:id/upload",
    async (request, reply) => handleCaptureUpload({ boxRoot, request, reply }),
  );

  // DELETE /api/capture/sessions/:id — cancel and discard the session.
  //
  // Goes through the guarded discard, never the unconditional teardown: only an
  // `open` batch (the uploader's own cancel) or a dead `failed:*` one (the
  // chat chip's discard) is the client's to delete. Deleting a `preparing` or
  // `delivering` session would pull the directory out from under the background
  // worker, which then reads `null` and silently returns — the client reports
  // success and no message ever arrives.
  server.delete<{ Params: { id: string } }>(
    "/api/capture/sessions/:id",
    async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const session = await readStagingSession({ boxRoot, id: request.params.id });
      if (!session) return reply.status(404).send({ error: "Session not found" });
      const authorization = await authorizeCaptureSessionOwner({
        boxRoot,
        request,
        createdBy: session.createdBy,
      });
      if (authorization.status === "rejected") {
        return reply.status(authorization.statusCode).send({ error: authorization.error });
      }
      // Gone between the read above and the lock inside — someone else already
      // tore it down, which is the outcome the caller wanted anyway.
      const discard = await discardStagingSessionIfCancellable({ boxRoot, id: session.id })
        .catch((e: unknown): DiscardResult => {
          if (e instanceof StagingSessionGoneError) return { discarded: true };
          throw e;
        });
      if (!discard.discarded) {
        return reply.status(409).send({
          error: `Capture is already ${discard.blockedBy ?? "in flight"} and can no longer be discarded`,
        });
      }
      return { success: true };
    },
  );

  // POST /api/capture/sessions/:id/finalize — seal the session and kick off
  // the background preparation worker (Track 3), returning immediately. The
  // worker writes + commits the capture document under the target chat's
  // `tmp-capture/`, then delivers a `<capture>` message.
  //
  // A voice session (`docs/plans/resilient-voice-recording.md`) branches to
  // `handleVoiceFinalize` instead: contiguity check, seal, and (if `hq` was
  // requested) fire the HQ job rather than capture preparation.
  server.post<{ Params: { id: string } }>(
    "/api/capture/sessions/:id/finalize",
    async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const session = await readStagingSession({ boxRoot, id: request.params.id });
      if (!session) return reply.status(404).send({ error: "Session not found" });
      const authorization = await authorizeCaptureSessionOwner({
        boxRoot,
        request,
        createdBy: session.createdBy,
      });
      if (authorization.status === "rejected") {
        return reply.status(authorization.statusCode).send({ error: authorization.error });
      }

      if (session.kind === "voice") {
        const voiceRuntime = getChatRuntime(boxRoot);
        return handleVoiceFinalize({
          boxRoot,
          session,
          request,
          reply,
          eventBus,
          registry: voiceRuntime?.registry,
          wireSession: voiceRuntime?.wireSession,
        });
      }

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
    const cancelVoiceSweep = scheduleVoiceSweep({
      boxRoot,
      eventBus,
      registry: runtime.registry,
      wireSession: runtime.wireSession,
    });
    server.addHook("onClose", async () => {
      cancelSweep();
      cancelVoiceSweep();
    });
  } else {
    console.warn("[capture] Chat runtime not ready; skipping staging resume scan + sweep");
  }
}
