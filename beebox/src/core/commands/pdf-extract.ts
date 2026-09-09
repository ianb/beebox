/**
 * The extraction half of pdf mode: run Docling over a source file and
 * turn what it produced into the assets a `pdf.card` references.
 *
 * Shared by `bbx scan-import`'s pdf flow (first extraction) and
 * `bbx pdf reanalyze` (re-extraction), because both write the same asset
 * set into the same attach scope and differ only in what they do with the
 * card afterwards.
 *
 * Failure is a return value, not an exception: the caller falls back to filing
 * the original bytes verbatim with `status: new` + `error:`, so a Docling
 * crash never blocks intake (`docs/plans/scanner-ingest.md`, Track 4).
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { gzip } from "node:zlib";
import { promisify } from "node:util";
import {
  checkExtractionBounds,
  type DoclingImage,
  type DoclingOcr,
  type DoclingService,
} from "../../services/docling.js";
import { extractPdfText } from "./pdf-probe.js";
import { err, ok, type Result } from "../../lib/result.js";

const gzipAsync = promisify(gzip);

/** Name of the gzipped canonical extraction inside the card's attach scope. */
const DOCLING_JSON_FILENAME = "docling.json.gz";

/**
 * Name of the raw text layer inside the card's attach scope (D8). The card's
 * body is Docling's rendering — faithful but lossy — so the producer's own
 * characters are kept verbatim beside it rather than only in the original's
 * bytes. Reference-free by convention, like the page renders: the schema
 * instructions name it, nothing in frontmatter points at it.
 */
const TEXT_LAYER_FILENAME = "text-layer.txt";

/**
 * AVIF encode settings for page renders and figures (D10). Quality 60 keeps
 * scanned text legible at a fraction of the PNG Docling emits; effort 4 is
 * libvips' balance point — higher costs seconds per page for single-digit
 * percentage gains on a scan.
 */
const AVIF_QUALITY = 60;
const AVIF_EFFORT = 4;

export interface PdfExtraction {
  /** Rendered markdown, with figure references rewritten into the attach scope. */
  body: string;
  /** Basenames written into the attach scope (excluding the original file). */
  assetNames: string[];
  /** Name of the gzipped DoclingDocument JSON within the attach scope. */
  doclingFilename: string;
  doclingVersion: string;
  pageCount: number;
}

export interface ExtractPdfOptions {
  docling: DoclingService;
  /** The file to extract — normally the original already copied into the attach scope. */
  sourcePath: string;
  /** The card's attach scope; assets are written here. */
  attachAbsDir: string;
  /** Scratch directory for Docling's raw output. Caller creates and removes it. */
  workDir: string;
  ocr: DoclingOcr;
  languages: string[] | null;
}

/** `page-001.avif`, `figure-012.avif`, … */
function assetName(prefix: string, index: number): string {
  return `${prefix}-${String(index + 1).padStart(3, "0")}.avif`;
}

/**
 * Re-encode Docling's PNGs to AVIF in the attach scope, returning both the new
 * names (in order) and the basename→ref mapping the markdown rewrite needs.
 */
async function encodeImages(
  images: DoclingImage[],
  options: { prefix: string; attachAbsDir: string }
): Promise<{ names: string[]; refs: Map<string, string> }> {
  const names: string[] = [];
  const refs = new Map<string, string>();
  // Dynamic — see `core/scan/validate.ts`: keeps the native `sharp` binding out
  // of the startup graph of every `bbx` invocation that touches no images.
  const { default: Sharp } = await import("sharp");
  for (const [index, image] of images.entries()) {
    const name = assetName(options.prefix, index);
    await Sharp(image.filePath)
      .avif({ quality: AVIF_QUALITY, effort: AVIF_EFFORT })
      .toFile(path.join(options.attachAbsDir, name));
    names.push(name);
    refs.set(image.referencedAs, `attach/${name}`);
  }
  return { names, refs };
}

/**
 * Point the markdown's image links at the AVIF copies.
 *
 * Matched by basename, not by the path Docling wrote: those paths are relative
 * to an output root that does not match where the files actually landed (see
 * `collectOutputs` in the service). Anything we don't recognize is left alone
 * rather than dropped — an unexpected link is still information.
 */
function rewriteImageRefs(markdown: string, refs: Map<string, string>): string {
  return markdown.replaceAll(/\]\(([^)\s]+)\)/gu, (match, target: string) => {
    const basename = target.split("/").pop();
    const replacement = basename === undefined ? undefined : refs.get(basename);
    return replacement === undefined ? match : `](${replacement})`;
  });
}

export async function extractPdf(options: ExtractPdfOptions): Promise<Result<PdfExtraction>> {
  const extraction = await options.docling.extract(options.sourcePath, {
    workDir: options.workDir,
    ocr: options.ocr,
    languages: options.languages,
  });
  if (!extraction.ok) return err(extraction.error);
  // Bound the output BEFORE anything reads it: the gzip and the AVIF re-encode
  // below are per-artifact work on whatever Docling decided to produce (D16).
  // Over the cap is an extraction failure, which the caller already handles by
  // filing the original bytes with `status: new` — intake never blocks.
  const bounded = await checkExtractionBounds(extraction.value);
  if (!bounded.ok) return err(bounded.error);
  const { markdown, jsonPath, pageImages, figures, pageCount, version } = extraction.value;

  const assetNames: string[] = [];

  const json = await fs.readFile(jsonPath);
  await fs.writeFile(path.join(options.attachAbsDir, DOCLING_JSON_FILENAME), await gzipAsync(json));
  assetNames.push(DOCLING_JSON_FILENAME);

  // The raw text layer, read straight off the source (D8). Only pdf mode
  // pays for this — the textless branch never reaches here, so a scan with no
  // text is not charged for a full-document extraction that would yield
  // nothing. Empty or unavailable → no file, because an empty asset is worse
  // than an absent one: it reads as "the document has no text" rather than
  // "nobody could look".
  const textLayer = await extractPdfText(options.sourcePath);
  if (textLayer !== null) {
    await fs.writeFile(path.join(options.attachAbsDir, TEXT_LAYER_FILENAME), textLayer, "utf-8");
    assetNames.push(TEXT_LAYER_FILENAME);
  }

  const pages = await encodeImages(pageImages, { prefix: "page", attachAbsDir: options.attachAbsDir });
  const figureAssets = await encodeImages(figures, { prefix: "figure", attachAbsDir: options.attachAbsDir });
  assetNames.push(...pages.names, ...figureAssets.names);

  return ok({
    body: rewriteImageRefs(markdown, figureAssets.refs),
    assetNames,
    doclingFilename: DOCLING_JSON_FILENAME,
    doclingVersion: version,
    pageCount,
  });
}

/**
 * Remove the assets a previous extraction left in the attach scope, so a
 * reanalyze that now produces fewer pages or figures does not leave orphans
 * from the old run sitting beside the new ones. The original file is never
 * touched — it is the one thing that must survive every re-extraction.
 */
export async function clearExtractionAssets(
  attachAbsDir: string,
  options: { keep: string }
): Promise<string[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(attachAbsDir);
  } catch (_e) {
    // No attach scope yet (a card written before extraction ever ran) — there
    // is nothing to clear, which is the same outcome as an empty directory.
    return [];
  }
  const stale = entries.filter(
    (name) =>
      name !== options.keep
      && (name === DOCLING_JSON_FILENAME
        || name === TEXT_LAYER_FILENAME
        || /^(?:page|figure)-\d{3}\.avif$/u.test(name))
  );
  for (const name of stale) await fs.rm(path.join(attachAbsDir, name), { force: true });
  return stale;
}
