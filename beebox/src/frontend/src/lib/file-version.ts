/**
 * Per-path cache-buster tokens for box files served by `/api/files/*`.
 *
 * Why this exists: the backend serves files with `Cache-Control: no-cache`
 * plus an mtime/size ETag, so a *fresh* request always revalidates and gets
 * the current bytes. But when an agent overwrites a file (e.g. regenerating
 * a character portrait at the same path) while the chat is open, the browser
 * serves the already-loaded image from its in-memory cache to any new `<img>`
 * with the same URL — `no-cache` never gets a chance to fire because no
 * network request is made. The only thing that reliably misses that cache is
 * a different URL.
 *
 * So we stamp a `?v=<token>` on image URLs whose file has changed *this
 * session*, where the token comes from the `file-change` SSE event's
 * timestamp (the box file watcher emits one on every overwrite — see
 * `webapp/routes/sse.ts`). Files that haven't changed get no param, so first
 * loads stay clean and cross-reload freshness keeps relying on the ETag.
 *
 * Keyed by box-relative path (e.g. `_content/mara.webp`), matching the path in
 * `file-change` events.
 */

import { useCallback, useSyncExternalStore } from "react";

const versions = new Map<string, string>();
const pathListeners = new Map<string, Set<() => void>>();

const API_FILES_MARKER = "/api/files/";

/**
 * Record a new version token for a path and notify subscribers. Call this
 * from the `file-change` SSE handler with the event's timestamp.
 */
export function bumpFileVersion(path: string, stamp: string): void {
  if (versions.get(path) === stamp) return;
  versions.set(path, stamp);
  const listeners = pathListeners.get(path);
  if (listeners) {
    for (const notify of listeners) notify();
  }
}

/** Current version token for a path, or undefined if it hasn't changed this session. */
function getFileVersion(path: string): string | undefined {
  return versions.get(path);
}

/**
 * Extract the box-relative file path from a resolved `/api/files/<path>` URL,
 * or null if the URL isn't a box-file URL. Strips any query/hash.
 */
function fileVersionPath(resolvedUrl: string): string | null {
  const i = resolvedUrl.indexOf(API_FILES_MARKER);
  if (i === -1) return null;
  const rest = resolvedUrl.slice(i + API_FILES_MARKER.length);
  return rest.replace(/[#?].*$/, "");
}

function appendVersion(url: string, stamp: string | undefined): string {
  if (!stamp) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}v=${stamp}`;
}

/**
 * Reactively cache-bust a resolved box-file URL: appends `?v=<token>` when the
 * file has changed this session, and re-renders the calling component when a
 * later change bumps the token. Pass through unchanged for non-box URLs.
 */
export function useBustedImageSrc(resolvedUrl: string): string {
  const path = fileVersionPath(resolvedUrl);
  const subscribe = useCallback(
    (notify: () => void) => {
      if (!path) return () => {};
      let listeners = pathListeners.get(path);
      if (!listeners) {
        listeners = new Set();
        pathListeners.set(path, listeners);
      }
      listeners.add(notify);
      return () => {
        listeners.delete(notify);
        if (listeners.size === 0) pathListeners.delete(path);
      };
    },
    [path],
  );
  const getSnapshot = useCallback(() => (path ? getFileVersion(path) : undefined), [path]);
  const stamp = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return appendVersion(resolvedUrl, stamp);
}

/**
 * Non-reactive variant for code that builds URLs outside React render (e.g.
 * the lightbox image list). Reads the current token synchronously.
 */
export function bustImageSrc(resolvedUrl: string): string {
  const path = fileVersionPath(resolvedUrl);
  return appendVersion(resolvedUrl, path ? getFileVersion(path) : undefined);
}
