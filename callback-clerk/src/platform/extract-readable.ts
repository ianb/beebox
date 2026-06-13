/**
 * Readable-page extraction for the commentary flow: Defuddle isolates the main
 * content, DOMPurify sanitizes it, Turndown converts to markdown. Pure DOM —
 * no chrome.* APIs — so the content-script entrypoint stays a thin shim
 * (mirrors `extract-page.ts`, which the secondary save-page action still uses).
 *
 * extract→sanitize→convert keeps the three concerns separate: Defuddle decides
 * what's content, DOMPurify makes it safe before it ever reaches the box, and
 * Turndown renders the markdown we store.
 */

import Defuddle from "defuddle";
import purify from "dompurify";
import TurndownService from "turndown";
import type { ReadablePage } from "../domain/commentary.js";

export function extractReadable(): ReadablePage {
  const url = document.location.href;

  // Clone so Defuddle's script-stripping doesn't mutate the live DOM.
  const docClone = document.cloneNode(true) as Document;
  const result = new Defuddle(docClone, { url }).parse();

  const cleanHtml = purify.sanitize(result.content);
  let markdown = "";
  if (cleanHtml !== "") {
    const turndown = new TurndownService({
      headingStyle: "atx",
      codeBlockStyle: "fenced",
    });
    markdown = turndown.turndown(cleanHtml);
  }

  const title = result.title !== "" ? result.title : document.title;
  const siteName = result.site !== "" ? result.site : result.domain !== "" ? result.domain : null;
  const byline = result.author !== "" ? result.author : null;
  const excerpt = result.description !== "" ? result.description : null;

  return { title, siteName, byline, excerpt, markdown, url };
}
