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
import { handleStagingUploadReplay } from "./upload-replay.js";
import { StagingPathError, StagingSessionGoneError, StagingSessionNotOpenError } from "./staging-errors.js";
import { M4ASegmentFileCountError, StagingAudioFormatMismatchError, type CaptureAudioFormat } from "./audio-format.js";
import { readStagingSession, writeStagingSession } from "./staging-manifest-io.js";
import {
  stagingBaseDir, stagingSessionDir, isCaptureSession, isBulkSession,
  type StagingSession, type StagingSessionState, type StagingSessionKind, type StagingSegment,
  type StagingPhoto, type StagingFile, type StagingBulkItem, type StagingBulkFailedItem,
} from "./staging-schema.js";

export {
  readStagingSession, writeStagingSession, stagingBaseDir, stagingSessionDir,
  isCaptureSession, isBulkSession,
  type StagingSession, type StagingSessionState, type StagingSessionKind, type StagingSegment,
  type StagingPhoto, type StagingFile, type StagingBulkItem, type StagingBulkFailedItem,
};

/**
 * Reject staged filenames that would collide with the session's own control
 * files. `session.json` (and its `.corrupt`/`.tmp-*` siblings under the
 * `session.json.` prefix) is the manifest — letting an upload claim it would
 * overwrite the manifest with attacker-controlled bytes (silent content
 * substitution). A batch-local `.gitignore` guards the attach scope, and any
 * dot-leading name is a hidden/control file with no legitimate staging use.
 */
function assertStagingFilename(filename: string): void {
  const reserved =
    filename === "session.json" ||
    filename.startsWith("session.json.") ||
    filename.startsWith(".");
  if (reserved) throw new StagingPathError(filename);
}

/**
 * Resolve an upload filename inside the session directory, refusing any path
 * that escapes it OR claims a reserved control-file name. The route validates
 * first for a clean 400; this re-guards as a defense-in-depth invariant.
 */
export function resolveStagedFile(opts: { boxRoot: string; id: string; filename: string }): string {
  assertStagingFilename(opts.filename);
  const dir = path.resolve(stagingSessionDir(opts.boxRoot, opts.id));
  const resolved = path.resolve(dir, opts.filename);
  if (resolved !== dir && !resolved.startsWith(dir + path.sep)) {
    throw new StagingPathError(opts.filename);
  }
  return resolved;
}

/**
 * Create a staging session. `kind` defaults to `"capture"` (the recorded
 * photo/voice batch); pass `kind: "bulk"` plus an initial `expectedItems`
 * registry for a bulk file-upload batch (`docs/plans/bulk-file-upload.md`),
 * whose finalize path reads `files` + `expectedItems` rather than the capture
 * media arrays.
 */
export async function createStagingSession(opts: {
  boxRoot: string;
  targetSessionId: string | null;
  createdBy: string | null;
  kind?: StagingSessionKind;
  expectedItems?: StagingBulkItem[];
  /** Box-relative target-chat context dir (bulk sessions only). */
  contextDir?: string;
}): Promise<StagingSession> {
  const { boxRoot, targetSessionId, createdBy } = opts;
  const kind = opts.kind ?? "capture";
  const id = crypto.randomUUID();
  await fs.mkdir(stagingSessionDir(boxRoot, id), { recursive: true });
  const now = getBoxTimeISO(boxRoot);
  const session: StagingSession = {
    id,
    createdAt: now,
    lastActivityAt: now,
    targetSessionId,
    createdBy,
    kind,
    state: "open",
    segments: [],
    photos: [],
    files: [],
    totalBytes: 0,
  };
  if (kind === "bulk") {
    session.expectedItems = opts.expectedItems ?? [];
    if (opts.contextDir !== undefined) session.contextDir = opts.contextDir;
  }
  await writeStagingSession({ boxRoot, session });
  return session;
}

/**
 * Append to a bulk session's predeclared item registry (items may be registered
 * while the picker still streams). Idempotent per `id`: an item whose `id` is
 * already registered updates in place rather than duplicating.
 */
export async function registerBulkItems(opts: {
  boxRoot: string;
  id: string;
  items: StagingBulkItem[];
}): Promise<void> {
  const { boxRoot, id, items } = opts;
  await mutateSession({
    boxRoot,
    id,
    mutate: (session) => {
      // Registration is a mutation of the batch; the seal freezes it. Assert
      // `open` under the lock so a finalize racing this append can't slip an item
      // into a sealed registry (the route pre-checks, this is the barrier).
      if (session.state !== "open") throw new StagingSessionNotOpenError(id, session.state);
      const registry = session.expectedItems ?? [];
      for (const item of items) {
        const existing = registry.findIndex((r) => r.id === item.id);
        if (existing !== -1) registry[existing] = item;
        else registry.push(item);
      }
      session.expectedItems = registry;
    },
  });
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
      const mediaPath = resolveStagedFile({ boxRoot, id, filename: media.filename });
      if (await handleStagingUploadReplay({ session, mediaPath, ...media })) {
        session.lastActivityAt = getBoxTimeISO(boxRoot);
        await writeStagingSession({ boxRoot, session });
        return;
      }
      enforceStagingLimits({ session, incomingBytes: media.buffer.length });
      mutate(session);
      await fs.writeFile(resolveStagedFile({ boxRoot, id, filename: media.filename }), media.buffer);
      session.totalBytes = (session.totalBytes ?? 0) + media.buffer.length;
    } else {
      mutate(session);
    }
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
  audioFormat?: CaptureAudioFormat | undefined;
}

/** Write an audio chunk to disk and append it to its segment (creating the
 * segment on first chunk). */
export async function addAudioChunk(params: AddAudioChunkParams): Promise<void> {
  const { boxRoot, id, segmentId, segmentStartedAt, filename, buffer } = params;
  const audioFormat = params.audioFormat ?? "webm-opus";
  await mutateSession({
    boxRoot,
    id,
    media: { filename, buffer },
    mutate: (session) => {
      let segment = session.segments.find((s) => s.id === segmentId);
      if (!segment) {
        segment = { id: segmentId, startedAt: segmentStartedAt, format: audioFormat, chunks: [] };
        session.segments.push(segment);
      }
      if (segment.format !== audioFormat) {
        throw new StagingAudioFormatMismatchError();
      }
      if (audioFormat === "m4a-aac" && segment.chunks.length > 0) {
        throw new M4ASegmentFileCountError();
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
  /** Predeclared bulk-registry item id this file fulfils (bulk sessions only). */
  itemId?: string | undefined;
  buffer: Buffer;
}

export async function addFile(params: AddFileParams): Promise<void> {
  const { boxRoot, id, filename, uploadedAt, originalName, mimeType, itemId, buffer } = params;
  await mutateSession({
    boxRoot,
    id,
    media: { filename, buffer },
    mutate: (session) => {
      const file: StagingFile = { filename, uploadedAt, originalName, mimeType };
      if (itemId !== undefined) file.itemId = itemId;
      session.files.push(file);
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
 * `failedItems` (bulk only) is persisted IN the same CAS write, so the seal and
 * the uploader's failed-item report are one atomic mutation (no crash window).
 */
export async function sealStagingSession(opts: {
  boxRoot: string;
  id: string;
  partial?: boolean;
  requireOpen?: boolean;
  failedItems?: StagingBulkFailedItem[] | undefined;
}): Promise<SealResult> {
  const { boxRoot, id, partial, requireOpen, failedItems } = opts;
  return withStagingLock(id, async () => {
    const session = await readStagingSession({ boxRoot, id });
    if (!session) throw new StagingSessionGoneError(id);
    const fireEligible =
      session.state === "open" || (requireOpen !== true && session.state.startsWith("failed:"));
    if (!fireEligible) return { sealed: false, alreadySealed: true };
    session.state = "sealed";
    if (partial === true) session.partial = true;
    if (failedItems !== undefined) session.failedItems = failedItems;
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
