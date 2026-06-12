/**
 * Payload shaping for POST /api/clerk/save-page. The server contract
 * (callback-box src/webapp/routes/clerk.ts savePageSchema) requires
 * non-empty title and markdown; optional fields must be omitted, not
 * null. When extraction fails we fall back to a markdown link — never
 * silently drop a save.
 */

export type SaveIntent = "save" | "do";

/** What the content script's Readability+Turndown extraction produces. */
export interface PageExtract {
  title: string;
  siteName: string | null;
  byline: string | null;
  excerpt: string | null;
  markdown: string;
  selectedText: string | null;
  url: string;
}

export interface SavePagePayload {
  intent: SaveIntent;
  url: string;
  title: string;
  siteName?: string;
  byline?: string;
  excerpt?: string;
  markdown: string;
  selectedText?: string;
  timestamp: string;
}

export function buildSavePagePayload(params: {
  intent: SaveIntent;
  extract: PageExtract;
  timestamp: string;
}): SavePagePayload {
  const { intent, extract, timestamp } = params;
  const title = extract.title !== "" ? extract.title : extract.url;
  const markdown =
    extract.markdown !== "" ? extract.markdown : linkMarkdown(title, extract.url);
  const payload: SavePagePayload = { intent, url: extract.url, title, markdown, timestamp };
  if (extract.siteName !== null && extract.siteName !== "") payload.siteName = extract.siteName;
  if (extract.byline !== null && extract.byline !== "") payload.byline = extract.byline;
  if (extract.excerpt !== null && extract.excerpt !== "") payload.excerpt = extract.excerpt;
  if (extract.selectedText !== null && extract.selectedText !== "") {
    payload.selectedText = extract.selectedText;
  }
  return payload;
}

/** Fallback for unscriptable pages, failed extraction, and link saves. */
export function buildLinkSavePayload(params: {
  intent: SaveIntent;
  url: string;
  title: string;
  timestamp: string;
}): SavePagePayload {
  const title = params.title !== "" ? params.title : params.url;
  return {
    intent: params.intent,
    url: params.url,
    title,
    markdown: linkMarkdown(title, params.url),
    timestamp: params.timestamp,
  };
}

function linkMarkdown(title: string, url: string): string {
  return `[${title}](${url})`;
}
