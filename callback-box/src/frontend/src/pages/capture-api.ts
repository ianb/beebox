/**
 * Capture page API + device-preference helpers.
 *
 * Pure (non-React) logic split out of CapturePage.tsx: session lifecycle
 * fetches, the retrying upload routine, and localStorage device prefs.
 */

import { getApiBase } from "../api";
import { RequestError } from "../lib/errors";

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

export async function createCaptureSession(): Promise<{ sessionId: string; startedAt: string }> {
  const res = await fetch(`${getApiBase()}/capture/sessions`, { method: "POST" });
  if (!res.ok) {
    const message = `Create session failed: ${res.status}`;
    throw new RequestError(message);
  }
  return res.json();
}

interface UploadFileOptions {
  sessionId: string;
  filename: string;
  blob: Blob;
  startedAt: string;
  source: string;
  originalName?: string;
  mimeType?: string;
}

const MAX_UPLOAD_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1000;
const UPLOAD_TIMEOUT_MS = 30_000;

export async function uploadCaptureFile(options: UploadFileOptions): Promise<void> {
  const { sessionId, filename, blob, startedAt, source, originalName, mimeType } = options;

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
      "X-Capture-Started-At": startedAt,
      "X-Capture-Source": source,
    };
    if (originalName) headers["X-Capture-Original-Name"] = originalName;
    if (mimeType) headers["X-Capture-Mime-Type"] = mimeType;

    let res: Response;
    try {
      res = await fetch(`${getApiBase()}/capture/sessions/${sessionId}/upload`, {
        method: "POST",
        headers,
        body: formData,
        signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
      });
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
  const res = await fetch(`${getApiBase()}/capture/sessions/${sessionId}/finalize`, {
    method: "POST",
  });
  if (!res.ok) {
    const message = `Finalize failed: ${res.status}`;
    throw new RequestError(message);
  }
}

export async function cancelCaptureSession(sessionId: string): Promise<void> {
  const res = await fetch(`${getApiBase()}/capture/sessions/${sessionId}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const message = `Cancel failed: ${res.status}`;
    throw new RequestError(message);
  }
}
