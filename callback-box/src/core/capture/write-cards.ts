/**
 * Capture card writing — turn a staged session's uploaded media into a
 * capture-session card plus its child audio/image/file cards, in an arbitrary
 * destination directory (a chat area's `tmp-capture/` for the preparation
 * worker; `cb scan-import` writes the same card shape into the inbox via its
 * own path).
 *
 * Originated in the retired `webapp/routes/capture-finalize.ts`; the
 * preparation worker (prepare.ts) is now the only consumer. Media bytes are
 * gitignored assets
 * tracked via a per-scope `manifest.json` (see docs/implemented-plans/asset-manifests.md); we
 * write the media, write its manifest, and stage the *manifest* + card, never
 * the raw bytes.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createAudioTemplate } from "../../schemas/audio.js";
import { createImageTemplate, type ImageSource } from "../../schemas/image.js";
import { createFileTemplate } from "../../schemas/file.js";
import { createCaptureSessionTemplate } from "../../schemas/capture-session.js";
import { concatSegmentChunks } from "./audio-concat.js";
import { computeEntry, saveManifest, emptyManifest } from "../asset-manifest.js";
import type { StagingSession, StagingSegment, StagingPhoto, StagingFile } from "./staging-store.js";
import { M4ASegmentFileCountError } from "./audio-format.js";

/**
 * Accumulates the media + cards written for one session, tracking which paths
 * need git staging and the per-type card refs that the session card links to.
 */
export class SessionBuilder {
  readonly filesToStage: string[] = [];
  readonly audioRefs: string[] = [];
  readonly imageRefs: string[] = [];
  readonly fileRefs: string[] = [];
  /** Absolute paths of every child card written — for validation before commit. */
  readonly childCardPaths: string[] = [];

  private readonly boxRoot: string;
  private readonly sessionAttachRelDir: string;
  private readonly sessionAttachAbsDir: string;

  constructor(opts: { boxRoot: string; sessionAttachRelDir: string; sessionAttachAbsDir: string }) {
    this.boxRoot = opts.boxRoot;
    this.sessionAttachRelDir = opts.sessionAttachRelDir;
    this.sessionAttachAbsDir = opts.sessionAttachAbsDir;
  }

  /**
   * Each child card (audio/image/file) gets its own attach scope holding the
   * bound media. The media bytes are gitignored assets tracked by a
   * `manifest.json` (size + sha256) — so we write the media, write its
   * manifest, and stage the *manifest* and card, never the raw bytes.
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
    this.childCardPaths.push(cardAbsPath);
  }
}

/**
 * Write one audio card per recording segment. Chunks are concatenated *within*
 * a segment only (`concatSegments` — only the first chunk of a recording has
 * the WebM/EBML header). Cards are numbered `audio-001`, `audio-002`, … and
 * each card's `filename.recorded` is its segment's `startedAt`.
 */
export async function writeAudioCards(opts: {
  builder: SessionBuilder;
  sessionDir: string;
  segments: StagingSegment[];
}): Promise<void> {
  const { builder, sessionDir, segments } = opts;

  for (const [i, segment] of segments.entries()) {
    const chunks = await Promise.all(
      segment.chunks.map((chunkFilename) => fs.readFile(path.join(sessionDir, chunkFilename))),
    );
    if (chunks.length === 0) continue;
    if (segment.format === "m4a-aac" && chunks.length !== 1) {
      throw new M4ASegmentFileCountError();
    }
    const audioBasename = `audio-${String(i + 1).padStart(3, "0")}`;
    const extension = segment.format === "m4a-aac" ? "m4a" : "webm";
    const mediaFilename = `${audioBasename}.${extension}`;
    const cardContent = createAudioTemplate({
      recordedAt: segment.startedAt,
      source: "microphone",
      filename: mediaFilename,
    });
    await builder.writeChildCard({
      childBasename: audioBasename,
      cardType: "audio",
      mediaFilename,
      mediaContent: concatSegmentChunks(chunks),
      cardContent,
    });
    builder.audioRefs.push(`${audioBasename}.audio.card`);
  }
}

/** Create image cards + copy media files. */
export async function writeImageCards(opts: {
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
export async function writeFileCards(opts: {
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

/** Build the deterministic `capture-YYYYMMDDTHHMM-shortId` basename. */
export function sessionBasenameFor(opts: { actualStartedAt: string; id: string }): string {
  const startDate = new Date(opts.actualStartedAt);
  const datePart = startDate.toISOString().slice(0, 16).replace(/[:-]/g, "").replace("T", "T");
  const formattedDate = `${datePart.slice(0, 8)}T${datePart.slice(9, 13)}`;
  const shortId = opts.id.slice(0, 8);
  return `capture-${formattedDate}-${shortId}`;
}

/** All media timestamps in the session (segment starts, photo/file times). */
export function collectTimestamps(session: StagingSession): string[] {
  return [
    ...session.segments.map((s) => s.startedAt),
    ...session.photos.map((p) => p.capturedAt),
    ...session.files.map((f) => f.uploadedAt),
  ];
}

export interface WrittenCaptureDocument {
  /** Box-relative path of the capture-session card. */
  sessionCardRelPath: string;
  /** Absolute path of the capture-session card. */
  sessionCardAbsPath: string;
  /** Box-relative attach-scope dir of the capture session. */
  sessionAttachRelDir: string;
  /** Absolute paths of the capture card + every child card (for validation). */
  cardPaths: string[];
  basename: string;
  imageCount: number;
  audioCount: number;
  fileCount: number;
}

/**
 * Write the full capture document (capture-session card + child audio/image/
 * file cards) into `destRelDir` (box-relative). The transcript body is left
 * empty — the preparation worker fills it after transcription. Media bytes are
 * written but only manifests + cards are collected for staging.
 */
export async function writeCaptureDocument(opts: {
  boxRoot: string;
  session: StagingSession;
  sessionDir: string;
  destRelDir: string;
  basename: string;
  actualStartedAt: string;
  endedAt: string;
  /** Sweep-sealed capture — writes `partial: true` frontmatter. */
  partial?: boolean;
}): Promise<WrittenCaptureDocument> {
  const { boxRoot, session, sessionDir, destRelDir, basename, actualStartedAt, endedAt, partial } = opts;

  const sessionAttachRelDir = `${destRelDir}/${basename}.attach`;
  const sessionAttachAbsDir = path.join(boxRoot, sessionAttachRelDir);
  const destAbsDir = path.join(boxRoot, destRelDir);
  await fs.mkdir(sessionAttachAbsDir, { recursive: true });

  const builder = new SessionBuilder({ boxRoot, sessionAttachRelDir, sessionAttachAbsDir });
  await writeAudioCards({ builder, sessionDir, segments: session.segments });
  await writeImageCards({ builder, sessionDir, photos: session.photos });
  await writeFileCards({ builder, sessionDir, files: session.files });

  const sessionCardFilename = `${basename}.capture-session.card`;
  const sessionCardContent = createCaptureSessionTemplate({
    sessionId: session.id,
    startedAt: actualStartedAt,
    endedAt,
    imageRefs: builder.imageRefs,
    audioRefs: builder.audioRefs,
    fileRefs: builder.fileRefs,
    partial: partial === true,
  });
  const sessionCardAbsPath = path.join(destAbsDir, sessionCardFilename);
  await fs.writeFile(sessionCardAbsPath, sessionCardContent);

  return {
    sessionCardRelPath: `${destRelDir}/${sessionCardFilename}`,
    sessionCardAbsPath,
    sessionAttachRelDir,
    cardPaths: [sessionCardAbsPath, ...builder.childCardPaths],
    basename,
    imageCount: builder.imageRefs.length,
    audioCount: builder.audioRefs.length,
    fileCount: builder.fileRefs.length,
  };
}
