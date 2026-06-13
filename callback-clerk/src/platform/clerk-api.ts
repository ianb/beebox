/**
 * Thin client for the box-hosted clerk API
 * (callback-box src/webapp/routes/clerk.ts). Auth is the browser's own
 * session cookie: credentials:"include" plus the per-origin host
 * permission granted when the box was enabled.
 */

import type { EnabledBox } from "../domain/config.js";
import type { SavePagePayload } from "../domain/save-page.js";
import type { CommentaryDestination, CommentaryPayload } from "../domain/commentary.js";
import type { TabInfo } from "./tabs.js";

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

async function postJson(url: string, body: unknown): Promise<void> {
  await fetchOrThrow(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function postJsonResult<T>(url: string, body: unknown): Promise<T> {
  const res = await fetchOrThrow(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data: T = await res.json();
  return data;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetchOrThrow(url, { method: "GET" });
  const data: T = await res.json();
  return data;
}

export async function postMemo(
  box: EnabledBox,
  memo: { text: string; url?: string; title?: string },
): Promise<void> {
  const context = memo.url === undefined ? undefined : { url: memo.url, title: memo.title };
  await postJson(`${box.boxUrl}/api/clerk/memo`, {
    text: memo.text,
    context,
    timestamp: new Date().toISOString(),
  });
}

export async function postSavePage(box: EnabledBox, payload: SavePagePayload): Promise<void> {
  await postJson(`${box.boxUrl}/api/clerk/save-page`, payload);
}

export async function postTabs(box: EnabledBox, tabs: TabInfo[]): Promise<void> {
  await postJson(`${box.boxUrl}/api/clerk/tabs`, { tabs });
}

export async function getCommentaryDestinations(box: EnabledBox): Promise<CommentaryDestination[]> {
  const data = await getJson<{ destinations: CommentaryDestination[] }>(
    `${box.boxUrl}/api/clerk/commentary-destinations`,
  );
  return data.destinations;
}

export async function postCommentary(
  box: EnabledBox,
  payload: CommentaryPayload,
): Promise<{ created: string[]; open: string }> {
  return postJsonResult(`${box.boxUrl}/api/clerk/commentary`, payload);
}
