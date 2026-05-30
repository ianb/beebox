/**
 * Capture session routes — audio recording + photo capture from the web UI.
 *
 * Sessions accumulate files in a temp directory. Session metadata is stored
 * as session.json inside the temp dir so it survives server restarts (see
 * capture-session-store.ts). On finalize, a capture-session card lands at
 * `box/inbox/<basename>.capture-session.card`, and its attach scope holds the
 * audio/image/file cards plus their attached media (see capture-finalize.ts).
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import type { EventBus } from "../../core/event-bus.js";
import type { CaptureSessionData, CaptureFile } from "./capture-session-store.js";
import {
  sessionDir,
  readSession,
  writeSession,
  withSessionLock,
  releaseSessionLock,
  cleanupDir,
} from "./capture-session-store.js";
import { finalizeSession } from "./capture-finalize.js";

class SessionDisappearedError extends Error {
  constructor() {
    super("Session disappeared during upload");
    this.name = "SessionDisappearedError";
  }
}

interface RegisterCaptureRoutesOptions {
  server: FastifyInstance;
  boxRoot: string;
  boxSlug: string;
  eventBus: EventBus;
}

export async function registerCaptureRoutes(
  options: RegisterCaptureRoutesOptions
): Promise<void> {
  const { server, boxRoot, boxSlug, eventBus } = options;

  // POST /api/capture/sessions — create a new capture session
  server.post("/api/capture/sessions", async (_request, _reply) => {
    const id = randomUUID();
    const dir = sessionDir(id);
    await fs.mkdir(dir, { recursive: true });

    const session: CaptureSessionData = {
      id,
      boxSlug,
      files: [],
      startedAt: new Date().toISOString(),
    };
    await writeSession(session);

    return { sessionId: id, startedAt: session.startedAt };
  });

  // POST /api/capture/sessions/:id/upload — upload a file to the session
  server.post<{
    Params: { id: string };
  }>("/api/capture/sessions/:id/upload", async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const session = await readSession(request.params.id);
    if (!session) {
      return reply.status(404).send({ error: "Session not found" });
    }

    const filename = request.headers["x-capture-filename"] as string;
    const source = (request.headers["x-capture-source"] as string) || "unknown";
    const startedAt = (request.headers["x-capture-started-at"] as string) || new Date().toISOString();
    const originalName = (request.headers["x-capture-original-name"] as string) || undefined;
    const mimeType = (request.headers["x-capture-mime-type"] as string) || undefined;

    if (!filename) {
      return reply.status(400).send({ error: "X-Capture-Filename header required" });
    }

    // Guard against path traversal via the filename header.
    const dir = sessionDir(session.id);
    const resolved = path.resolve(path.join(dir, filename));
    if (!resolved.startsWith(path.resolve(dir) + path.sep)) {
      return reply.status(400).send({ error: "Invalid filename" });
    }

    // Read raw body as buffer
    const buffer = await request.file();
    let fileBuffer: Buffer;
    if (buffer) {
      fileBuffer = await buffer.toBuffer();
    } else {
      // Fall back to raw body if not multipart
      const rawBody = request.body;
      if (rawBody instanceof Buffer) {
        fileBuffer = rawBody;
      } else {
        console.error(`[capture] No file data in upload for session ${session.id}, filename: ${filename}`);
        return reply.status(400).send({ error: "No file data received" });
      }
    }

    await fs.writeFile(resolved, fileBuffer);

    const record: CaptureFile = {
      name: filename,
      source,
      startedAt,
      size: fileBuffer.length,
    };
    if (originalName) record.originalName = originalName;
    if (mimeType) record.mimeType = mimeType;

    // Serialize session.json updates — concurrent uploads to the same session
    // would otherwise read-modify-write and drop each other's file records.
    await withSessionLock(session.id, async () => {
      const current = await readSession(session.id);
      if (!current) throw new SessionDisappearedError();
      current.files.push(record);
      await writeSession(current);
    });

    console.log(`[capture] Uploaded ${filename} (${fileBuffer.length} bytes) to session ${session.id}`);
    return { success: true, filename, size: fileBuffer.length };
  });

  // DELETE /api/capture/sessions/:id — cancel and discard session
  server.delete<{
    Params: { id: string };
  }>("/api/capture/sessions/:id", async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const session = await readSession(request.params.id);
    if (!session) {
      return reply.status(404).send({ error: "Session not found" });
    }
    await cleanupDir(sessionDir(session.id));
    releaseSessionLock(session.id);
    return { success: true };
  });

  // POST /api/capture/sessions/:id/finalize — create capture-session directory
  server.post<{
    Params: { id: string };
  }>("/api/capture/sessions/:id/finalize", async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const session = await readSession(request.params.id);
    if (!session) {
      return reply.status(404).send({ error: "Session not found" });
    }

    const { cards } = await finalizeSession({ session, boxRoot });

    // Broadcast (only when a session card was actually created)
    const timestamp = new Date().toISOString();
    for (const cardPath of cards) {
      eventBus.emit("card-created", {
        path: cardPath,
        template: "capture-session",
        timestamp,
      });
    }

    return { success: true, cards };
  });
}
