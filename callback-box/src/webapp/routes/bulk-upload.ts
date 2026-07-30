/**
 * Bulk file-upload routes (`docs/implemented-plans/bulk-file-upload.md`, Track 1).
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
  sealStagingSession,
  cleanupStagingSession,
  isBulkSession,
  type StagingBulkItem,
} from "../../core/capture/staging-store.js";
import { addFileStreamed } from "../../core/capture/staging-stream.js";
import {
  StagingPathError,
  StagingSessionGoneError,
  StagingUploadReplayConflictError,
  StagingSessionNotOpenError,
  StagingItemNotRegisteredError,
} from "../../core/capture/staging-errors.js";
import { isStagingLimitError, MAX_STAGED_ITEMS } from "../../core/capture/staging-limits.js";
import { prepareAndDeliverBulkBatch, markBulkPreparationFailed } from "../../core/bulk-upload/worker.js";
import {
  authorizeCaptureSessionOwner,
  resolveCaptureRequestOwner,
} from "../capture-request-owner.js";
import { getDirectoryForSession } from "../../core/chat/session/history.js";
import { getChatRuntime } from "../chat-runtime.js";
import { startBulkUploadLifecycle } from "./bulk-upload-lifecycle.js";
import { beginStream, endStream } from "./bulk-upload-stream-gate.js";

/** Bound client-supplied id/name/mimetype strings (X9 — untrusted lengths). */
const MAX_ITEM_FIELD_LENGTH = 512;
/** Items accepted per create/register request; the registry TOTAL cap is X3's 500. */
const MAX_ITEMS_PER_REQUEST = 500;

const BulkItemSchema = z.object({
  id: z.string().min(1).max(MAX_ITEM_FIELD_LENGTH),
  name: z.string().max(MAX_ITEM_FIELD_LENGTH),
  size: z.number().optional(),
  mimetype: z.string().max(MAX_ITEM_FIELD_LENGTH).optional(),
});

const CreateBulkBodySchema = z.object({
  // No `contextDir`: it's derived server-side from `targetSessionId` (a
  // client-supplied dir would be a path-traversal vector — see below).
  targetSessionId: z.string().min(1),
  items: z.array(BulkItemSchema).max(MAX_ITEMS_PER_REQUEST).optional(),
});

const RegisterItemsBodySchema = z.object({
  items: z.array(BulkItemSchema).min(1).max(MAX_ITEMS_PER_REQUEST),
});

/** The first item id appearing twice in `items`, or `null` when all unique. */
function firstDuplicateId(items: StagingBulkItem[]): string | null {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) return item.id;
    seen.add(item.id);
  }
  return null;
}

/**
 * Validate an addition to a session's registry against duplicate ids and the
 * total-item cap, returning a 400 message or `null` when it's clean. A NEW id
 * colliding with one already registered is rejected (an update-in-place would
 * silently overwrite the earlier item's claims); re-sending EXISTING ids is
 * fine (idempotent re-register while the picker streams).
 */
function registryAdditionError(opts: { existing: StagingBulkItem[]; incoming: StagingBulkItem[] }): string | null {
  const dupe = firstDuplicateId(opts.incoming);
  if (dupe !== null) return `Duplicate item id in registry: ${dupe}`;
  const existingIds = new Set(opts.existing.map((it) => it.id));
  const newIds = opts.incoming.filter((it) => !existingIds.has(it.id)).length;
  if (opts.existing.length + newIds > MAX_STAGED_ITEMS) {
    return `Registry would exceed the ${String(MAX_STAGED_ITEMS)}-item cap`;
  }
  return null;
}

/**
 * Upper bound on the batch introduction. Untrusted client prose, so it is capped
 * at the boundary — far above any real composer message, far below the server's
 * body limit.
 */
const MAX_NOTE_LENGTH = 10_000;

const FinalizeBodySchema = z.object({
  failedItems: z
    .array(z.object({ id: z.string().optional(), name: z.string(), reason: z.string() }))
    .optional(),
  /**
   * The user's introduction for the batch — the composer text they submitted the
   * photos with. Optional: an uploader with an empty composer sends none, and a
   * batch without one is exactly the "ask before filing" case.
   */
  note: z.string().max(MAX_NOTE_LENGTH).optional(),
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

/**
 * Shadow the parent box scope's buffering octet-stream parser with a
 * non-draining one, so item uploads can stream `request.raw` straight to disk
 * (never buffering a ~50 MB file in memory). `done(null)` leaves the raw stream
 * readable in the handler — the same pattern `routes/auth.ts` and the hub `*`
 * parser use.
 */
function installOctetStreamPassthrough(instance: FastifyInstance): void {
  instance.removeContentTypeParser("application/octet-stream");
  // eslint-disable-next-line max-params -- Fastify's addContentTypeParser callback signature is (request, payload, done)
  instance.addContentTypeParser("application/octet-stream", (_request, _payload, done) => done(null));
}

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

/**
 * Create a bulk batch bound to a target chat. The context dir is derived
 * server-side from `targetSessionId` (never the request body — a client-supplied
 * dir would be a path-traversal vector), mirroring capture's placement
 * resolution. Rejects a missing target (400), duplicate/over-cap items (400).
 */
async function handleCreateBulkSession(opts: {
  boxRoot: string;
  request: FastifyRequest;
  reply: FastifyReply;
}): Promise<unknown> {
  const { boxRoot, request, reply } = opts;
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
    // A bulk batch with no target chat is invalid at creation (the overlay always
    // launches from a chat) — validate loudly rather than orphan it.
    return reply.status(400).send({ error: "A bulk upload requires a target chat session id" });
  }
  const items: StagingBulkItem[] = parsed.data.items ?? [];
  const registryError = registryAdditionError({ existing: [], incoming: items });
  if (registryError !== null) return reply.status(400).send({ error: registryError });
  const contextDir = (await getDirectoryForSession(boxRoot, parsed.data.targetSessionId)) ?? "";
  const session = await createStagingSession({
    boxRoot,
    targetSessionId: parsed.data.targetSessionId,
    createdBy: owner.email,
    kind: "bulk",
    expectedItems: items,
    contextDir,
  });
  return { sessionId: session.id, startedAt: session.createdAt, capabilities: BULK_CAPABILITIES };
}

/** Stream one registered item's bytes to staging (hash + byte-count server-side). */
async function handleUploadBulkItem(opts: {
  boxRoot: string;
  request: FastifyRequest<{ Params: { id: string; itemId: string } }>;
  reply: FastifyReply;
}): Promise<unknown> {
  const { boxRoot, request, reply } = opts;
  const { id, itemId } = request.params;
  const session = await loadOwnedBulkSession({ boxRoot, request, reply, id });
  if (!session) return reply;
  if (session.state !== "open") {
    return reply.status(409).send({ error: `Session is ${session.state}; uploads are only accepted while it is open` });
  }
  const registered = (session.expectedItems ?? []).some((it) => it.id === itemId);
  if (!registered) return reply.status(400).send({ error: new UnregisteredBulkItemError(itemId).message });
  const filename = header(request, "x-upload-filename");
  if (!filename) return reply.status(400).send({ error: "X-Upload-Filename header required" });

  const gate = beginStream(id, itemId);
  if (gate === "duplicate") return reply.status(409).send({ error: "This item is already uploading" });
  if (gate === "too-many") {
    return reply.status(409).send({ error: "Too many concurrent uploads for this batch; retry shortly" });
  }
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
    // Seal-barrier races (session sealed / item unregistered under the lock).
    if (error instanceof StagingSessionNotOpenError) return reply.status(409).send({ error: error.message });
    if (error instanceof StagingItemNotRegisteredError) return reply.status(409).send({ error: error.message });
    if (error instanceof StagingSessionGoneError) return reply.status(404).send({ error: "Session not found" });
    throw error;
  } finally {
    endStream(id, itemId);
  }
}

export async function registerBulkUploadRoutes(options: RegisterBulkUploadRoutesOptions): Promise<void> {
  const { server, boxRoot, eventBus } = options;

  await server.register(async (instance) => {
    installOctetStreamPassthrough(instance);

    // POST /api/bulk/sessions — create a bulk batch bound to a target chat.
    instance.post<{ Body: unknown }>("/api/bulk/sessions", (request, reply) =>
      handleCreateBulkSession({ boxRoot, request, reply }),
    );

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
        const registryError = registryAdditionError({ existing: session.expectedItems ?? [], incoming: parsed.data.items });
        if (registryError !== null) return reply.status(400).send({ error: registryError });
        try {
          await registerBulkItems({ boxRoot, id: session.id, items: parsed.data.items });
        } catch (error) {
          // The seal froze the registry between the pre-lock check and the lock.
          if (error instanceof StagingSessionNotOpenError) return reply.status(409).send({ error: error.message });
          throw error;
        }
        const updated = await readStagingSession({ boxRoot, id: session.id });
        return { registered: updated?.expectedItems?.length ?? 0 };
      },
    );

    // POST /api/bulk/sessions/:id/items/:itemId/upload — stream one item's bytes.
    instance.post<{ Params: { id: string; itemId: string } }>(
      "/api/bulk/sessions/:id/items/:itemId/upload",
      (request: FastifyRequest<{ Params: { id: string; itemId: string } }>, reply) =>
        handleUploadBulkItem({ boxRoot, request, reply }),
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

        // The uploader's failed-item report and the user's introduction ride IN
        // the CAS seal — one atomic write, so a resume can never see a sealed
        // batch whose failed list or note wasn't recorded yet.
        //
        // A whitespace-only note normalizes to absent so an empty composer
        // produces byte-identical output to a batch that never had one.
        const trimmedNote = parsed.data.note?.trim();
        const seal = await sealStagingSession({
          boxRoot,
          id: session.id,
          failedItems: parsed.data.failedItems,
          note: trimmedNote !== undefined && trimmedNote !== "" ? trimmedNote : undefined,
        });
        if (seal.sealed) {
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

  // Resume mid-flight batches on startup + start the periodic reconciliation /
  // abandonment / unfiled-batch sweep. The chat runtime is registered first.
  startBulkUploadLifecycle({ server, boxRoot, eventBus });
}
