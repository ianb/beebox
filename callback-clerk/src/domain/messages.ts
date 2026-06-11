/**
 * Messages between the popup and the background service worker, and the
 * uniform action response the popup renders from.
 */

import type { SaveIntent } from "./save-page.js";

export interface SendMemoMessage {
  type: "sendMemo";
  text: string;
  url?: string;
  title?: string;
}

export interface SavePageMessage {
  type: "savePage";
  intent: SaveIntent;
  tabId: number;
}

export interface SyncTabsMessage {
  type: "syncTabs";
}

export type ClerkMessage = SendMemoMessage | SavePageMessage | SyncTabsMessage;

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
  return (
    record.type === "sendMemo" || record.type === "savePage" || record.type === "syncTabs"
  );
}
