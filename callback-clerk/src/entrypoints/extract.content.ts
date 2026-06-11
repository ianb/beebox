// Content script: responds to "extractPage" messages from the service
// worker with a Readability + Turndown extraction of the current page.
// Does nothing on load.
import { extractPage } from "../platform/extract-page";

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
    });
  },
});
