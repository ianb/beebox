// On-demand capture script for the "Send to box" and "Comment on this page" flows. It is NOT
// registered in the manifest (registration: "runtime") — the background
// injects it into the active tab via chrome.scripting only when the user
// invokes the action. This keeps Defuddle + single-file-core (the bulk of the
// extension) out of every page load; they ship in THIS file, injected once on
// demand. On injection it captures and messages the result back to the
// background (executeScript with a file can't return the value directly).
import { extractReadable } from "../platform/extract-readable.js";
import { freezePage } from "../platform/freeze-page.js";
import {
  CAPTURE_RESULT,
  takeCaptureRequestId,
  type CaptureResultMessage,
} from "../domain/capture-messages.js";

export default defineContentScript({
  // Built but NOT registered in the manifest; the background injects it via
  // chrome.scripting.executeScript on the "Comment" click (activeTab covers
  // the active tab — no host permission needed). matches is empty on purpose:
  // any value here is added to host_permissions, and we must NOT request broad
  // host access at install (host access is per-origin, granted on box-enable).
  registration: "runtime",
  matches: [],
  async main() {
    // First, before any await: take the id the background set for THIS
    // injection, so the result can be matched to its request (see
    // capture-messages.ts).
    const requestId = takeCaptureRequestId(globalThis);
    let result: CaptureResultMessage;
    try {
      // Extract first (cheap, clones the DOM); then freeze so freezing's side
      // effects can't perturb the extraction. Both timed — see the page console.
      const t0 = performance.now();
      const page = extractReadable();
      const t1 = performance.now();
      const frozenHtml = await freezePage();
      const t2 = performance.now();
      console.info(
        `[clerk] capture: extract ${Math.round(t1 - t0)}ms, freeze ${Math.round(t2 - t1)}ms` +
          `${frozenHtml === null ? " (no snapshot)" : ""}`,
      );
      result = { type: CAPTURE_RESULT, requestId, capture: { page, frozenHtml } };
    } catch (err) {
      result = { type: CAPTURE_RESULT, requestId, error: err instanceof Error ? err.message : String(err) };
    }
    chrome.runtime.sendMessage(result).catch((err: unknown) => {
      // No UI surface from a content script -- console is the only signal,
      // but a dropped capture result (background port closed mid-capture)
      // shouldn't vanish silently.
      console.error("[clerk] failed to send capture result:", err);
    });
  },
});
