/**
 * Cheap PDF probes for scan-import's dispatch split, plus the page renderer
 * the textless branch feeds to the photo flow.
 *
 * Both shell out to poppler (`pdftotext`, `pdfinfo`, `pdftoppm`), which the
 * deploy already installs (`deploy/setup-server.sh`, `poppler-utils`) and
 * which is an order of magnitude cheaper than starting Docling just to ask a
 * yes/no question. Decisions D8 (detection method + threshold) and D9 (page
 * renderer for the textless branch) in
 * `docs/plans/scanner-ingest-docling-decisions.md`.
 */

import { execa } from "execa";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { errorMessage } from "../../lib/error-guards.js";

/** Awake-second budget for a probe. These read a few pages; anything near this is pathological. */
const PROBE_TIMEOUT_MS = 30_000;

/** Rendering a whole scan batch is heavier than a probe, but still bounded. */
const RENDER_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * How many leading pages `pdftotext` reads for the text-layer question. A
 * scanner either OCRs the whole job or none of it, so the first pages answer
 * for the document; reading all of a 200-page PDF to learn the same thing is
 * waste.
 */
const TEXT_LAYER_PAGE_SAMPLE = 5;

/**
 * Non-whitespace characters in the sample below which we call it "no text
 * layer". Not zero: a scanner-produced textless PDF often still carries a few
 * stray glyphs (a producer watermark, a page-number artifact), and one of
 * those must not route a photo batch into document mode.
 */
const TEXT_LAYER_MIN_CHARS = 64;

export interface PdfProbe {
  /** True when the PDF carries enough embedded text to treat as a document. */
  hasTextLayer: boolean;
  /**
   * How the answer was reached — `probed` when `pdftotext` ran, `assumed` when
   * it could not (no poppler on the host), in which case `hasTextLayer` is the
   * conservative default rather than a measurement.
   */
  textLayerSource: "probed" | "assumed";
  pages?: number;
  title?: string;
  author?: string;
}

/**
 * `pdfinfo`'s `Key: value` output. Missing keys, a missing binary, and a
 * non-zero exit are all "we don't know" — metadata is optional on the card, so
 * an absent value costs nothing, while failing intake over it would cost the
 * whole document.
 */
async function readPdfInfo(pdfPath: string): Promise<{ pages?: number; title?: string; author?: string }> {
  let stdout: string;
  try {
    const result = await execa("pdfinfo", [pdfPath], { timeout: PROBE_TIMEOUT_MS, reject: false });
    if (result.exitCode !== 0) return {};
    stdout = result.stdout;
  } catch (e) {
    console.warn(`[scan] pdfinfo could not be run (${errorMessage(e)}); document metadata will be omitted`);
    return {};
  }
  const info: Record<string, string> = {};
  for (const line of stdout.split("\n")) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const value = line.slice(separator + 1).trim();
    if (value !== "") info[line.slice(0, separator).trim()] = value;
  }
  const out: { pages?: number; title?: string; author?: string } = {};
  const pages = Number(info["Pages"]);
  if (Number.isInteger(pages) && pages > 0) out.pages = pages;
  if (info["Title"] !== undefined) out.title = info["Title"];
  if (info["Author"] !== undefined) out.author = info["Author"];
  return out;
}

/**
 * Does this PDF carry a text layer?
 *
 * When `pdftotext` is unavailable the answer is `true` by assumption, not by
 * measurement: that routes to document mode, which is what every PDF did
 * before this split existed, and document mode's own failure fallback keeps
 * the original bytes either way. Assuming `false` instead would send a real
 * document through Gemini page-by-page — expensive and wrong — on nothing more
 * than a missing package.
 */
async function probeTextLayer(pdfPath: string): Promise<{ hasTextLayer: boolean; textLayerSource: "probed" | "assumed" }> {
  try {
    const result = await execa(
      "pdftotext",
      ["-f", "1", "-l", String(TEXT_LAYER_PAGE_SAMPLE), "-q", pdfPath, "-"],
      { timeout: PROBE_TIMEOUT_MS, reject: false }
    );
    if (result.exitCode !== 0) {
      console.warn(`[scan] pdftotext exited ${String(result.exitCode)} on ${path.basename(pdfPath)}; assuming a text layer`);
      return { hasTextLayer: true, textLayerSource: "assumed" };
    }
    const characters = result.stdout.replaceAll(/\s/gu, "").length;
    return { hasTextLayer: characters >= TEXT_LAYER_MIN_CHARS, textLayerSource: "probed" };
  } catch (e) {
    console.warn(`[scan] pdftotext could not be run (${errorMessage(e)}); assuming a text layer`);
    return { hasTextLayer: true, textLayerSource: "assumed" };
  }
}

export async function probePdf(pdfPath: string): Promise<PdfProbe> {
  const [textLayer, info] = await Promise.all([probeTextLayer(pdfPath), readPdfInfo(pdfPath)]);
  return { ...textLayer, ...info };
}

/** Resolution for the textless-PDF page renders that go to the photo flow. */
const RENDER_DPI = 150;

/**
 * Rendering a textless PDF to page images failed, so the photo flow has
 * nothing to analyze. `detail` carries the poppler-side reason.
 */
export class PdfRenderError extends Error {
  readonly detail: string;
  constructor(context: { detail: string }) {
    super(`Could not render PDF pages for photo analysis: ${context.detail}`);
    this.name = "PdfRenderError";
    this.detail = context.detail;
  }
}

/**
 * Render every page of a textless PDF to JPEG, returning the files in page
 * order. `pdftoppm` writes `<prefix>-01.jpg`-style names itself; we read the
 * directory back rather than predicting its zero-padding, which varies with
 * the page count.
 *
 * Throws rather than returning a Result: unlike extraction, there is no
 * degraded mode here — without page images the photo flow has nothing to
 * analyze, and the caller reports the failure to the user.
 */
export async function renderPdfPages(pdfPath: string, options: { outDir: string }): Promise<string[]> {
  await fs.mkdir(options.outDir, { recursive: true });
  const prefix = path.join(options.outDir, "page");
  try {
    const result = await execa(
      "pdftoppm",
      ["-jpeg", "-r", String(RENDER_DPI), pdfPath, prefix],
      { timeout: RENDER_TIMEOUT_MS, reject: false }
    );
    if (result.exitCode !== 0) {
      throw new PdfRenderError({ detail: `pdftoppm exited ${String(result.exitCode)}: ${result.stderr.trim()}` });
    }
  } catch (e) {
    if (e instanceof PdfRenderError) throw e;
    throw new PdfRenderError({ detail: `pdftoppm could not be run (is poppler-utils installed?): ${errorMessage(e)}` });
  }
  const entries = await fs.readdir(options.outDir);
  // `pdftoppm` pads the page number only as wide as the page count needs, so a
  // 10-page document yields `page-1.jpg` … `page-10.jpg` — string order would
  // put page 10 second. Sort on the number itself.
  const pageNumber = (name: string): number => Number(/^page-(\d+)\.jpg$/u.exec(name)?.[1] ?? 0);
  const pages = entries
    .filter((name) => /^page-\d+\.jpg$/u.test(name))
    .toSorted((a, b) => pageNumber(a) - pageNumber(b));
  if (pages.length === 0) throw new PdfRenderError({ detail: "pdftoppm produced no page images" });
  return pages.map((name) => path.join(options.outDir, name));
}
