/**
 * Pure parser for the `<upload …>` chat-message wrapper.
 *
 * A delivered bulk batch is a first-class user message whose body is the wrapper
 * built by `core/bulk-upload/deliver.ts` `buildUploadWrapper`:
 *
 *   <upload doc="…/Batch.upload-batch.card" files="16" bytes="135 MB" failed="2">
 *   Shop exterior
 *
 *   16 files uploaded (135 MB).
 *   </upload>
 *
 * Without this the wrapper fell through to the plain-text renderer and the
 * boxholder saw literal markup in their own chat log (observed on prod,
 * 2026-08-01) — which matters more than the usual raw-markup annoyance because
 * their own introduction rides INSIDE the body, so their words were wrapped in
 * angle brackets too.
 *
 * Kept import-free (no React, no view-url) so it doctests against the exact
 * wrapper string and `user-message` can consume it without a cycle. Mirrors
 * `capture-message.ts`.
 */

/** The parsed shape an upload chip renders from. */
export interface UploadChipModel {
  /** Box-relative path of the upload-batch card (`doc=`). */
  doc: string;
  /** Number of files whose bytes arrived. */
  files: number;
  /** Human total size, already formatted server-side (e.g. `135 MB`). */
  bytes: string;
  /** Files the uploader reported failing (0 when the attribute is absent). */
  failed: number;
  /**
   * The boxholder's own introduction, when they submitted one — the first
   * paragraph of the body. Rendered as their words, NOT as batch metadata.
   */
  note: string;
  /** The generated one-line summary (last paragraph of the body). */
  summary: string;
}

const UPLOAD_RE = /<upload\b([^>]*)>([\S\s]*?)<\/upload>/i;

const DOC_RE = /\bdoc="([^"]*)"/i;
const FILES_RE = /\bfiles="([^"]*)"/i;
const BYTES_RE = /\bbytes="([^"]*)"/i;
const FAILED_RE = /\bfailed="([^"]*)"/i;

function readStringAttr(attrs: string, re: RegExp): string {
  const match = re.exec(attrs);
  return match ? (match[1] ?? "") : "";
}

function readIntAttr(attrs: string, re: RegExp): number {
  const raw = readStringAttr(attrs, re);
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Parse an `<upload …>` wrapper, or `null` when the text isn't one.
 *
 * The body is `note\n\nsummary` when the batch carried an introduction, and just
 * `summary` when it didn't — the server omits the note entirely rather than
 * sending an empty one, so a blank first paragraph never appears. Splitting on
 * the LAST blank line keeps a multi-paragraph introduction intact.
 */
export function parseUploadWrapper(text: string): UploadChipModel | null {
  const match = UPLOAD_RE.exec(text.trim());
  if (!match) return null;
  const attrs = match[1] ?? "";
  const doc = readStringAttr(attrs, DOC_RE);
  if (doc === "") return null;

  const body = (match[2] ?? "").trim();
  const split = body.lastIndexOf("\n\n");
  const note = split === -1 ? "" : body.slice(0, split).trim();
  const summary = split === -1 ? body : body.slice(split + 2).trim();

  return {
    doc,
    files: readIntAttr(attrs, FILES_RE),
    bytes: readStringAttr(attrs, BYTES_RE),
    failed: readIntAttr(attrs, FAILED_RE),
    note,
    summary,
  };
}
