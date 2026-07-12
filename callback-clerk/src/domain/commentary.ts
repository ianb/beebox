/**
 * Payload shaping for the `clerk.commentary` mutation and helpers for the
 * "comment on this page" flow. The server contract (the zod leaf
 * callback-box/src/webapp/trpc/routers/clerk-contract.ts, mirrored here by the
 * generated `CommentaryPayload`) requires non-empty title and readableMarkdown;
 * optional fields must be omitted, not null. When extraction yields no readable
 * content we fall back to a markdown link — never silently drop the capture.
 */

import type { CommentaryPayload } from "../contract/clerk-contract.generated.js";

/** The readable rendering of a page (Defuddle markdown + metadata). */
export interface ReadablePage {
  title: string;
  siteName: string | null;
  byline: string | null;
  excerpt: string | null;
  markdown: string;
  url: string;
}

/**
 * What the content script returns for a "captureCommentary" request: the
 * readable rendering plus the frozen page (null when freezing failed).
 */
export interface CommentaryCapture {
  page: ReadablePage;
  frozenHtml: string | null;
}

export function buildCommentaryPayload(params: {
  page: ReadablePage;
  frozenHtml: string | null;
  destinationDir: string | null;
  timestamp: string;
}): CommentaryPayload {
  const { page, frozenHtml, destinationDir, timestamp } = params;
  const title = page.title !== "" ? page.title : page.url;
  const readableMarkdown =
    page.markdown !== "" ? page.markdown : linkMarkdown(title, page.url);
  const payload: CommentaryPayload = { url: page.url, title, readableMarkdown, timestamp };
  if (page.siteName !== null && page.siteName !== "") payload.siteName = page.siteName;
  if (page.byline !== null && page.byline !== "") payload.byline = page.byline;
  if (page.excerpt !== null && page.excerpt !== "") payload.excerpt = page.excerpt;
  if (frozenHtml !== null && frozenHtml !== "") payload.frozenHtml = frozenHtml;
  if (destinationDir !== null && destinationDir !== "") payload.destinationDir = destinationDir;
  return payload;
}

/**
 * Resolve the server's relative `open` path (e.g.
 * `chat?session=new&companion=…`) against the box's root URL into an absolute
 * URL the extension can open in a new tab. `boxUrl` already carries the box's
 * path prefix (origin + base + slug), so the open path is appended as a
 * sibling segment — mirroring how clerk-api builds `${boxUrl}/api/trpc/clerk.…`.
 */
export function commentaryOpenUrl(boxUrl: string, openPath: string): string {
  return `${boxUrl.replace(/\/+$/, "")}/${openPath.replace(/^\/+/, "")}`;
}

function linkMarkdown(title: string, url: string): string {
  return `[${title}](${url})`;
}
