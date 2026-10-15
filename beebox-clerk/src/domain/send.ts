/**
 * Send to box: the `clerk.send` payload, the outcomes the background reports
 * to the popup, and the words both show. One send is one press of the button,
 * identified by an id made at press time; Try again resends the same payload
 * under the same id, and the box answers a repeat with the stored result.
 */

import type { SendPayload, SendResult } from "../contract/clerk-contract.generated.js";
import { boxPageUrl } from "./box-url.js";
import { capturedPageFields, type CommentaryCapture } from "./commentary.js";

/** Where a send stands, without the card path (also what `quickChat.choose` answers). */
export type SendView = Omit<SendResult, "card">;

/** The most choices the popup shows; the box screen offers the rest. */
export const MAX_POPUP_CHOICES = 4;

export function buildSendPayload(params: { capture: CommentaryCapture; id: string; note: string }): SendPayload {
  return { id: params.id, note: params.note.trim(), ...capturedPageFields(params.capture) };
}

/**
 * What became of one send, choose, or Try again.
 *
 * - `answered`: the box answered with where the send stands.
 * - `unconfirmed`: no answer (network, or a 5xx after retries); the box may
 *   have saved it. Try again resends the same send.
 * - `unsupported`: the box has no `clerk.send` (HTTP 404); it needs an update.
 * - `auth`: the session cookie is missing or expired.
 * - `rejected`: the box refused it, or the page could not be captured.
 * - `forgotten`: Try again found no kept payload (the service worker
 *   restarted); a new send is the only way forward.
 */
export type SendOutcome =
  | { status: "answered"; view: SendView }
  | { status: "unconfirmed"; message: string }
  | { status: "unsupported" }
  | { status: "auth"; message: string }
  | { status: "rejected"; message: string }
  | { status: "forgotten" };

export const UNSUPPORTED_TEXT = "This box doesn't support Send yet. Update the box.";
export const UNCONFIRMED_TEXT = "Couldn't confirm the send.";
export const FORGOTTEN_TEXT = "That send is no longer kept. Send again to capture the page again.";
export const AUTH_TEXT = "Session expired — open the box to sign in.";
export const CHOOSE_LATER_TEXT = "Or choose later on the box screen.";

const REASON_TEXT: Record<NonNullable<SendView["reason"]>, string> = {
  uncertain: "Not sure where this goes",
  "routing-unavailable": "Could not sort this",
  "destination-gone": "That chat is gone",
};

/** The line the popup shows for a send the box answered. */
export function sendViewText(view: SendView): string {
  const label = view.destination?.label;
  if (view.state === "sent") {
    if (label === undefined) return "Sent";
    return view.queued === true ? `Queued in ${label}` : `Sent to ${label}`;
  }
  if (view.state === "needs-choice") {
    return view.reason === undefined ? REASON_TEXT.uncertain : REASON_TEXT[view.reason];
  }
  if (view.state === "sending") {
    if (view.lastError !== undefined) return `Saved, not delivered yet: ${view.lastError}`;
    return label === undefined ? "Saved, sending" : `Saved, sending to ${label}`;
  }
  return "Discarded on the box screen";
}

/** The toast shown on the page, since the popup often closes first. */
export function sendToastText(outcome: SendOutcome): { text: string; isError: boolean } {
  if (outcome.status === "answered") {
    const { view } = outcome;
    if (view.state === "needs-choice") return { text: "Saved. Choose where it goes on the box screen.", isError: false };
    if (view.state === "sending" && view.lastError !== undefined) return { text: "Saved, not delivered yet.", isError: true };
    return { text: sendViewText(view), isError: false };
  }
  if (outcome.status === "unconfirmed") return { text: UNCONFIRMED_TEXT, isError: true };
  if (outcome.status === "unsupported") return { text: UNSUPPORTED_TEXT, isError: true };
  if (outcome.status === "auth") return { text: AUTH_TEXT, isError: true };
  if (outcome.status === "forgotten") return { text: FORGOTTEN_TEXT, isError: true };
  return { text: `Send failed: ${outcome.message}`, isError: true };
}

/** True once the box has the send: the popup then clears the note. */
export function sendConfirmed(outcome: SendOutcome): boolean {
  return outcome.status === "answered";
}

/** The chat a sent page went to, or null when the box named no session. */
export function sendChatUrl(boxUrl: string, view: SendView): string | null {
  const sessionId = view.destination?.sessionId;
  if (sessionId === undefined || sessionId === "") return null;
  return boxPageUrl(boxUrl, `chat?session=${encodeURIComponent(sessionId)}`);
}
