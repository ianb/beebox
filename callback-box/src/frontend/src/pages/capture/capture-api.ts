/**
 * Capture page API + device-preference helpers.
 *
 * Pure (non-React) logic split out of CapturePage.tsx: session lifecycle
 * fetches, the retrying upload routine, and localStorage device prefs.
 *
 * Deliberate-REST inventory (Track L.12e — no tRPC equivalent exists in
 * src/webapp/trpc/routers/*; the backend has no capture-session router):
 * - `uploadCaptureFile` — POST /api/capture/sessions/:id/upload. Multipart
 *   body plus custom `X-Capture-*` headers (filename/source/timestamps),
 *   an `AbortSignal.timeout` and manual retry/backoff loop. Not a tRPC
 *   candidate on its own merits (multipart + non-JSON transport needs).
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
import { withMobileAuth } from "../../lib/mobile-auth";

export type UploadState = "uploading" | "uploaded" | "failed";

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
): Promise<{ sessionId: string; startedAt: string }> {
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
}

const MAX_UPLOAD_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1000;
const UPLOAD_TIMEOUT_MS = 30_000;

export async function uploadCaptureFile(options: UploadFileOptions): Promise<void> {
  const { sessionId, kind, filename, blob, startedAt, source } = options;
  const { segmentId, segmentStartedAt, originalName, mimeType } = options;

  for (let attempt = 0; attempt <= MAX_UPLOAD_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
      console.warn(`[capture] Retrying upload ${filename} (attempt ${attempt + 1}/${MAX_UPLOAD_RETRIES + 1}) after ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
    }

    const formData = new FormData();
    formData.append("file", blob, filename);

    const headers: Record<string, string> = {
      "X-Capture-Filename": filename,
      "X-Capture-Kind": kind,
      "X-Capture-Started-At": startedAt,
      "X-Capture-Source": source,
    };
    if (segmentId) headers["X-Capture-Segment-Id"] = segmentId;
    if (segmentStartedAt) headers["X-Capture-Segment-Started-At"] = segmentStartedAt;
    if (originalName) headers["X-Capture-Original-Name"] = originalName;
    if (mimeType) headers["X-Capture-Mime-Type"] = mimeType;

    let res: Response;
    try {
      res = await fetch(`${getApiBase()}/capture/sessions/${sessionId}/upload`, withMobileAuth({
        method: "POST",
        headers,
        body: formData,
        signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
      }));
    } catch (networkErr) {
      // Network error (offline, DNS failure, etc.) — retry
      if (attempt < MAX_UPLOAD_RETRIES) continue;
      const msg = networkErr instanceof Error ? networkErr.message : String(networkErr);
      const message = `Upload failed (network error after ${MAX_UPLOAD_RETRIES + 1} attempts): ${msg}`;
      throw new RequestError(message);
    }

    if (res.ok) return;

    // 4xx errors (except 408/429) are not retryable
    if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
      let detail = "";
      try { detail = await res.text(); } catch (_e) { /* ignore */ }
      const message = `Upload failed (${res.status}): ${detail || res.statusText}`;
      throw new RequestError(message);
    }

    // 5xx or 408/429 — retry
    if (attempt < MAX_UPLOAD_RETRIES) continue;

    let detail = "";
    try { detail = await res.text(); } catch (_e) { /* ignore */ }
    const message = `Upload failed (${res.status} after ${MAX_UPLOAD_RETRIES + 1} attempts): ${detail || res.statusText}`;
    throw new RequestError(message);
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

export async function cancelCaptureSession(sessionId: string): Promise<void> {
  const res = await fetch(`${getApiBase()}/capture/sessions/${sessionId}`, withMobileAuth({
    method: "DELETE",
  }));
  if (!res.ok) {
    const message = `Cancel failed: ${res.status}`;
    throw new RequestError(message);
  }
}
