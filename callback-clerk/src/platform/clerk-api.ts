/**
 * Thin client for the box-hosted clerk API
 * (callback-box src/webapp/routes/clerk.ts). Auth is the browser's own
 * session cookie: credentials:"include" plus the per-origin host
 * permission granted when the box was enabled.
 */

import type { EnabledBox } from "../domain/config.js";
import type { SavePagePayload } from "../domain/save-page.js";
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

async function postJson(url: string, body: unknown): Promise<void> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
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
