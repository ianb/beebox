/**
 * File card schema — arbitrary files uploaded via capture.
 *
 * Pure metadata about a non-card binary file (PDF, archive, text doc, …).
 * The actual file lives in the card's `.attach/` scope; `filename.ref`
 * points at it, with `via` (how and when it arrived) and upload metadata
 * as siblings of the ref under the same key.
 *
 * Example file layout:
 *   inbox/scan-XX.attach/source.file.card
 *   inbox/scan-XX.attach/source.attach/tax-return.pdf
 */

import { stringify as stringifyYaml } from "yaml";
import { z } from "zod";
import { cardSchema, type InferCardFields } from "../exports/cards.js";
import { MediaViaSchema, type MediaVia } from "../cards/media-via.js";


const FilenameEntry = z.object({
  ref: z.string(),
  via: MediaViaSchema,
  "original-name": z.string().optional(),
  "mime-type": z.string().optional(),
  size: z.coerce.number().optional(),
});

export const FileSchema = cardSchema("file", {
  brief: "An uploaded file's metadata",
  description: "Metadata for an arbitrary uploaded file (PDF, archive, …) — the binary lives in the attach scope, awaiting agent handling",
  category: "synced",
  fields: {
    filename: FilenameEntry,
    description: z.string().optional(),
  },
  instructions: `# File Cards

A file card represents an arbitrary file uploaded via the capture UI
(e.g. a PDF, text document, spreadsheet, archive).

Frontmatter:
- \`filename:\` — the attached file as a \`{ref, via, ...}\` object.
  \`ref:\` is the path into the card's attach scope
  (e.g. \`attach/{storedName}\`). \`via:\` says how it came into the box:
  \`channel\` (e.g. \`disk\`, \`scan-import\`, \`scan-upload/<token>\`),
  \`at\` (the upload or import timestamp), and optionally \`original\`
  (the date of the original document when known and different from \`at\`:
  \`YYYY\`, \`YYYY-MM\`, or \`YYYY-MM-DD\`) and \`note\` (how or why, in
  prose). Optional siblings of \`via\`: \`original-name\` (filename as
  uploaded), \`mime-type\` (browser-reported MIME), \`size\` (bytes).
- \`description:\` — short summary of what the file contains, filled in
  during processing. Doubles as the \`contains:\` fallback for search;
  set an explicit \`contains:\` only when it should differ.

Unlike image/audio cards, no built-in pipeline processes files yet —
they land in the capture session and are available for agent handling
(extraction into records, archival, etc.). There is no processed marker:
what a processor extracts (records, a \`description:\`) is the record of its
work.`,
});

export type FileFields = InferCardFields<typeof FileSchema>;

export function createFileTemplate(options: {
  via: MediaVia;
  filename: string;
  originalName?: string;
  mimeType?: string;
  size?: number;
}): string {
  const filename: Record<string, unknown> = {
    ref: `attach/${options.filename}`,
    via: options.via,
  };
  if (options.originalName !== undefined) filename["original-name"] = options.originalName;
  if (options.mimeType !== undefined) filename["mime-type"] = options.mimeType;
  if (options.size !== undefined) filename["size"] = options.size;
  const fields: Record<string, unknown> = {
    filename,
  };
  return `---\n${stringifyYaml(fields)}---\n`;
}
