/**
 * Message the on-demand commentary-capture content script sends back to the
 * background once it has run (the injected script can't return a value to
 * chrome.scripting.executeScript, so it posts the result instead).
 */

import type { CommentaryCapture } from "./commentary.js";
import { isRecord } from "./is-record.js";

export const CAPTURE_RESULT = "commentaryCaptureResult" as const;

export type CaptureResultMessage =
  | { type: typeof CAPTURE_RESULT; capture: CommentaryCapture }
  | { type: typeof CAPTURE_RESULT; error: string };

export function isCaptureResultMessage(value: unknown): value is CaptureResultMessage {
  return isRecord(value) && value["type"] === CAPTURE_RESULT;
}
