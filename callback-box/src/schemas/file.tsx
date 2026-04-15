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
    name: z.string(),
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
 * <filename name="file-001-tax-return.pdf" captured="2026-04-14T15:00:00Z" source="disk" original-name="tax-return-2025.pdf" mime-type="application/pdf" />
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

A file card represents an arbitrary file uploaded via the capture UI (e.g. a PDF, text document, spreadsheet, archive). The attached file shares the card's basename (e.g. \`file-001-tax-return.pdf\` alongside \`file-001-tax-return.file.card\`).

Elements:
- \`<filename>\` — the attached file. Attributes:
  - \`name\` — the stored filename (sibling on disk)
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
        name={options.filename}
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
