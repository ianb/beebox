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

export interface ShareTabsMessage {
  type: "shareTabs";
  scope: "current-window" | "all-windows";
  sourceWindowId: number;
}

export interface OpenTabOrganizerMessage {
  type: "openTabOrganizer";
  transferId: string;
}

export interface GetLatestTabTransferMessage {
  type: "getLatestTabTransfer";
}

export type ClerkMessage =
  | CommentOnPageMessage
  | ShareTabsMessage
  | OpenTabOrganizerMessage
  | GetLatestTabTransferMessage;

export interface ActionFailure {
  ok: false;
  /** HTTP status; 0 for network/internal failures. */
  status: number;
  message: string;
}

export interface SharedTabsResult {
  kind: "shared-tabs";
  transferId: string;
  tabCount: number;
  replacedUndo?: boolean | undefined;
}

export type ActionResponse = { ok: true; result?: SharedTabsResult | undefined } | ActionFailure;

export function isClerkMessage(value: unknown): value is ClerkMessage {
  if (!isRecord(value)) return false;
  if (value["type"] === "commentOnPage") {
    return typeof value["tabId"] === "number";
  }
  if (value["type"] === "shareTabs") {
    return (
      (value["scope"] === "current-window" || value["scope"] === "all-windows") &&
      typeof value["sourceWindowId"] === "number"
    );
  }
  if (value["type"] === "openTabOrganizer") {
    return typeof value["transferId"] === "string";
  }
  return value["type"] === "getLatestTabTransfer";
}
