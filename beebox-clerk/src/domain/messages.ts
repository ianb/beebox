/**
 * Messages between the popup and the background service worker, and the
 * uniform action response the popup renders from.
 */

import { isRecord } from "./is-record.js";
import type { SendOutcome } from "./send.js";

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

/** Capture the tab and send it with the note to the active box. */
export interface SendToBoxMessage {
  type: "sendToBox";
  tabId: number;
  note: string;
}

/** Resend a kept send under the same id, to the box it first went to. */
export interface RetrySendMessage {
  type: "retrySend";
  id: string;
}

/** Choose where a send that needs a choice goes. */
export interface ChooseSendMessage {
  type: "chooseSend";
  id: string;
  candidateId: string;
}

export type ClerkMessage =
  | SendToBoxMessage
  | RetrySendMessage
  | ChooseSendMessage
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
  organizerOpened?: boolean | undefined;
}

/** The answer to sendToBox, retrySend, and chooseSend. */
export interface SendActionResult {
  kind: "send";
  id: string;
  /** The box this send went to (it may no longer be the active box). */
  boxUrl: string;
  outcome: SendOutcome;
}

export type ActionResult = SharedTabsResult | SendActionResult;

export type ActionResponse = { ok: true; result?: ActionResult | undefined } | ActionFailure;

export function isClerkMessage(value: unknown): value is ClerkMessage {
  if (!isRecord(value)) return false;
  if (value["type"] === "sendToBox") {
    return typeof value["tabId"] === "number" && typeof value["note"] === "string";
  }
  if (value["type"] === "retrySend") {
    return typeof value["id"] === "string";
  }
  if (value["type"] === "chooseSend") {
    return typeof value["id"] === "string" && typeof value["candidateId"] === "string";
  }
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
