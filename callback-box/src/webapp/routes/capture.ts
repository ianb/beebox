/**
 * Capture session routes — audio recording + photo capture from the web UI.
 *
 * Sessions accumulate files in a temp directory. On finalize, a memo card
 * is created in box/inbox/ with all files as attachments.
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { randomUUID } from "node:crypto";
import type { EventBus } from "../../core/event-bus.js";
import {
  runCommand,
  type CommandContext,
} from "../../core/commands/index.js";

interface CaptureSession {
  id: string;
  dir: string;
  files: CaptureFile[];
  startedAt: string;
}

interface CaptureFile {
  name: string;
  source: string;
  startedAt: string;
  size: number;
}

// In-memory session store (sessions are short-lived)
const sessions = new Map<string, CaptureSession>();

interface RegisterCaptureRoutesOptions {
  server: FastifyInstance;
  boxRoot: string;
  eventBus: EventBus;
}

export async function registerCaptureRoutes(
  options: RegisterCaptureRoutesOptions
): Promise<void> {
  const { server, boxRoot, eventBus } = options;

  // POST /api/capture/sessions — create a new capture session
  server.post("/api/capture/sessions", async (_request, _reply) => {
    const id = randomUUID();
    const dir = path.join(os.tmpdir(), "callback-box-capture", id);
    await fs.mkdir(dir, { recursive: true });

    const session: CaptureSession = {
      id,
      dir,
      files: [],
      startedAt: new Date().toISOString(),
    };
    sessions.set(id, session);

    return { sessionId: id, startedAt: session.startedAt };
  });

  // POST /api/capture/sessions/:id/upload — upload a file to the session
  server.post<{
    Params: { id: string };
  }>("/api/capture/sessions/:id/upload", async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const session = sessions.get(request.params.id);
    if (!session) {
      return reply.status(404).send({ error: "Session not found" });
    }

    const filename = request.headers["x-capture-filename"] as string;
    const source = (request.headers["x-capture-source"] as string) || "unknown";
    const startedAt = (request.headers["x-capture-started-at"] as string) || new Date().toISOString();

    if (!filename) {
      return reply.status(400).send({ error: "X-Capture-Filename header required" });
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
        return reply.status(400).send({ error: "No file data received" });
      }
    }

    const filePath = path.join(session.dir, filename);
    await fs.writeFile(filePath, fileBuffer);

    session.files.push({
      name: filename,
      source,
      startedAt,
      size: fileBuffer.length,
    });

    return { success: true, filename, size: fileBuffer.length };
  });

  // DELETE /api/capture/sessions/:id — cancel and discard session
  server.delete<{
    Params: { id: string };
  }>("/api/capture/sessions/:id", async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const session = sessions.get(request.params.id);
    if (!session) {
      return reply.status(404).send({ error: "Session not found" });
    }
    sessions.delete(session.id);
    await cleanupDir(session.dir);
    return { success: true };
  });

  // POST /api/capture/sessions/:id/finalize — create card(s) from session files
  server.post<{
    Params: { id: string };
  }>("/api/capture/sessions/:id/finalize", async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const session = sessions.get(request.params.id);
    if (!session) {
      return reply.status(404).send({ error: "Session not found" });
    }

    if (session.files.length === 0) {
      // Nothing to do — clean up
      sessions.delete(session.id);
      await cleanupDir(session.dir);
      return { success: true, cards: [] };
    }

    const createdCards: string[] = [];
    const now = new Date();
    const timestamp = now.toISOString().replace(/[.:]/g, "-").slice(0, 19);

    const ctx: CommandContext = {
      boxRoot,
      write: () => {},
      writeLine: () => {},
    };

    // Create one memo card per file for simplicity
    // Audio chunks with the same prefix get grouped into a single card
    const audioFiles = session.files.filter((f) => f.name.startsWith("audio-"));
    const photoFiles = session.files.filter((f) => f.name.startsWith("photo-"));
    const otherFiles = session.files.filter(
      (f) => !f.name.startsWith("audio-") && !f.name.startsWith("photo-")
    );

    // Create voice memo from audio files (use first chunk as the attachment)
    if (audioFiles.length > 0) {
      const firstAudio = audioFiles[0];
      if (firstAudio) {
        const tempPath = path.join(session.dir, firstAudio.name);
        const cardName = `Capture_${timestamp}`;
        const cardPath = `box/inbox/${cardName}.memo.card`;

        // Determine mimetype from extension
        const mimetype = firstAudio.name.endsWith(".webm") ? "audio/webm" : "audio/webm";

        const result = await runCommand({
          name: "create",
          args: {
            path: cardPath,
            template: "voice-memo",
            attachment: tempPath,
            attachmentMimetype: mimetype,
            commit: true,
          },
          ctx,
        });

        if (result.success) {
          const resultData = result.data as { cardPath: string };
          createdCards.push(resultData.cardPath);
        }

        // Copy additional audio chunks alongside the card
        for (let i = 1; i < audioFiles.length; i++) {
          const chunk = audioFiles[i];
          if (!chunk) continue;
          const srcPath = path.join(session.dir, chunk.name);
          const destPath = path.join(boxRoot, `box/inbox/${cardName}-${chunk.name}`);
          try {
            await fs.copyFile(srcPath, destPath);
          } catch (e) {
            console.error(`Failed to copy audio chunk ${chunk.name}:`, e);
          }
        }
      }
    }

    // Create cards for photos
    for (const photo of photoFiles) {
      const tempPath = path.join(session.dir, photo.name);
      const ext = photo.name.endsWith(".png") ? "png" : "jpg";
      const cardName = `Photo_${timestamp}_${photo.name.replace(/\.[^.]+$/, "")}`;
      const cardPath = `box/inbox/${cardName}.memo.card`;
      const mimetype = ext === "png" ? "image/png" : "image/jpeg";

      const result = await runCommand({
        name: "create",
        args: {
          path: cardPath,
          template: "memo",
          attachment: tempPath,
          attachmentMimetype: mimetype,
          commit: true,
        },
        ctx,
      });

      if (result.success) {
        const resultData = result.data as { cardPath: string };
        createdCards.push(resultData.cardPath);
      }
    }

    // Handle other files similarly to photos
    for (const file of otherFiles) {
      const tempPath = path.join(session.dir, file.name);
      const cardName = `Capture_${timestamp}_${file.name.replace(/\.[^.]+$/, "")}`;
      const cardPath = `box/inbox/${cardName}.memo.card`;

      const result = await runCommand({
        name: "create",
        args: {
          path: cardPath,
          template: "memo",
          attachment: tempPath,
          commit: true,
        },
        ctx,
      });

      if (result.success) {
        const resultData = result.data as { cardPath: string };
        createdCards.push(resultData.cardPath);
      }
    }

    // Clean up
    sessions.delete(session.id);
    await cleanupDir(session.dir);

    // Broadcast
    for (const cardPath of createdCards) {
      eventBus.emit("card-created", {
        path: cardPath,
        template: "capture",
        timestamp: now.toISOString(),
      });
    }

    return { success: true, cards: createdCards };
  });
}

async function cleanupDir(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch (e) {
    console.error(`Failed to clean up capture session dir ${dir}:`, e);
  }
}
