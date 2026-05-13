/** @jsxImportSource cardworks/jsx */
/**
 * File card schema — arbitrary files uploaded via capture.
 *
 * Mirrors the image/audio pattern: a `.file.card` alongside an attached
 * file that shares the basename (e.g. `file-001-tax-return.pdf` next to
 * `file-001-tax-return.file.card`). The card records the original upload
 * name, MIME type, capture time, and source.
 */

import { element, serialize } from "cardworks";
import { z } from "zod";

export const FileStatus = z.enum(["new", "processed", "invalid"]);
export type FileStatus = z.infer<typeof FileStatus>;

export const FileFilename = element("filename", {
  attrs: {
    ref: z.string(),
    captured: z.string().datetime({ offset: true }),
    source: z.string(),
    "original-name": z.string().optional(),
    "mime-type": z.string().optional(),
    size: z.string().optional(),
  },
});

export const FileDescription = element("description", {
  text: z.string().optional(),
});

/**
 * File card schema.
 *
 * Example:
 * ```xml
 * <file status="new">
 * <filename ref="attach/file-001-tax-return.pdf" captured="2026-04-14T15:00:00Z" source="disk" original-name="tax-return-2025.pdf" mime-type="application/pdf" />
 * <description></description>
 * </file>
 * ```
 */
export const FileSchema = element("file", {
  attrs: {
    status: FileStatus.default("new"),
  },
  children: z.array(
    z.union([FileFilename, FileDescription]),
  ),
  instructions: `# File Cards

A file card represents an arbitrary file uploaded via the capture UI (e.g. a PDF, text document, spreadsheet, archive). The attached file lives in the card's attach scope (e.g. \`file-001-tax-return.file.card\` with \`file-001-tax-return.file.attach/file-001-tax-return.pdf\`); the \`<filename ref="attach/…">\` prefix points into that scope.

Elements:
- \`<filename>\` — the attached file. Attributes:
  - \`ref\` — path into the card's attach scope (e.g. \`attach/<stored-name>\`)
  - \`captured\` — upload timestamp
  - \`source\` — origin of the file (e.g. \`disk\`)
  - \`original-name\` — the filename as the user uploaded it
  - \`mime-type\` — the browser-reported MIME type
  - \`size\` — file size in bytes (as a string)
- \`<description>\` — filled in during processing with a short summary of what the file contains

Unlike image/audio cards, no built-in pipeline processes files yet — they land in the capture session and are available for agent handling (extraction into records, archival, etc.). Processors should set \`status="processed"\` when done, or \`status="invalid"\` if the file cannot be used.`,
});

export type File = z.infer<typeof FileSchema>;

/**
 * Template for creating a file card.
 *
 * `filename` is the bare attached filename. The template emits it with the
 * `attach/` virtual prefix.
 */
export function createFileTemplate(options: {
  capturedAt: string;
  source: string;
  filename: string;
  originalName?: string;
  mimeType?: string;
  size?: number;
}): string {
  const file = (
    <file status="new">
      <filename
        ref={`attach/${options.filename}`}
        captured={options.capturedAt}
        source={options.source}
        original-name={options.originalName}
        mime-type={options.mimeType}
        size={options.size !== undefined ? String(options.size) : undefined}
      />
      <description></description>
    </file>
  );

  return serialize(file) + "\n";
}
