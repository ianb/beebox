/**
 * Capture session routes — audio recording + photo capture from the web UI.
 *
 * Sessions accumulate files in a temp directory. Session metadata is stored
 * as session.json inside the temp dir so it survives server restarts.
 * On finalize, a capture-session directory is created in box/inbox/ with
 * audio.card, image.card, and capture-session.card files matching the
 * structure expected by the process-captures procedure.
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { randomUUID } from "node:crypto";
import type { EventBus } from "../../core/event-bus.js";
import { stageFiles, commit } from "../../cli/lib/git.js";
import { createAudioTemplate } from "../../schemas/audio.js";
import { createImageTemplate } from "../../schemas/image.js";
import { createCaptureSessionTemplate } from "../../schemas/capture-session.js";

interface CaptureSessionData {
  id: string;
  boxSlug: string;
  files: CaptureFile[];
  startedAt: string;
}

interface CaptureFile {
  name: string;
  source: string;
  startedAt: string;
  size: number;
}

const SESSION_BASE = path.join(os.tmpdir(), "callback-box-capture");

function sessionDir(id: string): string {
  return path.join(SESSION_BASE, id);
}

function sessionJsonPath(id: string): string {
  return path.join(sessionDir(id), "session.json");
}

async function readSession(id: string): Promise<CaptureSessionData | null> {
  try {
    const raw = await fs.readFile(sessionJsonPath(id), "utf-8");
    return JSON.parse(raw);
  } catch (_e) {
    return null;
  }
}

async function writeSession(session: CaptureSessionData): Promise<void> {
  await fs.writeFile(sessionJsonPath(session.id), JSON.stringify(session, null, 2));
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
        console.error(`[capture] No file data in upload for session ${session.id}, filename: ${filename}`);
        return reply.status(400).send({ error: "No file data received" });
      }
    }

    const filePath = path.join(sessionDir(session.id), filename);
    await fs.writeFile(filePath, fileBuffer);

    session.files.push({
      name: filename,
      source,
      startedAt,
      size: fileBuffer.length,
    });
    await writeSession(session);

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

    if (session.files.length === 0) {
      await cleanupDir(sessionDir(session.id));
      return { success: true, cards: [] };
    }

    const tmpDir = sessionDir(session.id);
    const now = new Date();
    // Format: capture-YYYYMMDDTHHMM-shortId
    const startDate = new Date(session.startedAt);
    const datePart = startDate.toISOString().slice(0, 16).replace(/[:-]/g, "").replace("T", "T");
    // e.g. 20260310T1924
    const formattedDate = `${datePart.slice(0, 8)}T${datePart.slice(9, 13)}`;
    const shortId = session.id.slice(0, 8);
    const sessionDirName = `capture-${formattedDate}-${shortId}`;
    const sessionRelDir = `box/inbox/${sessionDirName}`;
    const sessionAbsDir = path.join(boxRoot, sessionRelDir);

    await fs.mkdir(sessionAbsDir, { recursive: true });

    const audioFiles = session.files.filter((f) => f.name.startsWith("audio-"));
    const photoFiles = session.files.filter((f) => f.name.startsWith("photo-"));

    console.log(`[capture] Finalizing session ${session.id} → ${sessionDirName}: ${audioFiles.length} audio, ${photoFiles.length} photos`);

    const filesToStage: string[] = [];
    const audioRefs: string[] = [];
    const imageRefs: string[] = [];
    let endedAt = session.startedAt;

    // Create audio cards + copy media files
    for (const [i, file] of audioFiles.entries()) {
      const idx = String(i + 1).padStart(3, "0");
      const audioBasename = `audio-${idx}`;
      const ext = file.name.endsWith(".webm") ? ".webm" : ".webm";
      const mediaFilename = `${audioBasename}${ext}`;
      const cardFilename = `${audioBasename}.audio.card`;

      // Copy media file
      const srcPath = path.join(tmpDir, file.name);
      const destMediaPath = path.join(sessionAbsDir, mediaFilename);
      await fs.copyFile(srcPath, destMediaPath);
      filesToStage.push(`${sessionRelDir}/${mediaFilename}`);

      // Create audio card
      const cardContent = createAudioTemplate({
        recordedAt: file.startedAt,
        source: file.source,
        filename: mediaFilename,
      });
      const destCardPath = path.join(sessionAbsDir, cardFilename);
      await fs.writeFile(destCardPath, cardContent);
      filesToStage.push(`${sessionRelDir}/${cardFilename}`);
      audioRefs.push(cardFilename);

      // Track latest timestamp for session end
      if (file.startedAt > endedAt) {
        endedAt = file.startedAt;
      }
    }

    // Create image cards + copy media files
    for (const [i, file] of photoFiles.entries()) {
      const idx = String(i + 1).padStart(3, "0");
      const photoBasename = `photo-${idx}`;
      const ext = file.name.endsWith(".png") ? ".png" : ".jpg";
      const mediaFilename = `${photoBasename}${ext}`;
      const cardFilename = `${photoBasename}.image.card`;

      // Determine camera source from upload source header
      const imageSource = file.source === "camera-environment" ? "camera-environment" : "camera-user";

      // Copy media file
      const srcPath = path.join(tmpDir, file.name);
      const destMediaPath = path.join(sessionAbsDir, mediaFilename);
      await fs.copyFile(srcPath, destMediaPath);
      filesToStage.push(`${sessionRelDir}/${mediaFilename}`);

      // Create image card
      const cardContent = createImageTemplate({
        capturedAt: file.startedAt,
        source: imageSource,
        filename: mediaFilename,
      });
      const destCardPath = path.join(sessionAbsDir, cardFilename);
      await fs.writeFile(destCardPath, cardContent);
      filesToStage.push(`${sessionRelDir}/${cardFilename}`);
      imageRefs.push(cardFilename);

      if (file.startedAt > endedAt) {
        endedAt = file.startedAt;
      }
    }

    // Create capture-session card
    const sessionCardFilename = `${sessionDirName}.capture-session.card`;
    const sessionCardContent = createCaptureSessionTemplate({
      sessionId: session.id,
      startedAt: session.startedAt,
      endedAt,
      imageRefs,
      audioRefs,
    });
    const sessionCardPath = path.join(sessionAbsDir, sessionCardFilename);
    await fs.writeFile(sessionCardPath, sessionCardContent);
    filesToStage.push(`${sessionRelDir}/${sessionCardFilename}`);

    // Single commit for the whole session
    if (filesToStage.length > 0) {
      await stageFiles(boxRoot, filesToStage);
      await commit(boxRoot, {
        message: `Capture session: ${audioRefs.length} audio, ${imageRefs.length} photos`,
        trailers: { "Created-By": "capture" },
      });
    }

    // Clean up temp dir
    await cleanupDir(tmpDir);

    const sessionCardRelPath = `${sessionRelDir}/${sessionCardFilename}`;
    console.log(`[capture] Created capture session: ${sessionCardRelPath}`);

    // Broadcast
    eventBus.emit("card-created", {
      path: sessionCardRelPath,
      template: "capture-session",
      timestamp: now.toISOString(),
    });

    return { success: true, cards: [sessionCardRelPath] };
  });
}

async function cleanupDir(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch (e) {
    console.error(`[capture] Failed to clean up dir ${dir}:`, e);
  }
}
