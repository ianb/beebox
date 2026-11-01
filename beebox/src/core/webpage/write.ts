/**
 * Writing a webpage card, for Clerk and for `bbx webpage`.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createWebpageTemplate, type WebpageCaptureFields } from "../../schemas/webpage.js";
import { attachmentPath } from "../../shared/attach-path.js";
import { neutralizeIngestedMarkdown } from "../../shared/markdoc-config/ingest.js";

export async function writeCard(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf-8");
}

/** The same, but an existing file is an EEXIST error and nothing replaces it. */
async function writeNewCard(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, { encoding: "utf-8", flag: "wx" });
}

/**
 * Write a `.webpage.card` (readable body + capture provenance) and, when a
 * frozen snapshot is provided, `<card>.attach/page.frozen` beside it. Returns
 * the box-relative paths written, in commit order. With `exclusive`, an
 * existing file is an EEXIST error and nothing replaces it.
 */
export async function writeWebpageCard(opts: {
  boxRoot: string;
  cardRel: string;
  title: string;
  url: string;
  capturedAt: string;
  markdown: string;
  siteName?: string | undefined;
  byline?: string | undefined;
  excerpt?: string | undefined;
  frozenHtml?: string | undefined;
  captureId?: string | undefined;
  capture?: WebpageCaptureFields | undefined;
  exclusive?: boolean | undefined;
}): Promise<string[]> {
  const frozen = opts.frozenHtml;
  const hasFrozen = typeof frozen === "string" && frozen !== "";
  const write = opts.exclusive === true ? writeNewCard : writeCard;
  const card = createWebpageTemplate({
    title: opts.title,
    url: opts.url,
    capturedAt: opts.capturedAt,
    // Clipped page text is third-party: escape its raw HTML and Markdoc tags.
    content: neutralizeIngestedMarkdown(opts.markdown),
    siteName: opts.siteName,
    byline: opts.byline,
    excerpt: opts.excerpt,
    frozenRef: hasFrozen ? "attach/page.frozen" : undefined,
    captureId: opts.captureId,
    capture: opts.capture,
  });
  // The snapshot first: a crash between the writes must not leave a card,
  // found later by its capture id, that names a snapshot never written.
  const created = [opts.cardRel];
  if (hasFrozen) {
    const frozenRel = attachmentPath(opts.cardRel, "page.frozen");
    await write(path.join(opts.boxRoot, frozenRel), frozen);
    created.push(frozenRel);
  }
  await write(path.join(opts.boxRoot, opts.cardRel), card);
  return created;
}
