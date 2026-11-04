/**
 * Readable-page extraction for the commentary flow: the shared pipeline over
 * this tab's document. No chrome.* APIs, so the content-script entrypoint stays
 * a thin shim.
 */

import { extractReadablePage } from "../../../beebox/src/shared/webpage-readable.js";
import type { ReadablePage } from "../domain/commentary.js";

export function extractReadable(): ReadablePage {
  const url = document.location.href;
  return { ...extractReadablePage({ window, document, url }), url };
}
