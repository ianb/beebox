/**
 * The one activity queue of this page, sending to the `activity.record`
 * mutation, and the entry builder every reporter goes through.
 */

import type { ActivityEntryInput } from "@core/activity/entry.js";
import { boxNow } from "../box-clock";
import { trpcClient } from "../trpc/client";
import { ActivityQueue, realTimers } from "./queue";

/** How long one request may go unanswered before it counts as failed. */
const REQUEST_TIMEOUT_MS = 30_000;

let pageQueue: ActivityQueue | null = null;

function queue(): ActivityQueue {
  pageQueue ??= new ActivityQueue({
    // A request with no answer in 30 s counts as failed, so the one-minute drop applies and the
    // queue cannot stall. A server that stalls past that can still save the batch late: out of
    // order or twice. Accepted for a best-effort log (boxholder, 2026-11-13).
    transport: (entries) => trpcClient.activity.record.mutate({ entries }, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }),
    timers: realTimers,
  });
  return pageQueue;
}

/** Which conversation an entry belongs to, as the page knows it. */
export interface ActivityScope {
  /** The session id the page has selected. */
  chat?: string;
  /** The page's key for a new conversation that has no session id yet. */
  pendingChat?: string;
  /** The last message id this page sent in that conversation. */
  afterMessage?: string;
}

/** What a reporter supplies; the scope and time are added. */
export type ActivityReport = Pick<ActivityEntryInput, "card" | "kind"> & Partial<Pick<ActivityEntryInput, "via" | "detail" | "activity">>;

/** Queue one entry, stamped with the scope and the page's time. Never throws. */
export function logActivity(report: ActivityReport, scope: ActivityScope): void {
  const { card, kind, via, detail, activity } = report;
  queue().push({
    card, kind,
    ...(via !== undefined ? { via } : {}),
    ...(detail !== undefined ? { detail } : {}),
    ...(activity !== undefined ? { activity } : {}),
    ...(scope.chat !== undefined ? { chat: scope.chat } : {}),
    ...(scope.pendingChat !== undefined ? { pendingChat: scope.pendingChat } : {}),
    ...(scope.afterMessage !== undefined ? { afterMessage: scope.afterMessage } : {}),
    clientAt: new Date(boxNow()).toISOString(),
  });
}

/** Send what is queued; resolves when empty or after `timeoutMs`. Never rejects. */
export function flushActivity(timeoutMs: number): Promise<void> {
  return pageQueue === null ? Promise.resolve() : pageQueue.flush(timeoutMs);
}
