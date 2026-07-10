/**
 * Capture session finalization — turn a staged session's uploaded media into
 * cards in the box.
 *
 * On finalize, a capture-session card lands at `box/inbox/<basename>.capture-session.card`,
 * and its attach scope (`box/inbox/<basename>.attach/`) holds the audio/image/file
 * cards plus their attached media (each child has its own attach scope inside).
 *
 * (Track 3 of the capture-mode plan replaces this inbox path with an in-chat
 * preparation worker; for now it keeps the `/capture` page working end-to-end
 * against the in-box staging store.)
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { stageFiles, commit } from "../../lib/git.js";
import { createAudioTemplate } from "../../schemas/audio.js";
import { createImageTemplate, type ImageSource } from "../../schemas/image.js";
import { createFileTemplate } from "../../schemas/file.js";
import { createCaptureSessionTemplate } from "../../schemas/capture-session.js";
import { createScheduledScriptTemplate } from "../../schemas/scheduled-script.js";
import { concatSegments, type SegmentChunks } from "../../core/capture/audio-concat.js";
import { computeEntry, saveManifest, emptyManifest } from "../../core/asset-manifest.js";
import type {
  StagingSession,
  StagingSegment,
  StagingPhoto,
  StagingFile,
} from "../../core/capture/staging-store.js";
import { stagingSessionDir, cleanupStagingSession } from "../../core/capture/staging-store.js";

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
   * bound media. The media bytes are gitignored assets tracked by a
   * `manifest.json` (size + sha256) — so we write the media, write its
   * manifest, and stage the *manifest* and card, never the raw bytes (see
   * docs/asset-manifests.md). Staging the bytes directly errors on any box
   * with the cb-assets `.gitignore` block.
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

    // Track the asset in the scope's manifest (committable), not the bytes.
    const manifest = emptyManifest();
    manifest.files[opts.mediaFilename] = await computeEntry(mediaAbsPath);
    await saveManifest(childAttachAbs, manifest);
    this.filesToStage.push(`${childAttachRel}/manifest.json`);

    const cardFilename = `${opts.childBasename}.${opts.cardType}.card`;
    const cardAbsPath = path.join(this.sessionAttachAbsDir, cardFilename);
    await fs.writeFile(cardAbsPath, opts.cardContent);
    this.filesToStage.push(`${this.sessionAttachRelDir}/${cardFilename}`);
  }
}

/**
 * Write one audio card per recording segment. Chunks are concatenated *within*
 * a segment only (`concatSegments` — only the first chunk of a recording has
 * the WebM/EBML header). Cards are numbered `audio-001`, `audio-002`, … and
 * each card's `filename.recorded` is its segment's `startedAt`.
 */
async function writeAudioCards(opts: {
  builder: SessionBuilder;
  sessionDir: string;
  segments: StagingSegment[];
}): Promise<void> {
  const { builder, sessionDir, segments } = opts;

  const segmentBuffers: SegmentChunks[] = [];
  for (const segment of segments) {
    const chunks: Buffer[] = [];
    for (const chunkFilename of segment.chunks) {
      chunks.push(await fs.readFile(path.join(sessionDir, chunkFilename)));
    }
    segmentBuffers.push({ segmentId: segment.id, startedAt: segment.startedAt, chunks });
  }

  const concatenated = concatSegments(segmentBuffers);
  for (const [i, segment] of concatenated.entries()) {
    const audioBasename = `audio-${String(i + 1).padStart(3, "0")}`;
    const mediaFilename = `${audioBasename}.webm`;
    const cardContent = createAudioTemplate({
      recordedAt: segment.startedAt,
      source: "microphone",
      filename: mediaFilename,
    });
    await builder.writeChildCard({
      childBasename: audioBasename,
      cardType: "audio",
      mediaFilename,
      mediaContent: segment.buffer,
      cardContent,
    });
    builder.audioRefs.push(`${audioBasename}.audio.card`);
  }
}

/** Create image cards + copy media files. */
async function writeImageCards(opts: {
  builder: SessionBuilder;
  sessionDir: string;
  photos: StagingPhoto[];
}): Promise<void> {
  const { builder, sessionDir, photos } = opts;
  for (const [i, photo] of photos.entries()) {
    const idx = String(i + 1).padStart(3, "0");
    const photoBasename = `photo-${idx}`;
    const ext = photo.filename.endsWith(".png") ? ".png" : ".jpg";
    const mediaFilename = `${photoBasename}${ext}`;

    const imageSource: ImageSource =
      photo.source === "camera-environment"
        ? "camera-environment"
        : photo.source === "gallery"
          ? "gallery"
          : "camera-user";

    const mediaContent = await fs.readFile(path.join(sessionDir, photo.filename));
    const cardContent = createImageTemplate({
      capturedAt: photo.capturedAt,
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
  }
}

/** Copy uploaded files + create file cards. */
async function writeFileCards(opts: {
  builder: SessionBuilder;
  sessionDir: string;
  files: StagingFile[];
}): Promise<void> {
  const { builder, sessionDir, files } = opts;
  for (const file of files) {
    const mediaFilename = file.filename; // stored as client-provided (file-NNN-<sanitized>.ext)
    const baseWithoutExt = mediaFilename.replace(/\.[^./]+$/, "");
    const mediaContent = await fs.readFile(path.join(sessionDir, file.filename));

    const cardContent = createFileTemplate({
      capturedAt: file.uploadedAt,
      source: "disk",
      filename: mediaFilename,
      originalName: file.originalName,
      mimeType: file.mimeType,
    });

    await builder.writeChildCard({
      childBasename: baseWithoutExt,
      cardType: "file",
      mediaFilename,
      mediaContent,
      cardContent,
    });
    builder.fileRefs.push(`${baseWithoutExt}.file.card`);
  }
}

/** Commit all staged media + cards in a single commit summarizing the counts. */
async function commitSession(opts: { boxRoot: string; builder: SessionBuilder }): Promise<void> {
  const { boxRoot, builder } = opts;
  if (builder.filesToStage.length === 0) return;
  await stageFiles(boxRoot, builder.filesToStage);
  const parts: string[] = [];
  if (builder.audioRefs.length > 0) parts.push(`${builder.audioRefs.length} audio`);
  if (builder.imageRefs.length > 0) parts.push(`${builder.imageRefs.length} photos`);
  if (builder.fileRefs.length > 0) parts.push(`${builder.fileRefs.length} files`);
  await commit(boxRoot, {
    message: `Capture session: ${parts.join(", ")}`,
    trailers: { "Created-By": "capture" },
  });
}

/** Build the deterministic `capture-YYYYMMDDTHHMM-shortId` basename. */
function sessionBasenameFor(opts: { actualStartedAt: string; id: string }): string {
  const startDate = new Date(opts.actualStartedAt);
  const datePart = startDate.toISOString().slice(0, 16).replace(/[:-]/g, "").replace("T", "T");
  const formattedDate = `${datePart.slice(0, 8)}T${datePart.slice(9, 13)}`;
  const shortId = opts.id.slice(0, 8);
  return `capture-${formattedDate}-${shortId}`;
}

/** All media timestamps in the session (segment starts, photo/file times). */
function collectTimestamps(session: StagingSession): string[] {
  return [
    ...session.segments.map((s) => s.startedAt),
    ...session.photos.map((p) => p.capturedAt),
    ...session.files.map((f) => f.uploadedAt),
  ];
}

/**
 * Turn a staged session into cards + a single commit, then clean up the
 * staging directory. Returns the relative paths of the session card(s) created
 * (empty when the session had no media). Pure orchestration; the route handler
 * adapts the HTTP shape and broadcasts.
 */
export async function finalizeSession(opts: {
  session: StagingSession;
  boxRoot: string;
}): Promise<FinalizeResult> {
  const { session, boxRoot } = opts;
  const sessionDir = stagingSessionDir(boxRoot, session.id);

  const isEmpty =
    session.segments.length === 0 && session.photos.length === 0 && session.files.length === 0;
  if (isEmpty) {
    await cleanupStagingSession({ boxRoot, id: session.id });
    return { cards: [] };
  }

  // Compute actual start/end from media timestamps (client-provided), not
  // session creation time — the capture surface may sit open a long time
  // before the user records or shoots.
  const timestamps = collectTimestamps(session).toSorted();
  const actualStartedAt = timestamps[0] || session.createdAt;
  const endedAt = timestamps[timestamps.length - 1] || actualStartedAt;

  const sessionBasename = sessionBasenameFor({ actualStartedAt, id: session.id });
  const inboxRelDir = "box/inbox";
  const sessionAttachRelDir = `${inboxRelDir}/${sessionBasename}.attach`;
  const sessionAttachAbsDir = path.join(boxRoot, sessionAttachRelDir);
  const inboxAbsDir = path.join(boxRoot, inboxRelDir);

  await fs.mkdir(sessionAttachAbsDir, { recursive: true });

  console.log(
    `[capture] Finalizing staging session ${session.id} → ${sessionBasename}: ` +
      `${session.segments.length} segments, ${session.photos.length} photos, ${session.files.length} files`,
  );

  const builder = new SessionBuilder({ boxRoot, sessionAttachRelDir, sessionAttachAbsDir });
  await writeAudioCards({ builder, sessionDir, segments: session.segments });
  await writeImageCards({ builder, sessionDir, photos: session.photos });
  await writeFileCards({ builder, sessionDir, files: session.files });

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
  await createProcessCapturesTrigger(boxRoot);
  await cleanupStagingSession({ boxRoot, id: session.id });

  const sessionCardRelPath = `${inboxRelDir}/${sessionCardFilename}`;
  console.log(`[capture] Created capture session: ${sessionCardRelPath}`);
  return { cards: [sessionCardRelPath] };
}

/**
 * Create a one-shot scheduled script that triggers process-captures on the next
 * wakeup. Idempotent — skips if the trigger already exists.
 */
async function createProcessCapturesTrigger(boxRoot: string): Promise<void> {
  const triggerPath = path.join(boxRoot, "config/schedules/process-captures.scheduled-script.card");
  try {
    await fs.access(triggerPath);
    console.log("[capture] process-captures trigger already exists, skipping");
    return;
  } catch (_e) {
    // fs.access throwing means the trigger doesn't exist yet — the normal path.
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
