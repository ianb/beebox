// On-demand capture script for the "comment on this page" flow. It is NOT
// registered in the manifest (registration: "runtime") — the background
// injects it into the active tab via chrome.scripting only when the user
// invokes the action. This keeps Defuddle + single-file-core (the bulk of the
// extension) out of every page load; they ship in THIS file, injected once on
// demand. On injection it captures and messages the result back to the
// background (executeScript with a file can't return the value directly).
import { extractReadable } from "../platform/extract-readable.js";
import { freezePage } from "../platform/freeze-page.js";
import { CAPTURE_RESULT, type CaptureResultMessage } from "../domain/capture-messages.js";

export default defineContentScript({
  // Built but NOT registered in the manifest; the background injects it via
  // chrome.scripting.executeScript on the "Comment" click (activeTab covers
  // the active tab — no host permission needed). matches is empty on purpose:
  // any value here is added to host_permissions, and we must NOT request broad
  // host access at install (host access is per-origin, granted on box-enable).
  registration: "runtime",
  matches: [],
  async main() {
    let result: CaptureResultMessage;
    try {
      // Extract first (cheap, clones the DOM); then freeze (heavy, may load
      // deferred images) so freezing's side effects can't perturb extraction.
      const page = extractReadable();
      const frozenHtml = await freezePage();
      result = { type: CAPTURE_RESULT, capture: { page, frozenHtml } };
    } catch (err) {
      result = { type: CAPTURE_RESULT, error: err instanceof Error ? err.message : String(err) };
    }
    chrome.runtime.sendMessage(result);
  },
});
