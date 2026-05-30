/**
 * Capture session routes — audio recording + photo capture from the web UI.
 *
 * Sessions accumulate files in a temp directory. Session metadata is stored
 * as session.json inside the temp dir so it survives server restarts.
 * On finalize, a capture-session card lands at `box/inbox/<basename>.capture-session.card`,
 * and its attach scope (`box/inbox/<basename>.attach/`) holds the audio/image/file
 * cards plus their attached media (each child has its own attach scope inside).
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
import { createFileTemplate } from "../../schemas/file.js";
import { createCaptureSessionTemplate } from "../../schemas/capture-session.js";
import { createScheduledScriptTemplate } from "../../schemas/scheduled-script.js";

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
  originalName?: string;
  mimeType?: string;
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

/**
 * Per-session mutex. Concurrent uploads for the same session read-modify-write
 * session.json; without serialization they race and drop entries. The map
 * stores the tail of a promise chain for each session id; each new task
 * appends itself after the tail.
 */
const sessionLocks = new Map<string, Promise<void>>();

async function withSessionLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const previous = sessionLocks.get(id) ?? Promise.resolve();
  const done = previous.then(fn);
  // Store a version that always resolves, so one failure doesn't break the chain.
  sessionLocks.set(id, done.then(
    () => {},
    () => {},
  ));
  return done;
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
      if (!current) throw new Error("Session disappeared during upload");
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
    sessionLocks.delete(session.id);
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

    const audioChunks = session.files.filter((f) => f.name.startsWith("audio-"));
    const photoFiles = session.files.filter((f) => f.name.startsWith("photo-"));
    const uploadedFiles = session.files.filter((f) => f.name.startsWith("file-"));

    // Compute actual start/end from file timestamps (client-provided),
    // not session creation time (server-provided) which may differ significantly
    // if the capture page was open a long time before the user took photos.
    const allFileTimestamps = session.files.map((f) => f.startedAt).toSorted();
    const actualStartedAt = allFileTimestamps[0] || session.startedAt;
    let endedAt = actualStartedAt;

    // Format: capture-YYYYMMDDTHHMM-shortId (using actual capture time)
    const startDate = new Date(actualStartedAt);
    const datePart = startDate.toISOString().slice(0, 16).replace(/[:-]/g, "").replace("T", "T");
    // e.g. 20260310T1924
    const formattedDate = `${datePart.slice(0, 8)}T${datePart.slice(9, 13)}`;
    const shortId = session.id.slice(0, 8);
    const sessionBasename = `capture-${formattedDate}-${shortId}`;
    // Session card lives at inbox level; its attach scope holds the children.
    const inboxRelDir = "box/inbox";
    const sessionAttachRelDir = `${inboxRelDir}/${sessionBasename}.attach`;
    const sessionAttachAbsDir = path.join(boxRoot, sessionAttachRelDir);
    const inboxAbsDir = path.join(boxRoot, inboxRelDir);

    await fs.mkdir(sessionAttachAbsDir, { recursive: true });

    console.log(`[capture] Finalizing session ${session.id} → ${sessionBasename}: ${audioChunks.length} audio chunks, ${photoFiles.length} photos, ${uploadedFiles.length} files`);

    const filesToStage: string[] = [];
    const audioRefs: string[] = [];
    const imageRefs: string[] = [];
    const fileRefs: string[] = [];

    // Each child card (audio/image/file) gets its own attach scope holding
    // the bound media. Helper writes media + card + returns the ref filename.
    async function writeChildCard(opts: {
      childBasename: string;
      cardType: string;
      mediaFilename: string;
      mediaContent: Buffer;
      cardContent: string;
    }): Promise<void> {
      const childAttachRel = `${sessionAttachRelDir}/${opts.childBasename}.attach`;
      const childAttachAbs = path.join(boxRoot, childAttachRel);
      await fs.mkdir(childAttachAbs, { recursive: true });
      const mediaAbsPath = path.join(childAttachAbs, opts.mediaFilename);
      await fs.writeFile(mediaAbsPath, opts.mediaContent);
      filesToStage.push(`${childAttachRel}/${opts.mediaFilename}`);

      const cardFilename = `${opts.childBasename}.${opts.cardType}.card`;
      const cardAbsPath = path.join(sessionAttachAbsDir, cardFilename);
      await fs.writeFile(cardAbsPath, opts.cardContent);
      filesToStage.push(`${sessionAttachRelDir}/${cardFilename}`);
    }

    // Concatenate audio chunks into a single file.
    // MediaRecorder with timeslice produces chunks where only the first has
    // the WebM/EBML header; subsequent chunks are raw Clusters. Concatenating
    // them produces a valid WebM file. Individual chunks (except the first)
    // are not playable or transcribable on their own.
    if (audioChunks.length > 0) {
      const audioBasename = "audio-001";
      const mediaFilename = `${audioBasename}.webm`;

      const chunkBuffers: Buffer[] = [];
      for (const chunk of audioChunks) {
        const srcPath = path.join(tmpDir, chunk.name);
        chunkBuffers.push(await fs.readFile(srcPath));
      }
      const concatenated = Buffer.concat(chunkBuffers);

      const firstChunk = audioChunks[0]!;
      const cardContent = createAudioTemplate({
        recordedAt: firstChunk.startedAt,
        source: firstChunk.source,
        filename: mediaFilename,
      });

      await writeChildCard({
        childBasename: audioBasename,
        cardType: "audio",
        mediaFilename,
        mediaContent: concatenated,
        cardContent,
      });
      audioRefs.push(`${audioBasename}.audio.card`);

      const lastChunk = audioChunks[audioChunks.length - 1]!;
      if (lastChunk.startedAt > endedAt) {
        endedAt = lastChunk.startedAt;
      }
    }

    // Create image cards + copy media files
    for (const [i, file] of photoFiles.entries()) {
      const idx = String(i + 1).padStart(3, "0");
      const photoBasename = `photo-${idx}`;
      const ext = file.name.endsWith(".png") ? ".png" : ".jpg";
      const mediaFilename = `${photoBasename}${ext}`;

      // Determine camera source from upload source header
      const imageSource = file.source === "camera-environment" ? "camera-environment" : "camera-user";

      const srcPath = path.join(tmpDir, file.name);
      const mediaContent = await fs.readFile(srcPath);

      const cardContent = createImageTemplate({
        capturedAt: file.startedAt,
        source: imageSource,
        filename: mediaFilename,
      });

      await writeChildCard({
        childBasename: photoBasename,
        cardType: "image",
        mediaFilename,
        mediaContent,
        cardContent,
      });
      imageRefs.push(`${photoBasename}.image.card`);

      if (file.startedAt > endedAt) {
        endedAt = file.startedAt;
      }
    }

    // Copy uploaded files + create file cards
    for (const file of uploadedFiles) {
      const mediaFilename = file.name; // stored as client-provided (file-NNN-<sanitized>.ext)
      const baseWithoutExt = mediaFilename.replace(/\.[^./]+$/, "");

      const srcPath = path.join(tmpDir, file.name);
      const mediaContent = await fs.readFile(srcPath);

      const cardOptions: Parameters<typeof createFileTemplate>[0] = {
        capturedAt: file.startedAt,
        source: file.source,
        filename: mediaFilename,
        size: file.size,
      };
      if (file.originalName) cardOptions.originalName = file.originalName;
      if (file.mimeType) cardOptions.mimeType = file.mimeType;
      const cardContent = createFileTemplate(cardOptions);

      await writeChildCard({
        childBasename: baseWithoutExt,
        cardType: "file",
        mediaFilename,
        mediaContent,
        cardContent,
      });
      fileRefs.push(`${baseWithoutExt}.file.card`);

      if (file.startedAt > endedAt) {
        endedAt = file.startedAt;
      }
    }

    // Create capture-session card at the inbox level
    const sessionCardFilename = `${sessionBasename}.capture-session.card`;
    const sessionCardContent = createCaptureSessionTemplate({
      sessionId: session.id,
      startedAt: actualStartedAt,
      endedAt,
      imageRefs,
      audioRefs,
      fileRefs,
    });
    const sessionCardPath = path.join(inboxAbsDir, sessionCardFilename);
    await fs.writeFile(sessionCardPath, sessionCardContent);
    filesToStage.push(`${inboxRelDir}/${sessionCardFilename}`);

    // Single commit for the whole session
    if (filesToStage.length > 0) {
      await stageFiles(boxRoot, filesToStage);
      const parts: string[] = [];
      if (audioRefs.length > 0) parts.push(`${audioRefs.length} audio`);
      if (imageRefs.length > 0) parts.push(`${imageRefs.length} photos`);
      if (fileRefs.length > 0) parts.push(`${fileRefs.length} files`);
      await commit(boxRoot, {
        message: `Capture session: ${parts.join(", ")}`,
        trailers: { "Created-By": "capture" },
      });
    }

    // Create one-shot scheduled script to trigger process-captures on next wakeup
    await createProcessCapturesTrigger(boxRoot);

    // Clean up temp dir
    await cleanupDir(tmpDir);
    sessionLocks.delete(session.id);

    const sessionCardRelPath = `${inboxRelDir}/${sessionCardFilename}`;
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

/**
 * Create a one-shot scheduled script that triggers process-captures
 * on the next wakeup. Idempotent — skips if the trigger already exists
 * (e.g. from a previous capture that hasn't been processed yet).
 */
async function createProcessCapturesTrigger(boxRoot: string): Promise<void> {
  const triggerPath = path.join(boxRoot, "config/schedules/process-captures.scheduled-script.card");
  try {
    await fs.access(triggerPath);
    // Already exists — the procedure will handle all pending sessions
    console.log("[capture] process-captures trigger already exists, skipping");
    return;
  } catch (_e) {
    // fs.access throwing means the trigger file doesn't exist yet, which is
    // the normal path here — fall through and create it. The specific error
    // carries no actionable info beyond "not present".
  }

  const content = createScheduledScriptTemplate({
    onWakeup: true,
    once: true,
    lockGroup: "captures",
    runs: "cb procedure run process-captures",
    description: "Process new capture sessions (auto-created by capture finalize)",
  });

  await fs.mkdir(path.dirname(triggerPath), { recursive: true });
  await fs.writeFile(triggerPath, content);
  console.log("[capture] Created process-captures trigger for next wakeup");
}
