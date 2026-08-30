/**
 * Capture page API + device-preference helpers.
 *
 * Pure (non-React) logic split out of CapturePage.tsx: session lifecycle
 * fetches, the retrying upload routine, and localStorage device prefs.
 *
 * Deliberate-REST inventory (Track L.12e — no tRPC equivalent exists in
 * src/webapp/trpc/routers/*; the backend has no capture-session router):
 * - `uploadCaptureFile` — POST /api/capture/sessions/:id/upload. Raw
 *   octet-stream body plus custom `X-Capture-*` headers (filename/source/
 *   timestamps), sent over XHR for upload progress and stall detection, with a
 *   manual retry/backoff loop. Not a tRPC candidate on its own merits (binary
 *   body + progress reporting are exactly what tRPC can't carry).
 * - `createCaptureSession`, `finalizeCaptureSession`, `cancelCaptureSession`
 *   — POST/POST/DELETE against the same `/api/capture/sessions[/:id...]`
 *   family, each individually a plain JSON-ish call with no special
 *   transport need. Kept as REST rather than split off to tRPC: all four
 *   endpoints are one Fastify route file (`webapp/routes/capture.ts`)
 *   coordinating through the same in-box staging store
 *   (`core/capture/staging-store.ts`, `withStagingLock`); moving three of the four to a different
 *   transport while the upload leg (which can't move) stays on Fastify
 *   would split one cohesive session lifecycle across two request paths
 *   for no functional gain. Revisit only alongside a real tRPC file-upload
 *   story, not piecemeal.
 *
 * `loadDevicePrefs`/`saveDevicePrefs` are localStorage helpers — no network
 * call, not part of this inventory.
 */

import { getApiBase } from "../../api";
import { RequestError } from "../../lib/errors";
import { withMobileAuth, mobileAuthHeaders } from "../../lib/mobile-auth";
import {
  uploadBinary,
  UploadAbortedError,
  UploadResponseError,
  type UploadProgressEvent,
} from "../../lib/binary-upload";

// --- Resume session id (localStorage, keyed by box) ---
//
// The current staging session id, persisted per box so a returning client can
// ask whether that exact session is still resumable — belt-and-braces for the
// standalone `targetSessionId: null` case, where there's no chat id to match on.

const RESUME_KEY_PREFIX = "capture-resume-session:";

function resumeStorageKey(): string {
  return `${RESUME_KEY_PREFIX}${getApiBase()}`;
}

export function saveResumeSessionId(sessionId: string): void {
  try {
    localStorage.setItem(resumeStorageKey(), sessionId);
  } catch (_e) {
    // Storage unavailable (private mode / quota) — resume-by-id degrades to the
    // targetSessionId match; not worth surfacing.
  }
}

export function loadResumeSessionId(): string | null {
  try {
    return localStorage.getItem(resumeStorageKey());
  } catch (_e) {
    return null;
  }
}

export function clearResumeSessionId(): void {
  try {
    localStorage.removeItem(resumeStorageKey());
  } catch (_e) {
    // Ignore — a stale id at worst re-offers a session the server already reaped.
  }
}

export type UploadState = "uploading" | "uploaded" | "failed";

export interface ResumableCaptureResponse {
  resumable: Array<{
    id: string;
    counts: { photos: number; files: number; audioSegments: number };
    startedAt: string;
  }>;
}

class ResumableCaptureListError extends Error {
  constructor(status: number) {
    super(`List resumable capture sessions failed: ${status}`);
    this.name = "ResumableCaptureListError";
  }
}

// --- Device preferences (localStorage) ---

const STORAGE_KEY = "capture-device-prefs";

export interface DevicePrefs {
  videoDeviceId: string | null;
  audioDeviceId: string | null;
}

export function loadDevicePrefs(): DevicePrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (_e) {
    // corrupt data
  }
  return { videoDeviceId: null, audioDeviceId: null };
}

export function saveDevicePrefs(prefs: DevicePrefs): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
}

// --- Capture API helpers ---

export async function createCaptureSession(
  targetSessionId: string | null,
): Promise<{
  sessionId: string;
  startedAt: string;
  capabilities: {
    acceptedAudioFormats: string[];
    acceptedUploadEncodings: string[];
  };
}> {
  const res = await fetch(
    `${getApiBase()}/capture/sessions`,
    withMobileAuth({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetSessionId }),
    }),
  );
  if (!res.ok) {
    const message = `Create session failed: ${res.status}`;
    throw new RequestError(message);
  }
  return res.json();
}

export async function listResumableCaptureSessions(
  targetSessionId: string | null,
  clientSessionId: string | null,
): Promise<ResumableCaptureResponse> {
  const query = new URLSearchParams();
  if (targetSessionId !== null) query.set("targetSessionId", targetSessionId);
  if (clientSessionId !== null) query.set("clientSessionId", clientSessionId);
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  const res = await fetch(
    `${getApiBase()}/capture/sessions/resumable${suffix}`,
    withMobileAuth({ method: "GET" }),
  );
  if (!res.ok) {
    throw new ResumableCaptureListError(res.status);
  }
  return res.json();
}

/** Which staging collection this upload joins. */
export type UploadKind = "audio" | "photo" | "file";

interface UploadFileOptions {
  sessionId: string;
  kind: UploadKind;
  filename: string;
  blob: Blob;
  startedAt: string;
  source: string;
  /** Audio only: the recording segment this chunk belongs to. */
  segmentId?: string;
  segmentStartedAt?: string;
  originalName?: string;
  mimeType?: string;
  /** Aborts the transfer (Done's "skip pending", or cancelling capture). */
  signal?: AbortSignal | undefined;
  onProgress?: ((event: UploadProgressEvent) => void) | undefined;
}

const MAX_UPLOAD_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1000;

/**
 * Abort only after no byte has moved for this long — NOT after a fixed total
 * elapsed time. A full-resolution photo on a weak mobile uplink can legitimately
 * take minutes; the old 30s wall-clock deadline made those uploads structurally
 * impossible (they aborted mid-transfer, retried from byte zero, and re-spent
 * the same scarce bandwidth until the retries ran out).
 */
const UPLOAD_STALL_TIMEOUT_MS = 20_000;

/** One staged upload gave up. `reason` carries the last transport failure. */
class CaptureUploadError extends Error {
  readonly filename: string;
  readonly reason: string;
  constructor(opts: { filename: string; reason: string; attempts: number }) {
    super(`Upload of ${opts.filename} failed after ${String(opts.attempts)} attempts: ${opts.reason}`);
    this.name = "CaptureUploadError";
    this.filename = opts.filename;
    this.reason = opts.reason;
  }
}

/** What to do with a failed attempt. */
export type UploadFailureVerdict =
  /** The caller cancelled — stop, and don't dress it up as a failure. */
  | "abort"
  /** Transient: another attempt could genuinely succeed. */
  | "retry"
  /** The server rejected this request on its merits; retrying repeats it. */
  | "fatal";

/**
 * Classify one failed attempt.
 *
 * A stall is retryable (the link may recover) but a *slow* transfer never
 * reaches here at all — `uploadBinary` only aborts when no byte has moved,
 * which is the distinction the old fixed 30s deadline could not draw. 408/429
 * are the server asking us to come back; other 4xx are our own bad request and
 * would fail identically on every retry.
 */
export function classifyUploadFailure(error: unknown): UploadFailureVerdict {
  if (error instanceof UploadAbortedError) return "abort";
  if (error instanceof UploadResponseError) {
    if (error.status === 408 || error.status === 429) return "retry";
    return error.status >= 500 ? "retry" : "fatal";
  }
  return "retry";
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function uploadCaptureFile(options: UploadFileOptions): Promise<void> {
  const { sessionId, kind, filename, blob, startedAt, source } = options;
  const { segmentId, segmentStartedAt, originalName, mimeType, signal, onProgress } = options;

  const headers: Record<string, string> = {
    ...mobileAuthHeaders(),
    "X-Capture-Filename": filename,
    "X-Capture-Kind": kind,
    "X-Capture-Started-At": startedAt,
    "X-Capture-Source": source,
  };
  if (segmentId) headers["X-Capture-Segment-Id"] = segmentId;
  if (segmentStartedAt) headers["X-Capture-Segment-Started-At"] = segmentStartedAt;
  if (originalName) headers["X-Capture-Original-Name"] = originalName;
  if (mimeType) headers["X-Capture-Mime-Type"] = mimeType;

  const url = `${getApiBase()}/capture/sessions/${sessionId}/upload`;
  let lastFailure = "unknown";

  for (let attempt = 0; attempt <= MAX_UPLOAD_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
      console.warn(`[capture] Retrying upload ${filename} (attempt ${attempt + 1}/${MAX_UPLOAD_RETRIES + 1}) after ${delay}ms: ${lastFailure}`);
      await new Promise((r) => setTimeout(r, delay));
    }

    try {
      await uploadBinary({
        url,
        body: blob,
        headers,
        stallTimeoutMs: UPLOAD_STALL_TIMEOUT_MS,
        signal,
        onProgress,
      });
      return;
    } catch (e) {
      const verdict = classifyUploadFailure(e);
      // A deliberate abort is the caller's decision, not a transport failure —
      // retrying it would defeat the very cancel it came from.
      if (verdict === "abort") throw e;
      if (verdict === "fatal") throw new RequestError(errorText(e));
      lastFailure = errorText(e);
      if (attempt < MAX_UPLOAD_RETRIES) continue;
      throw new CaptureUploadError({
        filename,
        reason: lastFailure,
        attempts: MAX_UPLOAD_RETRIES + 1,
      });
    }
  }
}

export async function finalizeCaptureSession(sessionId: string): Promise<void> {
  const res = await fetch(`${getApiBase()}/capture/sessions/${sessionId}/finalize`, withMobileAuth({
    method: "POST",
  }));
  if (!res.ok) {
    const message = `Finalize failed: ${res.status}`;
    throw new RequestError(message);
  }
}

/**
 * The box refused a discard because the background worker already owns the
 * capture — it was sealed (by Done, or by the abandonment sweep) between the
 * client's decision and its request. Nothing is lost: the capture goes on to
 * deliver into the chat it was started from, where its bubble reports it. A
 * distinct type so callers can say that instead of "discard failed".
 */
export class CaptureAlreadySealedError extends RequestError {
  constructor() {
    super("This capture is already being delivered — it will land in the chat.");
    this.name = "CaptureAlreadySealedError";
  }
}

export async function cancelCaptureSession(sessionId: string): Promise<void> {
  const res = await fetch(`${getApiBase()}/capture/sessions/${sessionId}`, withMobileAuth({
    method: "DELETE",
  }));
  if (res.status === 409) throw new CaptureAlreadySealedError();
  if (!res.ok) {
    const message = `Cancel failed: ${res.status}`;
    throw new RequestError(message);
  }
}
