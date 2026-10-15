import type { ActionResponse, ClerkMessage } from "../../domain/messages.js";

/**
 * Sends one action to the background. The Promise has no reject path:
 * chrome.runtime.lastError becomes a resolved `{ ok: false }` response.
 */
export function sendAction(message: ClerkMessage): Promise<ActionResponse> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response: ActionResponse | undefined) => {
      if (chrome.runtime.lastError || response === undefined) {
        const detail = chrome.runtime.lastError?.message ?? "no response from background";
        resolve({ ok: false, status: 0, message: detail });
        return;
      }
      resolve(response);
    });
  });
}
