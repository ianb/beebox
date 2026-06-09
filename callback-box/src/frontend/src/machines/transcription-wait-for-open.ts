import { delay, jitteredBackoff } from "./transcription-backoff";
import type { ConnectionHandle } from "./transcription-connections";

/**
 * Promise wrapper around a WebSocket's open/error/close events. Resolves
 * true once the socket opens; false on error, close, or a timeout (in ms).
 * Listeners are removed on either outcome so the caller can wire its own
 * handlers afterward without double-firing.
 *
 * Extracted from transcription-actor.ts to keep that file under the
 * max-lines budget; used by its reconnect loop.
 */
export function waitForOpen(ws: WebSocket, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.OPEN) {
      resolve(true);
      return;
    }
    const finish = (ok: boolean) => {
      clearTimeout(timer);
      ws.removeEventListener("open", onOpen);
      ws.removeEventListener("error", onFail);
      ws.removeEventListener("close", onFail);
      resolve(ok);
    };
    const onOpen = () => finish(true);
    const onFail = () => finish(false);
    const timer = setTimeout(() => finish(false), timeoutMs);
    ws.addEventListener("open", onOpen);
    ws.addEventListener("error", onFail);
    ws.addEventListener("close", onFail);
  });
}

/**
 * Open a connection, retrying a transient failure-to-open with jittered backoff
 * before giving up. Used for the *initial* socket of a segment: a fresh
 * WebSocket that errors at connect (the symptom this work targets) is usually
 * transient, so a couple of quick retries recover it without the user noticing.
 * Returns the opened handle, or null if every attempt failed or `isAborted`
 * went true. Each non-opening handle is handed to `discard` for teardown.
 */
export async function openWithRetry(
  open: () => Promise<ConnectionHandle>,
  opts: {
    attempts: number;
    attemptTimeoutMs: number;
    backoff: { baseMs: number; capMs: number };
    isAborted: () => boolean;
    discard: (handle: ConnectionHandle) => void;
  },
): Promise<ConnectionHandle | null> {
  for (let attempt = 1; attempt <= opts.attempts && !opts.isAborted(); attempt++) {
    const handle = await open();
    if (opts.isAborted()) {
      opts.discard(handle);
      return null;
    }
    if (await waitForOpen(handle.ws, opts.attemptTimeoutMs)) return handle;
    opts.discard(handle);
    console.warn(`[realtime-transcription] connect attempt ${attempt}/${opts.attempts} failed`);
    if (attempt < opts.attempts) await delay(jitteredBackoff(attempt, opts.backoff));
  }
  return null;
}
