/**
 * Write a `pdf.card`: copy the original into the card's attach scope, probe it,
 * extract it with Docling, and render the card. Shared by `bbx scan-import`'s
 * pdf mode and `bbx pdf save`, which differ in where the card goes and what
 * they commit.
 *
 * A failed extraction is a return value: the card is still written, with an
 * `error:` and the original as its only asset, so a Docling problem never
 * blocks the caller (`docs/implemented-plans/scanner-ingest.md`, Track 4).
 */

import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { SourcesEntry } from "../../cards/sources-entry.js";
import type { MediaVia } from "../../cards/media-via.js";
import { ensureBoxTmpDir } from "../../lib/box-tmp.js";
import { createPdfTemplate, type PdfCaptureFields, type PdfTemplateOptions } from "../../schemas/pdf.js";
import { attachDirFor } from "../../shared/attach-path.js";
import { neutralizeIngestedMarkdown } from "../../shared/markdoc-config/ingest.js";
import { createDoclingService, type DoclingOcr, type DoclingService } from "../../services/docling/core.js";
import { extractPdf } from "./extract.js";
import { probePdf, type PdfProbe } from "./probe.js";

/** Name the original takes inside the pdf card's attach scope. */
const SOURCE_PDF_FILENAME = "source.pdf";

/** The OCR intent a probed PDF calls for. Pure, so the mapping is testable. */
export function ocrIntentFor(probe: Pick<PdfProbe, "hasTextLayer" | "textLayerQuality">): DoclingOcr {
  if (!probe.hasTextLayer) return "regions";
  return probe.textLayerQuality === "junk" ? "replace" : "off";
}

/** Extracted document text is third-party: escape its raw HTML and Markdoc tags. */
export function pdfCardBody(extractedMarkdown: string): string {
  return neutralizeIngestedMarkdown(extractedMarkdown);
}

export interface WritePdfCardInput {
  boxRoot: string;
  /** The PDF to copy in. */
  sourcePath: string;
  /** Where the card goes, box-relative, ending `.pdf.card`. Its attach scope is beside it. */
  cardRel: string;
  via: MediaVia;
  originalName: string;
  sources?: SourcesEntry[] | undefined;
  capture?: PdfCaptureFields | undefined;
  /** Injected in tests; production creates the real `uvx docling` wrapper. */
  docling?: DoclingService | undefined;
  /** An existing card or original is an EEXIST error, and nothing replaces it. */
  exclusive?: boolean | undefined;
}

export interface WrittenPdfCard {
  /** Box-relative paths written: the original, the extraction's assets, the card last. */
  paths: string[];
  /** Null when extraction failed. */
  pages: number | null;
  imageAssets: number;
  /** The extraction failure, also written on the card. */
  error: string | null;
}

export async function writePdfCard(input: WritePdfCardInput): Promise<WrittenPdfCard> {
  const { boxRoot, cardRel, exclusive } = input;
  const attachRelDir = attachDirFor(cardRel);
  const attachAbsDir = path.join(boxRoot, attachRelDir);
  const cardAbsPath = path.join(boxRoot, cardRel);
  // An exclusive write claims the card's name and its attach folder first, so
  // a taken name, or a folder another type of card owns, fails before anything is copied.
  await fs.mkdir(path.dirname(attachAbsDir), { recursive: true });
  if (exclusive === true) await fs.mkdir(attachAbsDir);
  else await fs.mkdir(attachAbsDir, { recursive: true });
  try {
    if (exclusive === true) await fs.writeFile(cardAbsPath, "", { flag: "wx" });
  } catch (e) {
    await fs.rmdir(attachAbsDir);
    throw e;
  }
  try {
    return await writeFiles(input, { attachRelDir, attachAbsDir, cardAbsPath });
  } catch (e) {
    if (exclusive === true) {
      await fs.rm(cardAbsPath, { force: true });
      await fs.rm(attachAbsDir, { recursive: true, force: true });
    }
    throw e;
  }
}

async function writeFiles(input: WritePdfCardInput, where: { attachRelDir: string; attachAbsDir: string; cardAbsPath: string }): Promise<WrittenPdfCard> {
  const { boxRoot, sourcePath, cardRel, exclusive } = input;
  const { attachRelDir, attachAbsDir, cardAbsPath } = where;
  const pdfDestPath = path.join(attachAbsDir, SOURCE_PDF_FILENAME);
  await fs.copyFile(sourcePath, pdfDestPath, exclusive === true ? constants.COPYFILE_EXCL : 0);
  const stat = await fs.stat(pdfDestPath);

  const probe = await probePdf(pdfDestPath);
  const docling = input.docling ?? createDoclingService();
  const workDir = path.join(await ensureBoxTmpDir(boxRoot), `pdf-extract-${randomUUID().slice(0, 8)}`);
  await fs.mkdir(workDir, { recursive: true });
  let extraction;
  try {
    extraction = await extractPdf({
      docling,
      sourcePath: pdfDestPath,
      attachAbsDir,
      workDir,
      // Three cases, not two. No layer at all: OCR the layout's regions, the
      // only way to get text out of it. A layer that is present but junk —
      // a scanner's own failed OCR, one character per token — is replaced
      // wholesale, because reading it would file the document with text
      // nobody can use and nothing downstream would notice. A good layer is
      // left alone: it beats re-OCRing an image of itself.
      ocr: ocrIntentFor(probe),
      languages: null,
    });
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }

  const template: PdfTemplateOptions = {
    format: "pdf",
    via: input.via,
    filename: SOURCE_PDF_FILENAME,
    originalName: input.originalName,
    mimeType: "application/pdf",
    size: stat.size,
    body: extraction.ok ? pdfCardBody(extraction.value.body) : "",
  };
  if (input.sources !== undefined) template.sources = input.sources;
  if (input.capture !== undefined) template.capture = input.capture;
  const metadata: { pages?: number; title?: string; author?: string } = {};
  if (probe.pages !== undefined) metadata.pages = probe.pages;
  else if (extraction.ok) metadata.pages = extraction.value.pageCount;
  if (probe.title !== undefined) metadata.title = probe.title;
  if (probe.author !== undefined) metadata.author = probe.author;
  if (Object.keys(metadata).length > 0) template.metadata = metadata;

  const paths = [`${attachRelDir}/${SOURCE_PDF_FILENAME}`];
  let imageAssets = 0;
  if (extraction.ok) {
    template.doclingFilename = extraction.value.doclingFilename;
    template.doclingVersion = extraction.value.doclingVersion;
    for (const name of extraction.value.assetNames) paths.push(`${attachRelDir}/${name}`);
    imageAssets = extraction.value.assetNames.filter((name) => name.endsWith(".avif") || name.endsWith(".webp")).length;
  } else {
    template.error = extraction.error;
  }
  await fs.writeFile(cardAbsPath, createPdfTemplate(template), { flag: "w" });
  paths.push(cardRel);
  return { paths, pages: extraction.ok ? extraction.value.pageCount : null, imageAssets, error: extraction.ok ? null : extraction.error };
}
