/**
 * Message the on-demand capture content script sends back to the background
 * once it has run (the injected script can't return a value to
 * chrome.scripting.executeScript, so it posts the result instead).
 *
 * Correlation: the background sets a request id in the extension's isolated
 * world under `CAPTURE_REQUEST_GLOBAL` just before injecting the script. The
 * script copies it into a local constant and deletes the global as its first
 * statement, and echoes it in its result. The background accepts only a result
 * with that id from that tab (`captureResultMatches`), so a second capture in
 * another tab, or a late result from an earlier timed-out capture, is ignored.
 */

import type { CommentaryCapture } from "./commentary.js";
import { isRecord } from "./is-record.js";

export const CAPTURE_RESULT = "commentaryCaptureResult" as const;

/** The isolated-world global that carries one capture's request id into the script. */
export const CAPTURE_REQUEST_GLOBAL = "__beeboxClerkCaptureRequestId" as const;

export type CaptureResultMessage =
  | { type: typeof CAPTURE_RESULT; requestId: string; capture: CommentaryCapture }
  | { type: typeof CAPTURE_RESULT; requestId: string; error: string };

export function isCaptureResultMessage(value: unknown): value is CaptureResultMessage {
  return isRecord(value) && value["type"] === CAPTURE_RESULT && typeof value["requestId"] === "string";
}

/**
 * Takes the request id the background left for this injection and removes it,
 * so a later injection can't read a stale id. Returns "" when none was set (the
 * background then matches nothing, and the capture times out).
 */
export function takeCaptureRequestId(scope: object): string {
  const value: unknown = Reflect.get(scope, CAPTURE_REQUEST_GLOBAL);
  Reflect.deleteProperty(scope, CAPTURE_REQUEST_GLOBAL);
  return typeof value === "string" ? value : "";
}

/**
 * True when `message` is the result of the capture the background started with
 * `requestId` in tab `tabId`. `senderTabId` is the runtime sender's tab id.
 */
export function captureResultMatches(
  message: unknown,
  expected: { requestId: string; tabId: number; senderTabId: number | undefined },
): message is CaptureResultMessage {
  return (
    isCaptureResultMessage(message) &&
    expected.requestId !== "" &&
    message.requestId === expected.requestId &&
    expected.senderTabId === expected.tabId
  );
}
