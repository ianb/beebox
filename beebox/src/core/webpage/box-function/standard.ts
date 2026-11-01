/**
 * `standard`: the built-in way to turn a response into a card's content
 * (docs/plans/webpage-capture-tools.md). It refuses what looks blocked or
 * failed, then runs the one readable-page pipeline over jsdom.
 *
 * jsdom runs no page script and loads no resource with these options: the page
 * is third-party, and only its text is wanted.
 */

import { JSDOM } from "jsdom";
import { extractReadablePage } from "../../../shared/webpage-readable.js";
import { detectBlock } from "./detect-block.js";
import type { CapturedResponse, WebpageResult } from "../response.js";

/** Under this much text, the page probably needs scripts to show its content. */
const NEAR_EMPTY_CHARS = 200;

export function standard(response: CapturedResponse): WebpageResult {
  const block = detectBlock(response);
  if (block !== null) return { refuse: block };
  if (response.status !== null && (response.status < 200 || response.status >= 300)) {
    return { refuse: `the site answered HTTP ${String(response.status)}` };
  }
  const dom = new JSDOM(response.html, { url: response.url });
  try {
    const { window } = dom;
    const page = extractReadablePage({ window, document: window.document, url: response.url });
    const title = page.title === "" ? response.url : page.title;
    const isNearEmpty = page.markdown.trim().length < NEAR_EMPTY_CHARS;
    return {
      ...page,
      title,
      ...(isNearEmpty ? { note: "Almost no text was found. The page may need scripts to show its content." } : {}),
    };
  } finally {
    dom.window.close();
  }
}
