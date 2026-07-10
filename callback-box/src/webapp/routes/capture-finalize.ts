/**
 * Capture session finalization — turn an accumulated session's temp files into
 * cards in the box.
 *
 * On finalize, a capture-session card lands at `box/inbox/<basename>.capture-session.card`,
 * and its attach scope (`box/inbox/<basename>.attach/`) holds the audio/image/file
 * cards plus their attached media (each child has its own attach scope inside).
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { stageAndCommitPaths } from "../../lib/git.js";
import { createAudioTemplate } from "../../schemas/audio.js";
import { createImageTemplate } from "../../schemas/image.js";
import { createFileTemplate } from "../../schemas/file.js";
import { createCaptureSessionTemplate } from "../../schemas/capture-session.js";
import { createScheduledScriptTemplate } from "../../schemas/scheduled-script.js";
import type { CaptureFile, CaptureSessionData } from "./capture-session-store.js";
import { sessionDir, cleanupSession } from "./capture-session-store.js";

interface FinalizeResult {
  cards: string[];
}

/**
 * Accumulates the media + cards written for one session, tracking which paths
 * need git staging and the per-type card refs that the session card links to.
 */
class SessionBuilder {
  readonly filesToStage: string[] = [];
  readonly audioRefs: string[] = [];
  readonly imageRefs: string[] = [];
  readonly fileRefs: string[] = [];

  private readonly boxRoot: string;
  private readonly sessionAttachRelDir: string;
  private readonly sessionAttachAbsDir: string;

  constructor(opts: {
    boxRoot: string;
    sessionAttachRelDir: string;
    sessionAttachAbsDir: string;
  }) {
    this.boxRoot = opts.boxRoot;
    this.sessionAttachRelDir = opts.sessionAttachRelDir;
    this.sessionAttachAbsDir = opts.sessionAttachAbsDir;
  }

  /**
   * Each child card (audio/image/file) gets its own attach scope holding the
   * bound media. Writes the media + card and records both for staging.
   */
  async writeChildCard(opts: {
    childBasename: string;
    cardType: string;
    mediaFilename: string;
    mediaContent: Buffer;
    cardContent: string;
  }): Promise<void> {
    const childAttachRel = `${this.sessionAttachRelDir}/${opts.childBasename}.attach`;
    const childAttachAbs = path.join(this.boxRoot, childAttachRel);
    await fs.mkdir(childAttachAbs, { recursive: true });
    const mediaAbsPath = path.join(childAttachAbs, opts.mediaFilename);
    await fs.writeFile(mediaAbsPath, opts.mediaContent);
    this.filesToStage.push(`${childAttachRel}/${opts.mediaFilename}`);

    const cardFilename = `${opts.childBasename}.${opts.cardType}.card`;
    const cardAbsPath = path.join(this.sessionAttachAbsDir, cardFilename);
    await fs.writeFile(cardAbsPath, opts.cardContent);
    this.filesToStage.push(`${this.sessionAttachRelDir}/${cardFilename}`);
  }
}

/**
 * Concatenate audio chunks into a single WebM file + create its audio card.
 * MediaRecorder with timeslice produces chunks where only the first has the
 * WebM/EBML header; subsequent chunks are raw Clusters. Concatenating them
 * produces a valid WebM file. Individual chunks (except the first) are not
 * playable or transcribable on their own. Returns the latest timestamp seen.
 */
async function writeAudioCard(opts: {
  builder: SessionBuilder;
  tmpDir: string;
  audioChunks: CaptureFile[];
}): Promise<string> {
  const { builder, tmpDir, audioChunks } = opts;
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

  await builder.writeChildCard({
    childBasename: audioBasename,
    cardType: "audio",
    mediaFilename,
    mediaContent: concatenated,
    cardContent,
  });
  builder.audioRefs.push(`${audioBasename}.audio.card`);

  return audioChunks[audioChunks.length - 1]!.startedAt;
}

/** Create image cards + copy media files. Returns the latest timestamp seen. */
async function writeImageCards(opts: {
  builder: SessionBuilder;
  tmpDir: string;
  photoFiles: CaptureFile[];
  endedAt: string;
}): Promise<string> {
  const { builder, tmpDir, photoFiles } = opts;
  let { endedAt } = opts;
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

    await builder.writeChildCard({
      childBasename: photoBasename,
      cardType: "image",
      mediaFilename,
      mediaContent,
      cardContent,
    });
    builder.imageRefs.push(`${photoBasename}.image.card`);

    if (file.startedAt > endedAt) endedAt = file.startedAt;
  }
  return endedAt;
}

/** Copy uploaded files + create file cards. Returns the latest timestamp seen. */
async function writeFileCards(opts: {
  builder: SessionBuilder;
  tmpDir: string;
  uploadedFiles: CaptureFile[];
  endedAt: string;
}): Promise<string> {
  const { builder, tmpDir, uploadedFiles } = opts;
  let { endedAt } = opts;
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

    await builder.writeChildCard({
      childBasename: baseWithoutExt,
      cardType: "file",
      mediaFilename,
      mediaContent,
      cardContent,
    });
    builder.fileRefs.push(`${baseWithoutExt}.file.card`);

    if (file.startedAt > endedAt) endedAt = file.startedAt;
  }
  return endedAt;
}

/** Commit all staged media + cards in a single commit summarizing the counts. */
async function commitSession(opts: {
  boxRoot: string;
  builder: SessionBuilder;
}): Promise<void> {
  const { boxRoot, builder } = opts;
  if (builder.filesToStage.length === 0) return;
  const parts: string[] = [];
  if (builder.audioRefs.length > 0) parts.push(`${builder.audioRefs.length} audio`);
  if (builder.imageRefs.length > 0) parts.push(`${builder.imageRefs.length} photos`);
  if (builder.fileRefs.length > 0) parts.push(`${builder.fileRefs.length} files`);
  await stageAndCommitPaths(boxRoot, {
    paths: builder.filesToStage,
    message: `Capture session: ${parts.join(", ")}`,
    trailers: { "Created-By": "capture" },
  });
}

/** Build the deterministic `capture-YYYYMMDDTHHMM-shortId` basename. */
function sessionBasenameFor(opts: { actualStartedAt: string; id: string }): string {
  // Format: capture-YYYYMMDDTHHMM-shortId (using actual capture time)
  const startDate = new Date(opts.actualStartedAt);
  const datePart = startDate.toISOString().slice(0, 16).replace(/[:-]/g, "").replace("T", "T");
  // e.g. 20260310T1924
  const formattedDate = `${datePart.slice(0, 8)}T${datePart.slice(9, 13)}`;
  const shortId = opts.id.slice(0, 8);
  return `capture-${formattedDate}-${shortId}`;
}

/**
 * Turn an accumulated session into cards + a single commit, then clean up the
 * temp dir. Returns the relative paths of the session card(s) created (empty
 * when the session had no files). Pure orchestration; route handler adapts the
 * HTTP shape and broadcasts.
 */
export async function finalizeSession(opts: {
  session: CaptureSessionData;
  boxRoot: string;
}): Promise<FinalizeResult> {
  const { session, boxRoot } = opts;
  const tmpDir = sessionDir(session.id);

  if (session.files.length === 0) {
    await cleanupSession(session.id);
    return { cards: [] };
  }

  const audioChunks = session.files.filter((f) => f.name.startsWith("audio-"));
  const photoFiles = session.files.filter((f) => f.name.startsWith("photo-"));
  const uploadedFiles = session.files.filter((f) => f.name.startsWith("file-"));

  // Compute actual start/end from file timestamps (client-provided),
  // not session creation time (server-provided) which may differ significantly
  // if the capture page was open a long time before the user took photos.
  const allFileTimestamps = session.files.map((f) => f.startedAt).toSorted();
  const actualStartedAt = allFileTimestamps[0] || session.startedAt;
  let endedAt = actualStartedAt;

  const sessionBasename = sessionBasenameFor({ actualStartedAt, id: session.id });
  // Session card lives at inbox level; its attach scope holds the children.
  const inboxRelDir = "box/inbox";
  const sessionAttachRelDir = `${inboxRelDir}/${sessionBasename}.attach`;
  const sessionAttachAbsDir = path.join(boxRoot, sessionAttachRelDir);
  const inboxAbsDir = path.join(boxRoot, inboxRelDir);

  await fs.mkdir(sessionAttachAbsDir, { recursive: true });

  console.log(`[capture] Finalizing session ${session.id} → ${sessionBasename}: ${audioChunks.length} audio chunks, ${photoFiles.length} photos, ${uploadedFiles.length} files`);

  const builder = new SessionBuilder({ boxRoot, sessionAttachRelDir, sessionAttachAbsDir });

  if (audioChunks.length > 0) {
    const lastAudioAt = await writeAudioCard({ builder, tmpDir, audioChunks });
    if (lastAudioAt > endedAt) endedAt = lastAudioAt;
  }
  endedAt = await writeImageCards({ builder, tmpDir, photoFiles, endedAt });
  endedAt = await writeFileCards({ builder, tmpDir, uploadedFiles, endedAt });

  // Create capture-session card at the inbox level
  const sessionCardFilename = `${sessionBasename}.capture-session.card`;
  const sessionCardContent = createCaptureSessionTemplate({
    sessionId: session.id,
    startedAt: actualStartedAt,
    endedAt,
    imageRefs: builder.imageRefs,
    audioRefs: builder.audioRefs,
    fileRefs: builder.fileRefs,
  });
  const sessionCardPath = path.join(inboxAbsDir, sessionCardFilename);
  await fs.writeFile(sessionCardPath, sessionCardContent);
  builder.filesToStage.push(`${inboxRelDir}/${sessionCardFilename}`);

  await commitSession({ boxRoot, builder });

  // Create one-shot scheduled script to trigger process-captures on next wakeup
  await createProcessCapturesTrigger(boxRoot);

  // Clean up temp dir and release the session lock together.
  await cleanupSession(session.id);

  const sessionCardRelPath = `${inboxRelDir}/${sessionCardFilename}`;
  console.log(`[capture] Created capture session: ${sessionCardRelPath}`);

  return { cards: [sessionCardRelPath] };
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
