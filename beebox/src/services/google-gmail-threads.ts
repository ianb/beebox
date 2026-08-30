/** Thread-list operation split from the Gmail service implementation. */

import type { KyInstance } from "ky";
import { validateResponse } from "./connector-response.js";
import { gmailListThreadsSchema } from "./google-gmail-schemas.js";
import type { ListThreadsResult } from "./google-gmail-types.js";

export async function listGmailThreads(
  api: KyInstance,
  opts: { q?: string; maxResults?: number },
): Promise<ListThreadsResult> {
  const searchParams: Record<string, string> = {};
  if (opts.q) searchParams["q"] = opts.q;
  if (opts.maxResults !== undefined) searchParams["maxResults"] = String(opts.maxResults);
  const data = await api
    .get("users/me/threads", { searchParams })
    .json<{ threads?: Array<{ id: string }>; nextPageToken?: string; resultSizeEstimate?: number }>();
  validateResponse(data, { schema: gmailListThreadsSchema, service: "gmail", operation: "listThreads" });
  const result: ListThreadsResult = { threads: data.threads ?? [] };
  if (data.nextPageToken) result.nextPageToken = data.nextPageToken;
  if (data.resultSizeEstimate !== undefined) result.resultSizeEstimate = data.resultSizeEstimate;
  return result;
}
