/**
 * Thin client for the box-hosted clerk API — the `clerk` tRPC router
 * (callback-box src/webapp/trpc/routers/clerk.ts), called over its plain
 * HTTP transport. Auth is the browser's own session cookie:
 * credentials:"include" plus the per-origin host permission granted when the
 * box was enabled.
 */

import type { EnabledBox } from "../domain/config.js";
import type { CommentaryDestination, CommentaryPayload } from "../domain/commentary.js";

export class ClerkApiError extends Error {
  constructor(
    readonly status: number,
    options: { endpoint: string; detail: string },
  ) {
    super(`Clerk API ${options.endpoint} failed (${status === 0 ? "network" : status}): ${options.detail}`);
    this.name = "ClerkApiError";
  }
}

export function isAuthError(error: unknown): boolean {
  return error instanceof ClerkApiError && (error.status === 401 || error.status === 403);
}

async function fetchOrThrow(url: string, init: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, { credentials: "include", ...init });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new ClerkApiError(0, { endpoint: url, detail });
  }
  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.text()).slice(0, 300);
    } catch (e) {
      detail = e instanceof Error ? e.message : String(e);
    }
    throw new ClerkApiError(res.status, { endpoint: url, detail });
  }
  return res;
}

/**
 * Call a tRPC query/mutation on the box (non-batched form) and unwrap the
 * `{ result: { data } }` envelope. The clerk endpoints moved from raw routes to
 * the `clerk` tRPC router; the transport is otherwise unchanged (credentialed
 * cross-origin fetch via the box host permission).
 */
async function trpcQuery<T>(box: EnabledBox, procedure: string): Promise<T> {
  const res = await fetchOrThrow(`${box.boxUrl}/api/trpc/${procedure}`, { method: "GET" });
  const body: { result: { data: T } } = await res.json();
  return body.result.data;
}

async function trpcMutation<T>(box: EnabledBox, opts: { procedure: string; input: unknown }): Promise<T> {
  const res = await fetchOrThrow(`${box.boxUrl}/api/trpc/${opts.procedure}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts.input),
  });
  const body: { result: { data: T } } = await res.json();
  return body.result.data;
}

export async function getCommentaryDestinations(box: EnabledBox): Promise<CommentaryDestination[]> {
  const data = await trpcQuery<{ destinations: CommentaryDestination[] }>(box, "clerk.commentaryDestinations");
  return data.destinations;
}

export async function postCommentary(
  box: EnabledBox,
  payload: CommentaryPayload,
): Promise<{ created: string[]; open: string }> {
  return trpcMutation(box, { procedure: "clerk.commentary", input: payload });
}
