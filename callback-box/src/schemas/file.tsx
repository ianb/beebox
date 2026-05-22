/**
 * File card schema — arbitrary files uploaded via capture.
 *
 * Pure metadata about a non-card binary file (PDF, archive, text doc, …).
 * The actual file lives in the card's `.attach/` scope; `filename.ref`
 * points at it, with `captured`, `source`, and upload metadata as
 * siblings of the ref under the same key.
 *
 * Example file layout:
 *   inbox/scan-XX.attach/source.file.card
 *   inbox/scan-XX.attach/source.attach/tax-return.pdf
 */

import { cardSchema, type CardSchema } from "cardworks";
import { stringify as stringifyYaml } from "yaml";
import { z } from "zod";

export const FileStatus = z.enum(["new", "processed", "invalid"]);
export type FileStatus = z.infer<typeof FileStatus>;

const FilenameEntry = z.object({
  ref: z.string(),
  captured: z.string().datetime({ offset: true }),
  source: z.string(),
  "original-name": z.string().optional(),
  "mime-type": z.string().optional(),
  size: z.coerce.number().optional(),
});

export const FileSchema: CardSchema = cardSchema("file", {
  fields: {
    status: FileStatus.default("new"),
    filename: FilenameEntry,
    description: z.string().optional(),
  },
  instructions: `# File Cards

A file card represents an arbitrary file uploaded via the capture UI
(e.g. a PDF, text document, spreadsheet, archive). The attached file
lives in the card's attach scope (e.g.
\`file-001-tax-return.file.card\` with
\`file-001-tax-return.attach/file-001-tax-return.pdf\`); \`filename.ref:\`
points into that scope.

Frontmatter:
- \`filename:\` — the attached file as a \`{ref, captured, source, ...}\`
  object. \`ref:\` is the path into the card's attach scope
  (e.g. \`attach/{storedName}\`). \`captured:\` is the upload timestamp,
  \`source:\` the origin (e.g. \`disk\`). Optional siblings:
  \`original-name\` (filename as uploaded), \`mime-type\` (browser-reported
  MIME), \`size\` (bytes).
- \`description:\` — short summary of what the file contains, filled in
  during processing.

Unlike image/audio cards, no built-in pipeline processes files yet —
they land in the capture session and are available for agent handling
(extraction into records, archival, etc.). Processors should set
\`status: processed\` when done, or \`status: invalid\` if the file
cannot be used.`,
});

export interface FileFields {
  type: "file";
  status: FileStatus;
  filename: {
    ref: string;
    captured: string;
    source: string;
    "original-name"?: string;
    "mime-type"?: string;
    size?: number;
  };
  description?: string;
}

export function createFileTemplate(options: {
  capturedAt: string;
  source: string;
  filename: string;
  originalName?: string;
  mimeType?: string;
  size?: number;
}): string {
  const filename: Record<string, unknown> = {
    ref: `attach/${options.filename}`,
    captured: options.capturedAt,
    source: options.source,
  };
  if (options.originalName !== undefined) filename["original-name"] = options.originalName;
  if (options.mimeType !== undefined) filename["mime-type"] = options.mimeType;
  if (options.size !== undefined) filename["size"] = options.size;
  const fields: Record<string, unknown> = {
    type: "file",
    status: "new",
    filename,
  };
  return `---\n${stringifyYaml(fields)}---\n`;
}
