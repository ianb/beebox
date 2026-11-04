/**
 * Writing a webpage card, for Clerk and for `bbx webpage`.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { renderFrontmatterBlock } from "../../cards/frontmatter.js";
import { createWebpageTemplate, type WebpageCaptureFields } from "../../schemas/webpage.js";
import { attachDirFor, attachmentPath } from "../../shared/attach-path.js";
import { errnoCode } from "../../shared/error-guards.js";
import { isRecord } from "../../shared/is-record.js";
import { anchorsIn } from "../../shared/markdoc-config/anchors.js";
import { neutralizeIngestedMarkdown } from "../../shared/markdoc-config/ingest.js";
import { parseMarkdown } from "../../shared/markdoc-config/parse/core.js";

/** An anchor a box function asked for cannot be placed; nothing is saved. */
export class AnchorError extends Error {
  override name = "AnchorError";
  constructor(what: { readonly detail: string }) {
    super(what.detail);
  }
}

export interface PageAnchor {
  id: string;
  /** 0-based line of the escaped text. */
  line: number;
}

const ANCHOR_ID = /^[\da-z][\da-z-]*$/;

/**
 * Put ` {% #id %}` at the end of each anchored line of an already-escaped
 * body. This is the one place page-derived markdown gains a real Markdoc
 * annotation, and only an id, written by box code. Each id must land on a
 * heading or paragraph, and must not equal a heading id the body already has,
 * or a citation could reach the wrong element. Throws `AnchorError`.
 */
export function applyAnchors(body: string, anchors: readonly PageAnchor[] | undefined): string {
  if (anchors === undefined || anchors.length === 0) return body;
  const lines = body.split("\n");
  const headingIds = new Set(anchorsIn(body).filter((a) => a.kind === "heading").map((a) => a.id));
  const used = new Set<string>();
  for (const { id, line } of anchors) {
    if (!ANCHOR_ID.test(id)) throw new AnchorError({ detail: `anchor "${id}": an id uses a-z, 0-9 and -, and starts with a letter or digit` });
    if (used.has(id)) throw new AnchorError({ detail: `anchor "${id}": given twice` });
    used.add(id);
    const text = lines[line];
    if (text === undefined || text.trim() === "") throw new AnchorError({ detail: `anchor "${id}": line ${String(line)} is ${text === undefined ? "past the end of" : "blank in"} the markdown (lines count from 0)` });
    if (headingIds.has(id)) throw new AnchorError({ detail: `anchor "${id}": a heading in the page already has that id; choose another` });
    lines[line] = `${text.trimEnd()} {% #${id} %}`;
  }
  const result = lines.join("\n");
  const landed = new Set<string>();
  for (const node of parseMarkdown(result).walk()) {
    const id: unknown = node.attributes["id"];
    if ((node.type === "heading" || node.type === "paragraph") && typeof id === "string") landed.add(id);
  }
  for (const { id, line } of anchors) {
    if (!landed.has(id)) throw new AnchorError({ detail: `anchor "${id}": line ${String(line)} is not a heading or the end of a paragraph (a list item or table cell cannot carry an id)` });
  }
  return result;
}

export async function writeCard(filePath: string, content: string | Uint8Array): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
}

/** The same, but an existing file is an EEXIST error and nothing replaces it. */
async function writeNewCard(filePath: string, content: string | Uint8Array): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, { flag: "wx" });
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
  frozenHtml?: string | Uint8Array | undefined;
  captureId?: string | undefined;
  capture?: WebpageCaptureFields | undefined;
  anchors?: readonly PageAnchor[] | undefined;
  exclusive?: boolean | undefined;
}): Promise<string[]> {
  const frozen = opts.frozenHtml;
  const hasFrozen = frozen !== undefined && frozen.length > 0;
  const write = opts.exclusive === true ? writeNewCard : writeCard;
  const card = createWebpageTemplate({
    title: opts.title,
    url: opts.url,
    capturedAt: opts.capturedAt,
    // Clipped page text is third-party: escape its raw HTML and Markdoc tags.
    content: applyAnchors(neutralizeIngestedMarkdown(opts.markdown), opts.anchors),
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
  const attachDir = path.join(opts.boxRoot, attachDirFor(opts.cardRel));
  if (hasFrozen) {
    const frozenRel = attachmentPath(opts.cardRel, "page.frozen");
    // An exclusive save also claims the folder, which another type of card may own.
    if (opts.exclusive === true) {
      await fs.mkdir(path.dirname(attachDir), { recursive: true });
      await fs.mkdir(attachDir);
    }
    await write(path.join(opts.boxRoot, frozenRel), frozen);
    created.push(frozenRel);
  }
  try {
    await write(path.join(opts.boxRoot, opts.cardRel), card);
  } catch (e) {
    if (opts.exclusive === true && hasFrozen) await fs.rm(attachDir, { recursive: true, force: true });
    throw e;
  }
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
  frozenHtml?: Uint8Array | undefined;
  capture: WebpageCaptureFields;
  anchors?: readonly PageAnchor[] | undefined;
}): Promise<string[]> {
  const { boxRoot, cardRel, current, frozenHtml } = opts;
  const body = applyAnchors(neutralizeIngestedMarkdown(opts.markdown), opts.anchors);
  const frozenRel = attachmentPath(cardRel, "page.frozen");
  const frozenPath = path.join(boxRoot, frozenRel);
  const saved = frozenHtml === undefined ? null : await readIfPresent(frozenPath);
  const htmlChanged = frozenHtml !== undefined && (saved === null || !saved.equals(frozenHtml));
  if (body.trim() === opts.currentBody.trim() && !htmlChanged && current["title"] === opts.title) return [];
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
    // A hand-added label or note on the source stays.
    sources: [{ ...firstSource(current["sources"]), href: opts.url, retrieved: opts.capturedAt }],
    ...(opts.siteName === undefined ? {} : { siteName: opts.siteName }),
    ...(opts.byline === undefined ? {} : { byline: opts.byline }),
    ...(opts.excerpt === undefined ? {} : { excerpt: opts.excerpt }),
    ...(frozenHtml === undefined ? {} : { frozen: { ref: "attach/page.frozen" } }),
    capture: opts.capture,
  };
  await writeCard(path.join(boxRoot, cardRel), renderFrontmatterBlock(fields, body));
  return [cardRel, ...paths];
}

function firstSource(sources: unknown): Record<string, unknown> {
  const first: unknown = Array.isArray(sources) ? sources[0] : undefined;
  return isRecord(first) ? first : {};
}

async function readIfPresent(file: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(file);
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return null;
    throw e;
  }
}
