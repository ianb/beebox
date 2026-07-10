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
import { enforceStagingLimits } from "./staging-limits.js";
import { errnoCode } from "../../lib/error-guards.js";

/**
 * Preparation/lifecycle state. `failed:<step>` records which preparation step
 * failed (Track 3), kept loud and inspectable on disk.
 */
export type StagingSessionState =
  | "open"
  | "sealed"
  | "preparing"
  | "delivering"
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
  /**
   * Identifier (email) of the authenticated user who started the capture, or
   * `null` when unauthenticated (auth-disabled dev). The resume query filters on
   * this so one box user can never resume/submit another's in-flight capture
   * (X4). `null` matches `null` — legacy sessions predating this field read as
   * `null` and stay resumable only by an unauthenticated caller.
   */
  createdBy: string | null;
  state: StagingSessionState;
  segments: StagingSegment[];
  photos: StagingPhoto[];
  files: StagingFile[];
  /**
   * Bytes accumulated across every staged upload, tracked at add time so the
   * per-session cap (X3) is a cheap running compare rather than a disk walk.
   * Optional for legacy manifests written before the cap existed (read as 0).
   */
  totalBytes?: number;
  /**
   * Set true only when the abandonment sweep (Track 5) seals a session the user
   * never finalized. It flows through to the capture card's `partial: true`
   * frontmatter and the `<capture partial="1">` wrapper — a deliberate "Submit
   * now" or normal "Done" finalize leaves this unset (partial: false).
   */
  partial?: boolean;
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
  createdBy: string | null;
}): Promise<StagingSession> {
  const { boxRoot, targetSessionId, createdBy } = opts;
  const id = crypto.randomUUID();
  await fs.mkdir(stagingSessionDir(boxRoot, id), { recursive: true });
  const now = getBoxTimeISO(boxRoot);
  const session: StagingSession = {
    id,
    createdAt: now,
    lastActivityAt: now,
    targetSessionId,
    createdBy,
    state: "open",
    segments: [],
    photos: [],
    files: [],
    totalBytes: 0,
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
 *
 * With `media`, this is also the shared write path for a media add: it enforces
 * the per-session caps (X3) against the incoming bytes, writes the file, and
 * accumulates `totalBytes` — all under the same lock, so concurrent uploads
 * can't each pass the check and jointly overshoot.
 */
async function mutateSession(opts: {
  boxRoot: string;
  id: string;
  mutate: (session: StagingSession) => void;
  media?: { filename: string; buffer: Buffer };
}): Promise<void> {
  const { boxRoot, id, mutate, media } = opts;
  await withStagingLock(id, async () => {
    const session = await readStagingSession({ boxRoot, id });
    if (!session) throw new StagingSessionGoneError(id);
    if (media) {
      enforceStagingLimits({ session, incomingBytes: media.buffer.length });
      await fs.writeFile(resolveStagedFile({ boxRoot, id, filename: media.filename }), media.buffer);
      session.totalBytes = (session.totalBytes ?? 0) + media.buffer.length;
    }
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
  await mutateSession({
    boxRoot,
    id,
    media: { filename, buffer },
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
  await mutateSession({
    boxRoot,
    id,
    media: { filename, buffer },
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
  await mutateSession({
    boxRoot,
    id,
    media: { filename, buffer },
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

/**
 * Persist the resolved delivery target session id onto the staging session, so
 * a later retry/resume reuses the same chat rather than re-resolving (or, for a
 * freshly-created session, orphaning a new one each attempt). Idempotent no-op
 * if unchanged.
 */
export async function setStagingTargetSessionId(opts: {
  boxRoot: string;
  id: string;
  targetSessionId: string;
}): Promise<void> {
  await mutateSession({
    boxRoot: opts.boxRoot,
    id: opts.id,
    mutate: (session) => {
      session.targetSessionId = opts.targetSessionId;
    },
  });
}

/** Outcome of a {@link sealStagingSession} compare-and-swap. */
export interface SealResult {
  /** True when THIS call performed the fire-eligible transition (→ `sealed`). */
  sealed: boolean;
  /** True when the session was already sealed/in-flight (no transition, no re-fire). */
  alreadySealed: boolean;
}

/**
 * Compare-and-swap the session into `sealed` so exactly one concurrent finalize
 * fires preparation. A fire-eligible source state — `open` (fresh finalize) or
 * `failed:*` (retry affordance) — transitions to `sealed` and returns
 * `sealed: true`; any in-flight state (`sealed`/`preparing`/`delivering`/
 * `delivered`) is left untouched and returns `alreadySealed: true`. The whole
 * read-decide-write runs under the per-session lock, so two POSTs racing on one
 * `open` session can't both win.
 *
 * `requireOpen` narrows fire-eligibility to `open` only — the abandonment sweep
 * (Track 5) uses it so a session that raced into `failed:*` between the sweep's
 * list and its seal is NOT auto-retried (the plan bars auto-retrying failures).
 * `partial: true` marks the session partial as part of the same atomic seal.
 */
export async function sealStagingSession(opts: {
  boxRoot: string;
  id: string;
  partial?: boolean;
  requireOpen?: boolean;
}): Promise<SealResult> {
  const { boxRoot, id, partial, requireOpen } = opts;
  return withStagingLock(id, async () => {
    const session = await readStagingSession({ boxRoot, id });
    if (!session) throw new StagingSessionGoneError(id);
    const fireEligible =
      session.state === "open" || (requireOpen !== true && session.state.startsWith("failed:"));
    if (!fireEligible) return { sealed: false, alreadySealed: true };
    session.state = "sealed";
    if (partial === true) session.partial = true;
    session.lastActivityAt = getBoxTimeISO(boxRoot);
    await writeStagingSession({ boxRoot, session });
    return { sealed: true, alreadySealed: false };
  });
}

/**
 * List every staging session currently on disk, newest activity last. Reads
 * each `<id>/session.json`, skipping directories without a readable manifest
 * (a half-created session, or one being torn down). Used by the pending-capture
 * query to surface in-flight captures for a chat — see the `capture` tRPC
 * router. No lock: a torn read just yields `null` and is skipped.
 */
export async function listStagingSessions(opts: { boxRoot: string }): Promise<StagingSession[]> {
  const { boxRoot } = opts;
  let ids: string[];
  try {
    ids = await fs.readdir(stagingBaseDir(boxRoot));
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return [];
    throw e;
  }
  const sessions = await Promise.all(ids.map((id) => readStagingSession({ boxRoot, id })));
  return sessions.filter((s): s is StagingSession => s !== null);
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
