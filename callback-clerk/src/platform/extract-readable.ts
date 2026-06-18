/**
 * Readable-page extraction for the commentary flow: Defuddle isolates the main
 * content, DOMPurify sanitizes it, Turndown converts to markdown. Pure DOM —
 * no chrome.* APIs — so the content-script entrypoint stays a thin shim.
 *
 * extract→sanitize→convert keeps the three concerns separate: Defuddle decides
 * what's content, DOMPurify makes it safe before it ever reaches the box, and
 * Turndown renders the markdown we store.
 *
 * Links/images are absolutized against the page URL before conversion — the
 * stored markdown leaves the original site, so a relative or site-relative
 * `href` (`/docs`, `foo`) would otherwise resolve against the box and break.
 */

import Defuddle from "defuddle";
import purify from "dompurify";
import TurndownService from "turndown";
import type { ReadablePage } from "../domain/commentary.js";

/**
 * Rewrite every `href`/`src` in `html` to an absolute URL resolved against
 * `baseUrl`. Operates on already-sanitized HTML in a detached element.
 */
function absolutizeUrls(html: string, baseUrl: string): string {
  const container = document.createElement("div");
  container.innerHTML = html;
  const rewrite = (el: Element, attr: string): void => {
    const value = el.getAttribute(attr);
    if (value === null || value === "") return;
    try {
      el.setAttribute(attr, new URL(value, baseUrl).href);
    } catch (_e) {
      // Leave unparseable values (e.g. "javascript:", malformed) as-is.
    }
  };
  for (const a of container.querySelectorAll("a[href]")) rewrite(a, "href");
  for (const img of container.querySelectorAll("img[src]")) rewrite(img, "src");
  return container.innerHTML;
}

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
    markdown = turndown.turndown(absolutizeUrls(cleanHtml, url));
  }

  const title = result.title !== "" ? result.title : document.title;
  const siteName = result.site !== "" ? result.site : result.domain !== "" ? result.domain : null;
  const byline = result.author !== "" ? result.author : null;
  const excerpt = result.description !== "" ? result.description : null;

  return { title, siteName, byline, excerpt, markdown, url };
}
