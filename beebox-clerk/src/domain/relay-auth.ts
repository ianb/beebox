/**
 * Pure authorization + match-pattern helpers for the box-relay content script
 * (Track C of docs/plans/see-as-the-user.md).
 *
 * Two distinct URL notions live here, and the difference is load-bearing:
 *
 *  - **Match patterns** (`boxUrlToMatchPatterns`) decide *where the content
 *    script is injected*. Chrome match patterns are `<scheme>://<host><path>`
 *    and CANNOT express a port — a pattern's host part is portless and matches
 *    ANY port. On the dev router (and any multi-box host) many boxes share one
 *    host:port and are distinguished only by path, so we scope by path, and the
 *    portless match pattern for `http://localhost:3210/main/test1` deliberately
 *    also matches the same path on every other port of `localhost`.
 *  - **The real gate** (`isUrlUnderBoxUrl`) is applied in the background before
 *    any capture and compares the FULL origin including port against the stored
 *    boxUrl. The over-broad (port-blind) content-script match is therefore never
 *    the authorization boundary; it only narrows injection to plausible pages.
 */

export interface BoxUrlParts {
  scheme: string;
  host: string;
  /** Pathname without a trailing slash; "" for an origin-root box. */
  path: string;
}

function splitBoxUrl(boxUrl: string): BoxUrlParts | null {
  let url: URL;
  try {
    url = new URL(boxUrl);
  } catch (e) {
    if (e instanceof TypeError) return null;
    throw e;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return {
    scheme: url.protocol.replace(/:$/, ""),
    host: url.hostname, // hostname, NOT host — match patterns forbid a port
    path: url.pathname.replace(/\/$/, ""),
  };
}

/**
 * Match patterns for the relay content script covering a box's root URL and
 * everything under it. Ports are dropped (Chrome match patterns can't express
 * them — see the module comment). Returns [] for a boxUrl we can't parse.
 *
 *   http://localhost:3210/main/test1  ->  ["http://localhost/main/test1",
 *                                          "http://localhost/main/test1/*"]
 *   https://beebox.example.com/main       ->  ["https://beebox.example.com/main",
 *                                          "https://beebox.example.com/main/*"]
 *   https://box.example.com           ->  ["https://box.example.com/*"]
 */
export function boxUrlToMatchPatterns(boxUrl: string): string[] {
  const parts = splitBoxUrl(boxUrl);
  if (parts === null) return [];
  const { scheme, host, path } = parts;
  // An origin-root box owns the whole host; a path-scoped box matches its root
  // exactly plus any descendant. `${path}/*` alone would miss the bare root URL
  // (no trailing slash), so the exact `${path}` pattern is registered too.
  if (path === "") return [`${scheme}://${host}/*`];
  return [`${scheme}://${host}${path}`, `${scheme}://${host}${path}/*`];
}

/**
 * True when `url` is the box root or a page under it — the real capture gate,
 * comparing the FULL origin (scheme+host+port), unlike the port-blind match
 * patterns. Query string and hash are ignored.
 */
export function isUrlUnderBoxUrl(url: string, boxUrl: string): boolean {
  let target: URL;
  let base: URL;
  try {
    target = new URL(url);
    base = new URL(boxUrl);
  } catch (e) {
    if (e instanceof TypeError) return false;
    throw e;
  }
  if (target.origin !== base.origin) return false;
  const basePath = base.pathname.replace(/\/$/, "");
  if (basePath === "") return true; // origin-root box
  return target.pathname === basePath || target.pathname.startsWith(`${basePath}/`);
}

/**
 * Maps a `captureVisibleTab` rejection message to a relay failure reason. The
 * 2-calls/sec quota trips with a message naming
 * MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND ("...exceeds MAX...") — that is a
 * transient overload the page retries, so it maps to `busy`; anything else is
 * an honest `error`.
 */
export function captureErrorReason(message: string): "busy" | "error" {
  return /max_capture_visible_tab_calls_per_second|quota/i.test(message) ? "busy" : "error";
}
