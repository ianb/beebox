/**
 * Content script for extracting page content via Readability + Turndown.
 *
 * Declared in manifest.json to run on all pages (at document_idle).
 * Does nothing on load — only responds to "extractPage" messages from
 * the background worker.
 */

import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";

export interface ExtractResult {
  title: string;
  siteName: string | null;
  byline: string | null;
  excerpt: string | null;
  markdown: string;
  selectedText: string | null;
  url: string;
}

function extractPage(): ExtractResult {
  const url = document.location.href;
  const selectedText = window.getSelection()?.toString().trim() || null;

  // Clone the document so Readability doesn't mutate the live DOM
  const docClone = document.cloneNode(true) as Document;
  const reader = new Readability(docClone);
  const article = reader.parse();

  let markdown = "";
  let title = document.title;
  let siteName: string | null = null;
  let byline: string | null = null;
  let excerpt: string | null = null;

  if (article) {
    title = article.title || title;
    siteName = article.siteName || null;
    byline = article.byline || null;
    excerpt = article.excerpt || null;

    const turndown = new TurndownService({
      headingStyle: "atx",
      codeBlockStyle: "fenced",
    });
    if (article.content) {
      markdown = turndown.turndown(article.content);
    }
  }

  // Fall back to meta description if no excerpt
  if (!excerpt) {
    const metaDesc =
      document.querySelector<HTMLMetaElement>('meta[name="description"]')?.content ||
      document.querySelector<HTMLMetaElement>('meta[property="og:description"]')?.content;
    if (metaDesc) excerpt = metaDesc;
  }

  // Fall back to og:site_name
  if (!siteName) {
    const ogSite = document.querySelector<HTMLMetaElement>('meta[property="og:site_name"]')?.content;
    if (ogSite) siteName = ogSite;
  }

  return { title, siteName, byline, excerpt, markdown, selectedText, url };
}

// Listen for extraction requests from the background worker
// eslint-disable-next-line max-params -- Chrome API callback signature
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "extractPage") {
    try {
      const result = extractPage();
      sendResponse(result);
    } catch (err) {
      sendResponse({ error: (err as Error).message });
    }
    return true;
  }
});
