/**
 * Correct the key code on typed characters bound for the box browser.
 *
 * The agent-browser dashboard (0.39.2) sends a printable key with
 * `windowsVirtualKeyCode` set to the character's code point. Chrome reads that
 * field as a Windows virtual-key code, and code points below 48 name editing
 * keys: "." (46) is Delete, "-" (45) Insert, "(" (40) Down, "'" (39) Right,
 * "&" (38) Up, "%" (37) Left, "$" (36) Home, "#" (35) End. So typing a period
 * into a page deleted the next character (2026-11-13). This rewrites the code
 * from the physical key (`code`), the way a real keyboard reports it.
 */

import type { RawData } from "ws";
import { isRecord } from "../../../../shared/is-record.js";

/** Windows virtual-key codes for the physical keys that type characters (US layout positions). */
const PUNCTUATION_KEY_CODES: Readonly<Record<string, number>> = {
  Space: 32, Semicolon: 186, Equal: 187, Comma: 188, Minus: 189, Period: 190, Slash: 191, Backquote: 192,
  BracketLeft: 219, Backslash: 220, BracketRight: 221, Quote: 222, IntlBackslash: 226,
  NumpadMultiply: 106, NumpadAdd: 107, NumpadSubtract: 109, NumpadDecimal: 110, NumpadDivide: 111,
};

/** The virtual-key code a real keyboard reports for `code`, or 0 when it names no character key. */
export function virtualKeyCode(code: string): number {
  const letter = /^Key([A-Z])$/.exec(code)?.[1];
  if (letter !== undefined) return 65 + "ABCDEFGHIJKLMNOPQRSTUVWXYZ".indexOf(letter);
  const digit = /^Digit(\d)$/.exec(code)?.[1];
  if (digit !== undefined) return 48 + Number(digit);
  const numpad = /^Numpad(\d)$/.exec(code)?.[1];
  if (numpad !== undefined) return 96 + Number(numpad);
  return PUNCTUATION_KEY_CODES[code] ?? 0;
}

function asText(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  return Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data).toString("utf8");
}

/**
 * A client message with a typed character's key code corrected; any other
 * message, and anything that is not JSON, passes through unchanged. A key code
 * of 0 tells Chrome the key is no editing key, so the text still goes in.
 */
export function correctKeyCode(data: RawData, isBinary: boolean): RawData | string {
  if (isBinary) return data;
  let message: unknown;
  try {
    message = JSON.parse(asText(data));
  } catch (_e) {
    return data; // not JSON: the dashboard's to judge, not this filter's
  }
  if (!isRecord(message) || message.type !== "input_keyboard" || typeof message.key !== "string" || [...message.key].length !== 1) return data;
  const windowsVirtualKeyCode = typeof message.code === "string" ? virtualKeyCode(message.code) : 0;
  return JSON.stringify({ ...message, windowsVirtualKeyCode });
}
