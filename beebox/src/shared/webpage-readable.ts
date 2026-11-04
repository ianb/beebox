/**
 * The one readable-page pipeline, used by the Clerk extension and by `bbx
 * webpage`: Defuddle isolates the main content, DOMPurify sanitizes it, Turndown
 * converts to markdown. Pure DOM: the caller supplies the window, whether it is
 * a browser tab's or jsdom's.
 *
 * extract→sanitize→convert keeps the three concerns separate: Defuddle decides
 * what's content, DOMPurify makes it safe before it ever reaches the box, and
 * Turndown renders the markdown we store.
 *
 * Links/images are absolutized against the page URL before conversion — the
 * stored markdown leaves the original site, so a relative or site-relative
 * `href` (`/docs`, `foo`) would otherwise resolve against the box and break.
 */

import { DefuddleClass } from "defuddle/node";
import purify, { type WindowLike } from "dompurify";
import TurndownService from "turndown";
import { tables } from "@joplin/turndown-plugin-gfm";

export interface ReadablePageFields {
  title: string;
  siteName: string | null;
  byline: string | null;
  excerpt: string | null;
  markdown: string;
}

/**
 * Rewrite every `href`/`src` in `html` to an absolute URL resolved against
 * `baseUrl`. Operates on already-sanitized HTML in a detached element.
 */
function absolutizeUrls(html: string, { document, baseUrl }: { document: Document; baseUrl: string }): string {
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

/** The readable fields of `document`, the page at `url`. Works on a clone, so the page is left as it was. */
export function extractReadablePage({ window, document, url }: { window: WindowLike; document: Document; url: string }): ReadablePageFields {
  // eslint-disable-next-line no-restricted-syntax -- DOM boundary: `Node.cloneNode` is typed to return `Node`, but cloning a Document returns a Document
  const docClone = document.cloneNode(true) as Document;
  const result = new DefuddleClass(docClone, { url }).parse();

  const cleanHtml = purify(window).sanitize(result.content);
  let markdown = "";
  if (cleanHtml !== "") {
    const turndown = new TurndownService({
      headingStyle: "atx",
      codeBlockStyle: "fenced",
    });
    // Income tables, benefit tables: a page's table is often why it was kept.
    turndown.use(tables);
    markdown = turndown.turndown(absolutizeUrls(cleanHtml, { document, baseUrl: url }));
  }

  return {
    title: result.title !== "" ? result.title : document.title,
    siteName: result.site !== "" ? result.site : result.domain !== "" ? result.domain : null,
    byline: result.author !== "" ? result.author : null,
    excerpt: result.description !== "" ? result.description : null,
    markdown,
  };
}
