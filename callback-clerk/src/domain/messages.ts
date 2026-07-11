/**
 * Messages between the popup and the background service worker, and the
 * uniform action response the popup renders from.
 */

import { isRecord } from "./is-record.js";

export interface CommentOnPageMessage {
  type: "commentOnPage";
  tabId: number;
  /** Box-relative dir of a chosen commentary destination; omitted → inbox. */
  destinationDir?: string;
}

export type ClerkMessage = CommentOnPageMessage;

export interface ActionFailure {
  ok: false;
  /** HTTP status; 0 for network/internal failures. */
  status: number;
  message: string;
}

export type ActionResponse = { ok: true } | ActionFailure;

export function isClerkMessage(value: unknown): value is ClerkMessage {
  return isRecord(value) && value["type"] === "commentOnPage";
}
