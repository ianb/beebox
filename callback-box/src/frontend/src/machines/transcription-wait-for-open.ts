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
