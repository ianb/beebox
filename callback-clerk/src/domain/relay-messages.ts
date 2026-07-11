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

/** Marker on messages the page sends TO the relay content script. */
export const RELAY_APP_SOURCE = "callback-box-app" as const;
/** Marker on messages the relay content script sends TO the page. */
export const RELAY_SOURCE = "callback-clerk-relay" as const;

export type CaptureFailureReason = "not-capturable" | "busy" | "not-enabled" | "error";

export type CaptureResult =
  | { ok: true; dataUrl: string }
  | { ok: false; reason: CaptureFailureReason; message?: string };

// --- page -> content script (window.postMessage) ---------------------------

export type RelayPageMessage =
  | { source: typeof RELAY_APP_SOURCE; type: "relay-ping" }
  | { source: typeof RELAY_APP_SOURCE; type: "capture-request"; correlationId: string };

/** Validates an inbound window message; returns null for anything unrelated. */
export function parseRelayPageMessage(value: unknown): RelayPageMessage | null {
  if (!isRecord(value) || value["source"] !== RELAY_APP_SOURCE) return null;
  if (value["type"] === "relay-ping") {
    return { source: RELAY_APP_SOURCE, type: "relay-ping" };
  }
  if (value["type"] === "capture-request" && typeof value["correlationId"] === "string") {
    return { source: RELAY_APP_SOURCE, type: "capture-request", correlationId: value["correlationId"] };
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
    };

export function relayReady(): RelayContentMessage {
  return { source: RELAY_SOURCE, type: "relay-ready" };
}

export function captureResponse(correlationId: string, result: CaptureResult): RelayContentMessage {
  return { source: RELAY_SOURCE, type: "capture-response", correlationId, result };
}

// --- content script -> background (chrome.runtime.sendMessage) --------------

export const RELAY_CAPTURE = "clerkRelayCapture" as const;

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
