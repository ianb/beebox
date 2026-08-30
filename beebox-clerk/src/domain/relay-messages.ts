/**
 * The box-relay protocol (Track C of docs/plans/see-as-the-user.md).
 *
 * Two transports, three message families:
 *  - page <-> content script, over `window.postMessage` (strict origin +
 *    source-window checks on both ends);
 *  - content script -> background, over `chrome.runtime.sendMessage`.
 *
 * The `source` markers namespace our messages off the shared window bus so an
 * unrelated page script's `postMessage` can never be mistaken for a relay
 * message (and vice versa).
 */

import { isRecord } from "./is-record.js";
import type { TabArrangementPayload } from "../contract/clerk-contract.generated.js";

/** Marker on messages the page sends TO the relay content script. */
export const RELAY_APP_SOURCE = "beebox-app" as const;
/** Marker on messages the relay content script sends TO the page. */
export const RELAY_SOURCE = "beebox-clerk-relay" as const;

export type CaptureFailureReason = "not-capturable" | "busy" | "not-enabled" | "error";

export type CaptureResult =
  | { ok: true; dataUrl: string }
  | { ok: false; reason: CaptureFailureReason; message?: string };

export type TabArrangementResult =
  | { ok: true; state: "ready" | "applied" | "partial"; message: string; undoAvailable: boolean }
  | { ok: false; reason: "stale" | "invalid" | "not-enabled" | "not-found" | "error"; message: string };

// --- page -> content script (window.postMessage) ---------------------------

export type RelayPageMessage =
  | { source: typeof RELAY_APP_SOURCE; type: "relay-ping" }
  | { source: typeof RELAY_APP_SOURCE; type: "capture-request"; correlationId: string }
  | { source: typeof RELAY_APP_SOURCE; type: "tab-arrangement-status-request"; correlationId: string; transferId: string }
  | {
      source: typeof RELAY_APP_SOURCE;
      type: "tab-arrangement-apply-request";
      correlationId: string;
      transferId: string;
      proposal: TabArrangementPayload["proposal"];
    }
  | { source: typeof RELAY_APP_SOURCE; type: "tab-arrangement-undo-request"; correlationId: string; transferId: string };

/** Validates an inbound window message; returns null for anything unrelated. */
export function parseRelayPageMessage(value: unknown): RelayPageMessage | null {
  if (!isRecord(value) || value["source"] !== RELAY_APP_SOURCE) return null;
  if (value["type"] === "relay-ping") {
    return { source: RELAY_APP_SOURCE, type: "relay-ping" };
  }
  if (value["type"] === "capture-request" && typeof value["correlationId"] === "string") {
    return { source: RELAY_APP_SOURCE, type: "capture-request", correlationId: value["correlationId"] };
  }
  const correlationId = value["correlationId"];
  const transferId = value["transferId"];
  if (typeof correlationId !== "string" || typeof transferId !== "string") return null;
  if (value["type"] === "tab-arrangement-status-request") {
    return { source: RELAY_APP_SOURCE, type: value["type"], correlationId, transferId };
  }
  if (value["type"] === "tab-arrangement-undo-request") {
    return { source: RELAY_APP_SOURCE, type: value["type"], correlationId, transferId };
  }
  if (value["type"] === "tab-arrangement-apply-request" && isProposal(value["proposal"])) {
    return { source: RELAY_APP_SOURCE, type: value["type"], correlationId, transferId, proposal: value["proposal"] };
  }
  return null;
}

// --- content script -> page (window.postMessage) ---------------------------

export type RelayContentMessage =
  | { source: typeof RELAY_SOURCE; type: "relay-ready" }
  | {
      source: typeof RELAY_SOURCE;
      type: "capture-response";
      correlationId: string;
      result: CaptureResult;
    }
  | {
      source: typeof RELAY_SOURCE;
      type: "tab-arrangement-response";
      correlationId: string;
      result: TabArrangementResult;
    };

export function relayReady(): RelayContentMessage {
  return { source: RELAY_SOURCE, type: "relay-ready" };
}

export function captureResponse(correlationId: string, result: CaptureResult): RelayContentMessage {
  return { source: RELAY_SOURCE, type: "capture-response", correlationId, result };
}

export function tabArrangementResponse(
  correlationId: string,
  result: TabArrangementResult,
): RelayContentMessage {
  return { source: RELAY_SOURCE, type: "tab-arrangement-response", correlationId, result };
}

// --- content script -> background (chrome.runtime.sendMessage) --------------

export const RELAY_CAPTURE = "clerkRelayCapture" as const;
export const RELAY_TAB_ARRANGEMENT = "clerkRelayTabArrangement" as const;

export interface RelayCaptureMessage {
  type: typeof RELAY_CAPTURE;
  correlationId: string;
}

export function isRelayCaptureMessage(value: unknown): value is RelayCaptureMessage {
  return (
    isRecord(value) &&
    value["type"] === RELAY_CAPTURE &&
    typeof value["correlationId"] === "string"
  );
}

export interface RelayTabArrangementMessage {
  type: typeof RELAY_TAB_ARRANGEMENT;
  action: "status" | "apply" | "undo";
  transferId: string;
  proposal?: TabArrangementPayload["proposal"] | undefined;
  /** Set only by the isolated Clerk content script after its own user confirmation. */
  confirmed?: true | undefined;
}

export function isRelayTabArrangementMessage(value: unknown): value is RelayTabArrangementMessage {
  return (
    isRecord(value) &&
    value["type"] === RELAY_TAB_ARRANGEMENT &&
    (value["action"] === "status" || value["action"] === "apply" || value["action"] === "undo") &&
    typeof value["transferId"] === "string" &&
    (value["proposal"] === undefined || isProposal(value["proposal"])) &&
    (value["action"] === "status" || value["confirmed"] === true)
  );
}

function isProposal(value: unknown): value is TabArrangementPayload["proposal"] {
  if (!isRecord(value) || !Array.isArray(value["windows"]) || !Array.isArray(value["close"])) return false;
  if (!value["close"].every((id) => typeof id === "string")) return false;
  return value["windows"].every((window) => (
    isRecord(window) &&
    typeof window["id"] === "string" &&
    Array.isArray(window["tabs"]) &&
    window["tabs"].every((id) => typeof id === "string")
  ));
}
