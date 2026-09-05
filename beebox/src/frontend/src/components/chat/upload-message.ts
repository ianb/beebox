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
 * The shared delivered-user-message codec owns wire parsing. This module keeps
 * the upload-specific compatibility parser for callers that expect one model.
 */

import {
  parseDeliveredUserMessageParts,
  type UploadUserMessage,
} from "@shared/delivered-user-message";

/** The parsed shape an upload chip renders from. */
export type UploadChipModel = Omit<UploadUserMessage, "kind">;

/**
 * Parse one `<upload …>` wrapper, or `null` when the text is not solely an
 * upload plus optional surrounding whitespace.
 *
 * The body is `note\n\nsummary` when the batch carried an introduction, and just
 * `summary` when it didn't — the server omits the note entirely rather than
 * sending an empty one, so a blank first paragraph never appears. Splitting on
 * the LAST blank line keeps a multi-paragraph introduction intact.
 */
export function parseUploadWrapper(text: string): UploadChipModel | null {
  const parts = parseDeliveredUserMessageParts(text)
    .filter((part) => part.kind !== "text" || part.text.trim() !== "");
  const part = parts.length === 1 ? parts.at(0) : undefined;
  if (part?.kind !== "upload") return null;
  return {
    doc: part.doc,
    files: part.files,
    bytes: part.bytes,
    failed: part.failed,
    note: part.note,
    summary: part.summary,
  };
}
