/**
 * Messages between the popup and the background service worker, and the
 * uniform action response the popup renders from.
 */

export interface SyncTabsMessage {
  type: "syncTabs";
}

export interface CommentOnPageMessage {
  type: "commentOnPage";
  tabId: number;
  /** Box-relative dir of a chosen commentary destination; omitted → inbox. */
  destinationDir?: string;
}

export type ClerkMessage = SyncTabsMessage | CommentOnPageMessage;

export interface ActionFailure {
  ok: false;
  /** HTTP status; 0 for network/internal failures. */
  status: number;
  message: string;
}

export type ActionResponse = { ok: true } | ActionFailure;

export function isClerkMessage(value: unknown): value is ClerkMessage {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return record.type === "syncTabs" || record.type === "commentOnPage";
}
