/**
 * Frontend-side reading of a pdf card (`src/schemas/pdf.ts`).
 *
 * The card type string and the reanalyze command text live here, in one place
 * each: the renderer, the view, and the file-type icon registration all import
 * these rather than spelling the type out.
 *
 * The frontmatter reader is deliberately tolerant: `data.frontmatter` reaches
 * the frontend as `Record<string, unknown>` (already Zod-validated on the
 * backend, but untyped across the wire), so every field is read defensively and
 * a missing/odd value degrades to `null` rather than throwing in a renderer.
 */

import { isRecord } from "@shared/is-record";

/** Card type of an extracted pdf. */
export const EXTRACTED_CARD_TYPE = "pdf";

/** CLI command that re-runs extraction; shown when extraction failed. */
export const EXTRACTED_REANALYZE_COMMAND = "cb pdf reanalyze";

/** Name of the renderer that shows the original file rather than the text. */
export const ORIGINAL_RENDERER_NAME = "Original";

/** Page renders written by the extractor: `page-001.avif`, `page-002.avif`, … */
export const PAGE_RENDER_RE = /^page-(\d{3})\.avif$/;

/** The page number a page-render filename encodes, or `null` if it isn't one. */
export function pageRenderNumber(name: string): number | null {
  const match = PAGE_RENDER_RE.exec(name);
  if (match === null) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
}

/** A `?page=N` embed/query param, as a page number. Non-numeric input → null. */
export function requestedPage(params: Record<string, string> | undefined): number | null {
  const raw = params?.["page"];
  if (raw === undefined) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** One page render, ready for the strip. */
export interface DocumentPage {
  /** 1-based page number, from the `page-NNN.avif` filename. */
  page: number;
  /** Resolved image URL for the render. */
  src: string;
}

/**
 * Pick the page renders out of an attach-scope listing, in page order.
 * `toSrc` turns a box-relative path into an image URL (the caller holds the
 * box slug); everything else about the strip is decided here.
 */
export function pageRendersFrom(
  files: Array<{ name: string; relativePath: string }>,
  toSrc: (relativePath: string) => string,
): DocumentPage[] {
  return files
    .flatMap((file) => {
      const page = pageRenderNumber(file.name);
      if (page === null) return [];
      return [{ page, src: toSrc(file.relativePath) }];
    })
    .toSorted((a, b) => a.page - b.page);
}

/**
 * True when a page-render notice belongs on the card: the card says pages
 * were extracted (`status: analyzed`, `metadata.pages > 0`), the attach-scope
 * listing finished without error, and it came back with none. Distinct from
 * a still-loading or errored listing (those get their own state) and from a
 * card that never claimed to have pages (`metadata.pages` absent or 0) —
 * unanalyzed and pre-extraction cards are silent by design.
 */
export function missingPageRenders({
  fields,
  pages,
  pagesLoading,
  pagesErrored,
}: {
  fields: Pick<ExtractedDocumentFields, "status" | "pages">;
  pages: DocumentPage[];
  pagesLoading: boolean;
  pagesErrored: boolean;
}): boolean {
  return (
    fields.status === "analyzed" &&
    fields.pages !== null &&
    fields.pages > 0 &&
    !pagesLoading &&
    !pagesErrored &&
    pages.length === 0
  );
}

export interface ExtractedDocumentFields {
  /** `new` | `analyzed` | `invalid` as written; any other value passes through. */
  status: string | null;
  /** Source document type, e.g. `pdf`. */
  format: string | null;
  /** Ref to the original bytes, normally `attach/source.pdf`. */
  originalRef: string | null;
  /** The file's name before capture, when the pipeline recorded one. */
  originalName: string | null;
  captured: string | null;
  source: string | null;
  title: string | null;
  author: string | null;
  pages: number | null;
  /** Extraction failure message — set together with `status: new`. */
  error: string | null;
  description: string | null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function readExtractedFields(
  frontmatter: Record<string, unknown> | undefined,
): ExtractedDocumentFields {
  const fm = frontmatter ?? {};
  const filename = isRecord(fm["filename"]) ? fm["filename"] : {};
  const metadata = isRecord(fm["metadata"]) ? fm["metadata"] : {};
  return {
    status: str(fm["status"]),
    format: str(fm["format"]),
    originalRef: str(filename["ref"]),
    originalName: str(filename["original-name"]),
    captured: str(filename["captured"]),
    source: str(filename["source"]),
    title: str(metadata["title"]),
    author: str(metadata["author"]),
    pages: num(metadata["pages"]),
    error: str(fm["error"]),
    description: str(fm["description"]),
  };
}
