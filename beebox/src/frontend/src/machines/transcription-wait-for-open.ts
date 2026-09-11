import type { ConnectionHandle } from "./transcription-connections";

/**
 * Promise wrapper around a WebSocket's open/error/close events. Resolves
 * true once the socket opens; false on error, close, or a timeout (in ms).
 * Listeners are removed on either outcome so the caller can wire its own
 * handlers afterward without double-firing.
 *
 * Extracted from transcription-actor.ts to keep that file under the
 * max-lines budget; used by its connect loop.
 */
function waitForOpen(ws: WebSocket, timeoutMs: number): Promise<boolean> {
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
 * One connection attempt: open, then wait up to `attemptTimeoutMs` for the
 * socket to open. Returns the open handle, or null after handing a socket
 * that never opened to `discard`. The actor's single connect loop owns
 * retry and backoff; this is one turn of it.
 */
export async function openOnce(
  open: () => Promise<ConnectionHandle>,
  opts: { attemptTimeoutMs: number; discard: (handle: ConnectionHandle) => void },
): Promise<ConnectionHandle | null> {
  const handle = await open();
  if (await waitForOpen(handle.ws, opts.attemptTimeoutMs)) return handle;
  opts.discard(handle);
  return null;
}
