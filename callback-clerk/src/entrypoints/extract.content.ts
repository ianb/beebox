// Always-on content script for the secondary save-page action: responds to
// "extractPage" with a Readability + Turndown extraction. Kept deliberately
// light — the heavy commentary capture (Defuddle + single-file-core) is NOT
// here; the background injects it on demand (see commentary-capture.content.ts).
// Does nothing on load.
import { extractPage } from "../platform/extract-page.js";

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
          sendResponse({ error: err instanceof Error ? err.message : String(err) });
        }
        return true;
      }
    });
  },
});
