/**
 * The background's Send to box actions: send, Try again, and choose. Each send
 * is kept in memory under its id with the box it went to, so Try again reposts
 * the SAME payload to the SAME box (never a recapture, even if the page or the
 * active box changed). The map does not survive a service-worker restart; Try
 * again then answers `forgotten` and the popup offers a new send.
 *
 * Browser APIs come in as `SendDeps`, so this runs under unit tests.
 */

import type { SendPayload, SendResult } from "../contract/clerk-contract.generated.js";
import type { CommentaryCapture } from "../domain/commentary.js";
import type { EnabledBox } from "../domain/config.js";
import type { SendActionResult } from "../domain/messages.js";
import { buildSendPayload, sendToastText, type SendOutcome, type SendView } from "../domain/send.js";
import { ClerkApiError, isAuthError, SendUnsupportedError } from "./clerk-api.js";

export interface SendDeps {
  requireActiveBox: () => Promise<EnabledBox>;
  /** Captures the tab, or null when it has no capturable content. */
  capture: (tabId: number) => Promise<CommentaryCapture | null>;
  post: (box: EnabledBox, payload: SendPayload) => Promise<SendResult>;
  choose: (box: EnabledBox, choice: { id: string; candidateId: string }) => Promise<SendView>;
  toast: (tabId: number, toast: { text: string; isError: boolean }) => void;
  newId: () => string;
}

interface KeptSend {
  box: EnabledBox;
  payload: SendPayload;
  tabId: number;
}

const CAPTURE_FAILED_TEXT =
  "Can't send this page — it has no extractable content (e.g. a browser or store page).";

/** Turns a failed post or choose into what the popup shows. */
export function classifySendError(error: unknown): SendOutcome {
  if (error instanceof SendUnsupportedError) return { status: "unsupported" };
  const message = error instanceof Error ? error.message : String(error);
  if (isAuthError(error)) return { status: "auth", message };
  if (error instanceof ClerkApiError && error.status !== 0 && error.status < 500) {
    return { status: "rejected", message };
  }
  return { status: "unconfirmed", message };
}

function viewOf(result: SendResult): SendView {
  const { card, ...view } = result;
  console.info(`[clerk] send saved as ${card}`);
  return view;
}

export function createSendActions(deps: SendDeps) {
  const kept = new Map<string, KeptSend>();

  async function post(id: string, send: KeptSend): Promise<SendActionResult> {
    let outcome: SendOutcome;
    try {
      outcome = { status: "answered", view: viewOf(await deps.post(send.box, send.payload)) };
    } catch (error) {
      outcome = classifySendError(error);
      console.error(`[beebox-clerk] send ${id} failed:`, error);
    }
    deps.toast(send.tabId, sendToastText(outcome));
    return { kind: "send", id, boxUrl: send.box.boxUrl, outcome };
  }

  return {
    async sendToBox(request: { tabId: number; note: string }): Promise<SendActionResult> {
      const box = await deps.requireActiveBox();
      const id = deps.newId();
      const capture = await deps.capture(request.tabId);
      if (capture === null) {
        deps.toast(request.tabId, { text: CAPTURE_FAILED_TEXT, isError: true });
        return { kind: "send", id, boxUrl: box.boxUrl, outcome: { status: "rejected", message: CAPTURE_FAILED_TEXT } };
      }
      const send: KeptSend = { box, payload: buildSendPayload({ capture, id, note: request.note }), tabId: request.tabId };
      kept.set(id, send);
      return post(id, send);
    },

    async retrySend(id: string): Promise<SendActionResult> {
      const send = kept.get(id);
      if (send === undefined) {
        const box = await deps.requireActiveBox();
        return { kind: "send", id, boxUrl: box.boxUrl, outcome: { status: "forgotten" } };
      }
      return post(id, send);
    },

    async chooseSend(choice: { id: string; candidateId: string }): Promise<SendActionResult> {
      const send = kept.get(choice.id);
      const box = send?.box ?? (await deps.requireActiveBox());
      let outcome: SendOutcome;
      try {
        outcome = { status: "answered", view: await deps.choose(box, choice) };
      } catch (error) {
        outcome = classifySendError(error);
        console.error(`[beebox-clerk] choose for send ${choice.id} failed:`, error);
      }
      if (send !== undefined) deps.toast(send.tabId, sendToastText(outcome));
      return { kind: "send", id: choice.id, boxUrl: box.boxUrl, outcome };
    },
  };
}
