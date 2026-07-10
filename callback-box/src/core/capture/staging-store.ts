/**
 * In-box capture staging store.
 *
 * A staging session lives at `<boxRoot>/tmp/capture-staging/<session-id>/`,
 * holding the raw uploaded media plus a `session.json` manifest. `tmp/` is
 * gitignored and the housekeeping sweep skips directories
 * (`housekeeping.ts` — `if (!stat.isFile()) continue;`), so staged sessions
 * are durable and inspectable while exempt from the flat-file sweep.
 *
 * Sessions never span processes, so concurrent read-modify-write of
 * `session.json` is serialized by an in-process per-session promise-chain
 * lock — NOT `src/lib/file-lock.ts`, which handles cross-process contention.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getBoxTimeISO } from "../../lib/time.js";

/**
 * Preparation/lifecycle state. `failed:<step>` records which preparation step
 * failed (Track 3), kept loud and inspectable on disk.
 */
export type StagingSessionState =
  | "open"
  | "sealed"
  | "preparing"
  | "delivered"
  | `failed:${string}`;

/** One recording start. Chunks are ordered as uploaded (WebM header rule). */
export interface StagingSegment {
  id: string;
  startedAt: string;
  chunks: string[];
}

/**
 * A captured photo. `source` (camera-user/-environment/gallery) is retained
 * beyond the plan's listed shape because finalize needs it to set the image
 * card's `source`.
 */
export interface StagingPhoto {
  filename: string;
  capturedAt: string;
  source: string;
  originalName?: string;
  mimeType?: string;
}

/** A disk-uploaded file. */
export interface StagingFile {
  filename: string;
  uploadedAt: string;
  originalName: string;
  mimeType: string;
}

export interface StagingSession {
  id: string;
  createdAt: string;
  lastActivityAt: string;
  targetSessionId: string | null;
  state: StagingSessionState;
  segments: StagingSegment[];
  photos: StagingPhoto[];
  files: StagingFile[];
}

/** Raised when a session vanished between read and write (e.g. cancelled). */
export class StagingSessionGoneError extends Error {
  constructor(id: string) {
    super(`Staging session ${id} disappeared during a mutation`);
    this.name = "StagingSessionGoneError";
  }
}

/** Raised when an upload filename would escape the session directory. */
export class StagingPathError extends Error {
  constructor(filename: string) {
    super(`Unsafe staging filename: ${filename}`);
    this.name = "StagingPathError";
  }
}

export function stagingBaseDir(boxRoot: string): string {
  return path.join(boxRoot, "tmp", "capture-staging");
}

export function stagingSessionDir(boxRoot: string, id: string): string {
  return path.join(stagingBaseDir(boxRoot), id);
}

function sessionJsonPath(boxRoot: string, id: string): string {
  return path.join(stagingSessionDir(boxRoot, id), "session.json");
}

/**
 * Resolve an upload filename inside the session directory, refusing any path
 * that escapes it. The route validates first for a clean 400; this re-guards
 * as a defense-in-depth invariant.
 */
export function resolveStagedFile(opts: { boxRoot: string; id: string; filename: string }): string {
  const dir = path.resolve(stagingSessionDir(opts.boxRoot, opts.id));
  const resolved = path.resolve(dir, opts.filename);
  if (resolved !== dir && !resolved.startsWith(dir + path.sep)) {
    throw new StagingPathError(opts.filename);
  }
  return resolved;
}

export async function readStagingSession(opts: {
  boxRoot: string;
  id: string;
}): Promise<StagingSession | null> {
  try {
    const raw = await fs.readFile(sessionJsonPath(opts.boxRoot, opts.id), "utf-8");
    return JSON.parse(raw) as StagingSession;
  } catch (_e) {
    return null;
  }
}

export async function writeStagingSession(opts: {
  boxRoot: string;
  session: StagingSession;
}): Promise<void> {
  const { boxRoot, session } = opts;
  await fs.writeFile(sessionJsonPath(boxRoot, session.id), JSON.stringify(session, null, 2));
}

export async function createStagingSession(opts: {
  boxRoot: string;
  targetSessionId: string | null;
}): Promise<StagingSession> {
  const { boxRoot, targetSessionId } = opts;
  const id = crypto.randomUUID();
  await fs.mkdir(stagingSessionDir(boxRoot, id), { recursive: true });
  const now = getBoxTimeISO(boxRoot);
  const session: StagingSession = {
    id,
    createdAt: now,
    lastActivityAt: now,
    targetSessionId,
    state: "open",
    segments: [],
    photos: [],
    files: [],
  };
  await writeStagingSession({ boxRoot, session });
  return session;
}

/**
 * Per-session mutex. Concurrent uploads to one session read-modify-write
 * `session.json`; without serialization they race and drop entries. The map
 * holds the tail of a promise chain per id; each task appends after the tail.
 * Keys are UUIDs, unique across boxes, so no boxRoot is needed in the key.
 */
const sessionLocks = new Map<string, Promise<void>>();

export async function withStagingLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const previous = sessionLocks.get(id) ?? Promise.resolve();
  const done = previous.then(fn);
  // Store a version that always resolves so one failure doesn't break the chain.
  sessionLocks.set(
    id,
    done.then(
      () => {},
      () => {},
    ),
  );
  return done;
}

function releaseStagingLock(id: string): void {
  sessionLocks.delete(id);
}

/**
 * Read-modify-write `session.json` under the per-session lock, bumping
 * `lastActivityAt`. Throws if the session vanished mid-flight.
 */
async function mutateSession(opts: {
  boxRoot: string;
  id: string;
  mutate: (session: StagingSession) => void;
}): Promise<void> {
  const { boxRoot, id, mutate } = opts;
  await withStagingLock(id, async () => {
    const session = await readStagingSession({ boxRoot, id });
    if (!session) throw new StagingSessionGoneError(id);
    mutate(session);
    session.lastActivityAt = getBoxTimeISO(boxRoot);
    await writeStagingSession({ boxRoot, session });
  });
}

export interface AddAudioChunkParams {
  boxRoot: string;
  id: string;
  segmentId: string;
  segmentStartedAt: string;
  filename: string;
  buffer: Buffer;
}

/** Write an audio chunk to disk and append it to its segment (creating the
 * segment on first chunk). */
export async function addAudioChunk(params: AddAudioChunkParams): Promise<void> {
  const { boxRoot, id, segmentId, segmentStartedAt, filename, buffer } = params;
  await fs.writeFile(resolveStagedFile({ boxRoot, id, filename }), buffer);
  await mutateSession({
    boxRoot,
    id,
    mutate: (session) => {
      let segment = session.segments.find((s) => s.id === segmentId);
      if (!segment) {
        segment = { id: segmentId, startedAt: segmentStartedAt, chunks: [] };
        session.segments.push(segment);
      }
      segment.chunks.push(filename);
    },
  });
}

export interface AddPhotoParams {
  boxRoot: string;
  id: string;
  filename: string;
  capturedAt: string;
  source: string;
  originalName?: string | undefined;
  mimeType?: string | undefined;
  buffer: Buffer;
}

export async function addPhoto(params: AddPhotoParams): Promise<void> {
  const { boxRoot, id, filename, capturedAt, source, originalName, mimeType, buffer } = params;
  await fs.writeFile(resolveStagedFile({ boxRoot, id, filename }), buffer);
  await mutateSession({
    boxRoot,
    id,
    mutate: (session) => {
      const photo: StagingPhoto = { filename, capturedAt, source };
      if (originalName) photo.originalName = originalName;
      if (mimeType) photo.mimeType = mimeType;
      session.photos.push(photo);
    },
  });
}

export interface AddFileParams {
  boxRoot: string;
  id: string;
  filename: string;
  uploadedAt: string;
  originalName: string;
  mimeType: string;
  buffer: Buffer;
}

export async function addFile(params: AddFileParams): Promise<void> {
  const { boxRoot, id, filename, uploadedAt, originalName, mimeType, buffer } = params;
  await fs.writeFile(resolveStagedFile({ boxRoot, id, filename }), buffer);
  await mutateSession({
    boxRoot,
    id,
    mutate: (session) => {
      session.files.push({ filename, uploadedAt, originalName, mimeType });
    },
  });
}

/** Transition the session's lifecycle state (seal/preparing/delivered/failed). */
export async function setStagingState(opts: {
  boxRoot: string;
  id: string;
  state: StagingSessionState;
}): Promise<void> {
  await mutateSession({
    boxRoot: opts.boxRoot,
    id: opts.id,
    mutate: (session) => {
      session.state = opts.state;
    },
  });
}

/** True once the session holds at least one piece of media. */
export function stagingSessionIsEmpty(session: StagingSession): boolean {
  return session.segments.length === 0 && session.photos.length === 0 && session.files.length === 0;
}

/**
 * Tear down a session: remove its directory and drop its lock-map entry in one
 * step, so the in-process lock can't outlive the session.
 */
export async function cleanupStagingSession(opts: { boxRoot: string; id: string }): Promise<void> {
  const { boxRoot, id } = opts;
  try {
    await fs.rm(stagingSessionDir(boxRoot, id), { recursive: true, force: true });
  } catch (e) {
    console.error(`[capture] Failed to clean up staging session ${id}:`, e);
  }
  releaseStagingLock(id);
}
