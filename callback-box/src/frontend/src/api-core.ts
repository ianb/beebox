/**
 * Core API client primitives shared across the api.ts surface and its
 * siblings: URL/base construction, a custom streaming error, and the shared
 * JSON fetch helper. Kept separate so api.ts and api-chat.ts can both use
 * them without an import cycle.
 */

import { RequestError } from "./lib/errors";

/** A streaming response arrived without a readable body. */
export class NoResponseBodyError extends Error {
  constructor() {
    super("No response body");
    this.name = "NoResponseBodyError";
  }
}

/**
 * Pure helper exported for testability: combine a base URL prefix and a
 * path. Kept separate from `withBase()` so the join logic can be unit-
 * tested without import.meta.env runtime dependency.
 *
 *   joinBaseAndPath("/",      "/api/foo") === "/api/foo"
 *   joinBaseAndPath("/main/", "/api/foo") === "/main/api/foo"
 *   joinBaseAndPath("/main",  "/api/foo") === "/main/api/foo"
 *   joinBaseAndPath("/main/", "api/foo")  === "/main/api/foo"
 */
export function joinBaseAndPath(base: string, p: string): string {
  const prefix = base.replace(/\/$/, "");
  if (!prefix) return p.startsWith("/") ? p : `/${p}`;
  return p.startsWith("/") ? `${prefix}${p}` : `${prefix}/${p}`;
}

/**
 * Prefix an absolute path with the Vite base URL (set via the `base` option
 * in vite.config.ts, surfaced at runtime as `import.meta.env.BASE_URL`).
 *
 * Use this any time you have a hardcoded URL like "/api/something" or
 * "/auth/login" that goes through Vite/the router. Without prefixing,
 * the router sees the first segment as the worktree name and 404s.
 *
 * In prod (base="/", the Vite default) this is a no-op — BASE_URL is "/"
 * which the helper treats as empty prefix.
 */
export function withBase(p: string): string {
  return joinBaseAndPath(import.meta.env.BASE_URL ?? "/", p);
}

/**
 * Get the API base URL for the current box, derived from the URL's first
 * path segment after the Vite base path.
 *
 * In dev under the monorepo router the URL shape is
 *   /<worktree>/<box>/... → API base is /<worktree>/<box>/api
 * Vite's `base` is set to `/<worktree>/` at build/dev time and exposed via
 * import.meta.env.BASE_URL, so we strip it before parsing the box.
 *
 * In prod (and dev without a base) the URL shape is just /<box>/...
 */
export function getApiBase(): string {
  const base = import.meta.env.BASE_URL ?? "/"; // e.g. "/main/" or "/"
  const pathname = window.location.pathname;
  // Strip the base prefix if present.
  const stripped = pathname.startsWith(base)
    ? pathname.slice(base.length - (base.endsWith("/") ? 1 : 0))
    : pathname;
  const firstSegment = stripped.split("/")[1] || "";
  const prefix = base.replace(/\/$/, "");
  if (!firstSegment) return `${prefix}/api`;
  return `${prefix}/${firstSegment}/api`;
}

/**
 * Absolute ws:// / wss:// URL for the box's tRPC WebSocket endpoint, used by
 * the subscription `wsLink`. Built from the page origin + the box-scoped API
 * base (so it rides the same router → Vite → Fastify proxy chain SSE used),
 * upgraded to the secure scheme when the page is HTTPS.
 */
export function getWebSocketUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}${getApiBase()}/trpc`;
}

// --- Shared fetch helper ---

export async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (response.status === 401) {
    const returnTo = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = withBase(`/auth/login?returnTo=${returnTo}`);
    // Never resolves — page is navigating away
    return new Promise(() => {});
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new RequestError(error.error || error.message || "Request failed");
  }

  return response.json();
}
