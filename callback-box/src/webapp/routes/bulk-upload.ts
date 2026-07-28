/**
 * Bulk file-upload routes (`docs/plans/bulk-file-upload.md`, Track 1).
 *
 * A bulk batch is a staging session of `kind: "bulk"` with a predeclared item
 * registry: creating it binds a REQUIRED target chat + context dir, uploads
 * stream one registered item at a time, and finalize seals the session and
 * fires the prepare→deliver worker (which lands an `upload-batch` card under the
 * chat's `tmp-upload/` and injects an `<upload>` message).
 *
 * These stay raw Fastify routes (not tRPC): item uploads stream the raw request
 * body to disk (hash + byte-count while streaming) and don't fit the tRPC
 * request/response shape — the same reason capture's upload routes are raw. They
 * run inside the per-box auth scope (server-box-scope.ts), so mobile-bearer and
 * cookie auth both apply, exactly like capture.
 *
 * The streaming upload route needs the raw request stream, so its routes are
 * registered in an encapsulated child scope whose `application/octet-stream`
 * content-type parser passes the body through untouched (the parent box scope
 * buffers octet-stream for capture; a child parser shadows it for these routes).
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { EventBus } from "../../core/event-bus.js";
import { getBoxTimeISO } from "../../lib/time.js";
import {
  createStagingSession,
  readStagingSession,
  registerBulkItems,
  setBulkFailedItems,
  sealStagingSession,
  cleanupStagingSession,
  isBulkSession,
  type StagingBulkItem,
} from "../../core/capture/staging-store.js";
import { addFileStreamed } from "../../core/capture/staging-stream.js";
import { StagingPathError, StagingSessionGoneError, StagingUploadReplayConflictError } from "../../core/capture/staging-errors.js";
import { isStagingLimitError } from "../../core/capture/staging-limits.js";
import { prepareAndDeliverBulkBatch, markBulkPreparationFailed } from "../../core/bulk-upload/worker.js";
import {
  authorizeCaptureSessionOwner,
  resolveCaptureRequestOwner,
} from "../capture-request-owner.js";
import { getChatRuntime } from "../chat-runtime.js";

const BulkItemSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  size: z.number().optional(),
  mimetype: z.string().optional(),
});

const CreateBulkBodySchema = z.object({
  targetSessionId: z.string().min(1),
  contextDir: z.string().optional(),
  items: z.array(BulkItemSchema).optional(),
});

const RegisterItemsBodySchema = z.object({
  items: z.array(BulkItemSchema).min(1),
});

const FinalizeBodySchema = z.object({
  failedItems: z
    .array(z.object({ id: z.string().optional(), name: z.string(), reason: z.string() }))
    .optional(),
});

const BULK_CAPABILITIES = {
  acceptedUploadEncodings: ["raw-body-v1"],
} as const;

/** An item upload named an `itemId` not in the session's predeclared registry. */
export class UnregisteredBulkItemError extends Error {
  constructor(itemId: string) {
    super(`No registered item ${itemId} in this bulk batch`);
    this.name = "UnregisteredBulkItemError";
  }
}

interface RegisterBulkUploadRoutesOptions {
  server: FastifyInstance;
  boxRoot: string;
  eventBus: EventBus;
}

type IdRequest = FastifyRequest<{ Params: { id: string } }>;

/** Read a single string header, or undefined when absent/duplicated. */
function header(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return typeof value === "string" ? value : undefined;
}

/** Resolve an owned bulk session, or send the mapped error and return null. */
async function loadOwnedBulkSession(opts: {
  boxRoot: string;
  request: FastifyRequest;
  reply: FastifyReply;
  id: string;
}): Promise<Awaited<ReturnType<typeof readStagingSession>> | null> {
  const { boxRoot, request, reply, id } = opts;
  const session = await readStagingSession({ boxRoot, id });
  if (!session) {
    await reply.status(404).send({ error: "Session not found" });
    return null;
  }
  const authorization = await authorizeCaptureSessionOwner({ boxRoot, request, createdBy: session.createdBy });
  if (authorization.status === "rejected") {
    await reply.status(authorization.statusCode).send({ error: authorization.error });
    return null;
  }
  if (!isBulkSession(session)) {
    await reply.status(400).send({ error: "Not a bulk-upload session" });
    return null;
  }
  return session;
}

export async function registerBulkUploadRoutes(options: RegisterBulkUploadRoutesOptions): Promise<void> {
  const { server, boxRoot, eventBus } = options;

  await server.register(async (instance) => {
    // Don't drain the body so item uploads can stream `request.raw` straight to
    // disk (never buffering a ~50 MB file in memory). `done(null)` leaves the
    // raw stream readable in the handler — the same non-draining pattern
    // `routes/auth.ts` and the hub `*` parser use — and shadows the parent box
    // scope's buffering octet-stream parser for the routes registered here.
    instance.removeContentTypeParser("application/octet-stream");
    // eslint-disable-next-line max-params -- Fastify's addContentTypeParser callback signature is (request, payload, done)
    instance.addContentTypeParser("application/octet-stream", (_request, _payload, done) => done(null));

    // POST /api/bulk/sessions — create a bulk batch bound to a target chat.
    instance.post<{ Body: unknown }>("/api/bulk/sessions", async (request, reply) => {
      const owner = await resolveCaptureRequestOwner({ boxRoot, request });
      if (owner.status === "ownerless-mobile") {
        return reply.status(403).send({
          error: "This paired device predates mobile identity. Re-pair it before uploading.",
        });
      }
      if (owner.status === "unauthenticated") return reply.status(401).send({ error: "Not authenticated" });
      if (owner.status === "auth-store-unavailable") {
        return reply.status(503).send({ error: "Authentication temporarily unavailable" });
      }
      const parsed = CreateBulkBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        // A bulk batch with no target chat is invalid at creation (the overlay
        // always launches from a chat) — validate loudly rather than orphan it.
        return reply.status(400).send({ error: "A bulk upload requires a target chat session id" });
      }
      const items: StagingBulkItem[] = parsed.data.items ?? [];
      const session = await createStagingSession({
        boxRoot,
        targetSessionId: parsed.data.targetSessionId,
        createdBy: owner.email,
        kind: "bulk",
        expectedItems: items,
        contextDir: parsed.data.contextDir ?? "",
      });
      return { sessionId: session.id, startedAt: session.createdAt, capabilities: BULK_CAPABILITIES };
    });

    // POST /api/bulk/sessions/:id/items — append to the predeclared registry.
    instance.post<{ Params: { id: string }; Body: unknown }>(
      "/api/bulk/sessions/:id/items",
      async (request: IdRequest, reply) => {
        const session = await loadOwnedBulkSession({ boxRoot, request, reply, id: request.params.id });
        if (!session) return reply;
        if (session.state !== "open") {
          return reply.status(409).send({ error: `Session is ${session.state}; items can only be registered while it is open` });
        }
        const parsed = RegisterItemsBodySchema.safeParse(request.body ?? {});
        if (!parsed.success) return reply.status(400).send({ error: "items must be a non-empty array" });
        await registerBulkItems({ boxRoot, id: session.id, items: parsed.data.items });
        const updated = await readStagingSession({ boxRoot, id: session.id });
        return { registered: updated?.expectedItems?.length ?? 0 };
      },
    );

    // POST /api/bulk/sessions/:id/items/:itemId/upload — stream one item's bytes.
    instance.post<{ Params: { id: string; itemId: string } }>(
      "/api/bulk/sessions/:id/items/:itemId/upload",
      async (request: FastifyRequest<{ Params: { id: string; itemId: string } }>, reply) => {
        const { id, itemId } = request.params;
        const session = await loadOwnedBulkSession({ boxRoot, request, reply, id });
        if (!session) return reply;
        if (session.state !== "open") {
          return reply.status(409).send({ error: `Session is ${session.state}; uploads are only accepted while it is open` });
        }
        const registered = (session.expectedItems ?? []).some((it) => it.id === itemId);
        if (!registered) {
          return reply.status(400).send({ error: new UnregisteredBulkItemError(itemId).message });
        }
        const filename = header(request, "x-upload-filename");
        if (!filename) return reply.status(400).send({ error: "X-Upload-Filename header required" });

        try {
          const result = await addFileStreamed({
            boxRoot,
            id,
            filename,
            uploadedAt: header(request, "x-upload-uploaded-at") ?? getBoxTimeISO(boxRoot),
            originalName: header(request, "x-upload-original-name") ?? filename,
            mimeType: header(request, "x-upload-mime-type") ?? "application/octet-stream",
            itemId,
            source: request.raw,
          });
          return { success: true, filename, itemId, size: result.size, sha256: result.sha256 };
        } catch (error) {
          if (error instanceof StagingPathError) return reply.status(400).send({ error: "Invalid filename" });
          if (isStagingLimitError(error)) return reply.status(413).send({ error: error.message });
          if (error instanceof StagingUploadReplayConflictError) return reply.status(409).send({ error: error.message });
          if (error instanceof StagingSessionGoneError) return reply.status(404).send({ error: "Session not found" });
          throw error;
        }
      },
    );

    // GET /api/bulk/sessions/:id — resume/status: registered vs received items.
    instance.get<{ Params: { id: string } }>(
      "/api/bulk/sessions/:id",
      async (request: IdRequest, reply) => {
        const session = await loadOwnedBulkSession({ boxRoot, request, reply, id: request.params.id });
        if (!session) return reply;
        return {
          sessionId: session.id,
          state: session.state,
          targetSessionId: session.targetSessionId,
          registered: session.expectedItems ?? [],
          received: session.files.map((f) => ({
            itemId: f.itemId ?? null,
            name: f.originalName,
            size: f.size ?? null,
          })),
        };
      },
    );

    // DELETE /api/bulk/sessions/:id — cancel and discard the batch.
    instance.delete<{ Params: { id: string } }>(
      "/api/bulk/sessions/:id",
      async (request: IdRequest, reply) => {
        const session = await loadOwnedBulkSession({ boxRoot, request, reply, id: request.params.id });
        if (!session) return reply;
        await cleanupStagingSession({ boxRoot, id: session.id });
        return { success: true };
      },
    );

    // POST /api/bulk/sessions/:id/finalize — seal the batch and fire the
    // background prepare→deliver worker (Track 1), returning immediately. The
    // uploader's `failedItems` report is persisted so a resume rebuilds the same
    // batch. A CAS seal means two concurrent finalize POSTs can't both fire.
    instance.post<{ Params: { id: string }; Body: unknown }>(
      "/api/bulk/sessions/:id/finalize",
      async (request: IdRequest, reply) => {
        const session = await loadOwnedBulkSession({ boxRoot, request, reply, id: request.params.id });
        if (!session) return reply;
        const parsed = FinalizeBodySchema.safeParse(request.body ?? {});
        if (!parsed.success) return reply.status(400).send({ error: "Invalid finalize body" });

        const runtime = getChatRuntime(boxRoot);
        if (!runtime) {
          console.error(`[bulk] No chat runtime for box; cannot finalize batch ${session.id}`);
          return reply.status(503).send({ error: "Chat runtime unavailable" });
        }

        const seal = await sealStagingSession({ boxRoot, id: session.id });
        if (seal.sealed) {
          if (parsed.data.failedItems !== undefined) {
            await setBulkFailedItems({ boxRoot, id: session.id, failedItems: parsed.data.failedItems });
          }
          void prepareAndDeliverBulkBatch({
            boxRoot,
            id: session.id,
            eventBus,
            registry: runtime.registry,
            wireSession: runtime.wireSession,
          }).catch(async (err: unknown) => {
            console.error(`[bulk] Preparation of ${session.id} failed:`, err);
            await markBulkPreparationFailed({ boxRoot, id: session.id });
          });
        }
        return { sessionId: session.id, staged: true };
      },
    );
  });
}
