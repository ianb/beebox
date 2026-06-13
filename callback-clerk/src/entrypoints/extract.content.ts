// Content script: responds to the service worker's capture requests.
//  - "extractPage": Readability + Turndown extraction (secondary save-page).
//  - "captureCommentary": Defuddle readable markdown + a SingleFile freeze of
//    the page (the primary "comment on this page" flow).
// Does nothing on load.
import { extractPage } from "../platform/extract-page.js";
import { extractReadable } from "../platform/extract-readable.js";
import { freezePage } from "../platform/freeze-page.js";
import type { CommentaryCapture } from "../domain/commentary.js";

async function captureCommentary(): Promise<CommentaryCapture> {
  // Extract first (cheap, clones the DOM); then freeze (heavy, may load
  // deferred images) so freezing's side effects can't perturb the extraction.
  const page = extractReadable();
  const frozenHtml = await freezePage();
  return { page, frozenHtml };
}

export default defineContentScript({
  matches: ["http://*/*", "https://*/*"],
  runAt: "document_idle",
  main() {
    // eslint-disable-next-line max-params -- Chrome API callback signature
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message.type === "extractPage") {
        try {
          sendResponse(extractPage());
        } catch (err) {
          const errMessage = err instanceof Error ? err.message : String(err);
          sendResponse({ error: errMessage });
        }
        return true;
      }
      if (message.type === "captureCommentary") {
        captureCommentary()
          .then(sendResponse)
          .catch((err: unknown) => {
            sendResponse({ error: err instanceof Error ? err.message : String(err) });
          });
        return true;
      }
    });
  },
});
