/** One complete multipart upload seals capture independently of chat availability. */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import type { Services } from "../../../services/container.js";
import { quickCaptureDeclarationSchema, QUICK_CAPTURE_MAX_FILE_BYTES, QUICK_CAPTURE_MAX_DECLARATION_BYTES, type QuickCaptureDeclaration } from "../../../shared/quick-capture.js";
import { errnoCode } from "../../../shared/error-guards.js";
import { hashStreamToFile, StreamByteLimitError } from "../../../lib/hash-stream-to-file.js";
import { acceptQuickCapture, type CaptureBytes } from "../../../core/quick-capture/acceptance.js";
import { QuickCaptureError } from "../../../core/quick-capture/store.js";
import { resolveCaptureRequestOwner } from "../capture-request-owner.js";
import { startQuickCaptureLifecycle, scheduleCaptureProcessing } from "./runtime.js";

export async function registerQuickCaptureRoutes(args: { server: FastifyInstance; boxRoot: string; services: Services }): Promise<void> {
  const { server, boxRoot, services } = args;
  server.post<{ Params: { captureId: string } }>("/api/quick-captures/:captureId", async (request, reply) => {
    const parsedId = z.string().uuid().safeParse(request.params.captureId);
    if (!parsedId.success) return reply.status(400).send({ error: "Invalid capture ID." });
    const id = parsedId.data.toLowerCase();
    const owner = await resolveCaptureRequestOwner({ boxRoot, request });
    if (owner.status !== "ok") {
      const code = owner.status === "unauthenticated" ? 401 : owner.status === "auth-store-unavailable" ? 503 : 403;
      return reply.status(code).send({ error: owner.status === "ownerless-mobile" ? "Re-pair this device before using capture." : "Capture authentication unavailable." });
    }
    if (!request.isMultipart()) return reply.status(400).send({ error: "Capture requires a complete multipart request." });
    const tempDir = path.join(boxRoot, ".beebox", "quick-capture", ".uploads", randomUUID());
    try {
      await fs.mkdir(tempDir, { recursive: true, mode: 0o700 });
      const received = await receiveMultipart(request, tempDir);
      const receipt = await acceptQuickCapture({ boxRoot, id, owner: owner.email, ...received });
      scheduleCaptureProcessing({ boxRoot, services, owner: owner.email, id });
      return receipt;
    } catch (error) {
      return reportAcceptanceFailure({ error, reply, id });
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch((error: unknown) => {
        console.warn(`[quick-capture] scratch cleanup failed for ${id}:`, error);
      });
    }
  });
  startQuickCaptureLifecycle(args);
}

async function receiveMultipart(request: FastifyRequest, tempDir: string): Promise<{ declaration: QuickCaptureDeclaration; bytes?: CaptureBytes }> {
  let declaration: unknown;
  let bytes: CaptureBytes | undefined;
  let declarationSeen = false;
  for await (const part of request.parts({ limits: { files: 1, fields: 1, parts: 2, fieldSize: QUICK_CAPTURE_MAX_DECLARATION_BYTES, fileSize: QUICK_CAPTURE_MAX_FILE_BYTES } })) {
    if (part.type === "file") {
      if (part.fieldname !== "material" || bytes !== undefined) throw new QuickCaptureError({ reason: "unsupported-file-part" });
      const destPath = path.join(tempDir, "material");
      const result = await hashStreamToFile({ source: part.file, destPath, maxBytes: QUICK_CAPTURE_MAX_FILE_BYTES });
      if (part.file.truncated) throw new QuickCaptureError({ reason: "truncated-file" });
      bytes = { path: destPath, ...result };
    } else {
      if (part.fieldname !== "declaration" || declarationSeen || part.valueTruncated) throw new QuickCaptureError({ reason: "invalid-declaration-part" });
      declarationSeen = true;
      if (typeof part.value === "string") {
        try { declaration = JSON.parse(part.value); }
        catch (_error) { throw new QuickCaptureError({ reason: "invalid-declaration-json" }); }
      } else if (part.mimetype === "application/json") {
        // Multipart parses application/json fields before yielding them.
        declaration = part.value;
      } else throw new QuickCaptureError({ reason: "invalid-declaration-part" });
    }
  }
  const parsed = quickCaptureDeclarationSchema.safeParse(declaration);
  if (!parsed.success) throw new QuickCaptureError({ reason: "unsupported-declaration" });
  return { declaration: parsed.data, ...(bytes === undefined ? {} : { bytes }) };
}
function reportAcceptanceFailure(args: { error: unknown; reply: FastifyReply; id: string }): FastifyReply {
  const { error, reply, id } = args;
  if (error instanceof QuickCaptureError) return reply.status(captureErrorStatus(error.code)).send({ error: error.message });
  const code = errnoCode(error);
  if (error instanceof StreamByteLimitError || code === "FST_REQ_FILE_TOO_LARGE") return reply.status(413).send({ error: "Material exceeds the capture byte limit." });
  if (code !== undefined && ["FST_FILES_LIMIT", "FST_FIELDS_LIMIT", "FST_PARTS_LIMIT", "FST_INVALID_JSON_FIELD", "FST_PROTO_VIOLATION"].includes(code)) {
    return reply.status(400).send({ error: "Expected one complete declaration and its declared material." });
  }
  console.error(`[quick-capture] acceptance failed for ${id}:`, error);
  return reply.status(503).send({ error: "Capture could not be accepted. Keep your phone copy and retry." });
}

function captureErrorStatus(code: QuickCaptureError["code"]): number {
  const statuses = { invalid: 400, conflict: 409, forbidden: 403, gone: 410, "not-found": 404 };
  return statuses[code];
}
