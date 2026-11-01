/**
 * Writing a webpage card, for Clerk and for `bbx webpage`.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { renderFrontmatterBlock } from "../../cards/frontmatter.js";
import { createWebpageTemplate, type WebpageCaptureFields } from "../../schemas/webpage.js";
import { attachmentPath } from "../../shared/attach-path.js";
import { errnoCode } from "../../shared/error-guards.js";
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

/**
 * Replace what `bbx webpage save` owns in an existing card, in place. Other
 * frontmatter (a hand-added field, a capture id) and other attachments stay;
 * git holds the old copy. Returns the paths written, or an empty list when
 * nothing changed. `frozenHtml` undefined leaves the saved HTML as it is.
 */
export async function updateWebpageCard(opts: {
  boxRoot: string;
  cardRel: string;
  current: Record<string, unknown>;
  currentBody: string;
  title: string;
  url: string;
  capturedAt: string;
  markdown: string;
  siteName?: string | undefined;
  byline?: string | undefined;
  excerpt?: string | undefined;
  frozenHtml?: string | undefined;
  capture: WebpageCaptureFields;
}): Promise<string[]> {
  const { boxRoot, cardRel, current, frozenHtml } = opts;
  const body = neutralizeIngestedMarkdown(opts.markdown);
  const frozenRel = attachmentPath(cardRel, "page.frozen");
  const frozenPath = path.join(boxRoot, frozenRel);
  const htmlChanged = frozenHtml !== undefined && (await readIfPresent(frozenPath)) !== frozenHtml;
  if (body.trim() === opts.currentBody.trim() && !htmlChanged) return [];
  const paths: string[] = [];
  if (frozenHtml !== undefined && htmlChanged) {
    // Replaced, not written through: a locked annex file is a link to read-only content.
    await fs.rm(frozenPath, { force: true });
    await writeCard(frozenPath, frozenHtml);
    paths.push(frozenRel);
  }
  const { siteName: _site, byline: _byline, excerpt: _excerpt, ...kept } = current;
  const fields = {
    ...kept,
    title: opts.title,
    sources: [{ href: opts.url, retrieved: opts.capturedAt }],
    ...(opts.siteName === undefined ? {} : { siteName: opts.siteName }),
    ...(opts.byline === undefined ? {} : { byline: opts.byline }),
    ...(opts.excerpt === undefined ? {} : { excerpt: opts.excerpt }),
    ...(frozenHtml === undefined ? {} : { frozen: { ref: "attach/page.frozen" } }),
    capture: opts.capture,
  };
  await writeCard(path.join(boxRoot, cardRel), renderFrontmatterBlock(fields, body));
  return [cardRel, ...paths];
}

async function readIfPresent(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, "utf-8");
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return null;
    throw e;
  }
}
