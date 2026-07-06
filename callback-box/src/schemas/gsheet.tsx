/**
 * Sheet card schema — metadata for a Google Sheets spreadsheet synced to the box.
 *
 * Pure frontmatter. Each tab's JSON data lives in the card's `.attach/`
 * scope; each entry in `sheets:` is a `{ref, title, gid}` object pointing
 * at one tab file.
 *
 * Example file layout:
 *   store/drive/Budget.gsheet.card
 *   store/drive/Budget.attach/Summary.json
 *   store/drive/Budget.attach/Expenses.json
 */

import { stringify as stringifyYaml } from "yaml";
import { z } from "zod";
import { cardSchema, type InferCardFields } from "../cards/index.js";

const SheetTab = z.object({
  ref: z.string(),
  title: z.string(),
  gid: z.string(),
});

export const GsheetSchema = cardSchema("gsheet", {
  description: "A Google Sheets spreadsheet synced by the drive connector — tab data as attached JSON files, pushed back on sync",
  category: "synced",
  fields: {
    "drive-id": z.string(),
    status: z.enum(["synced", "error", "new"]).optional(),
    title: z.string(),
    modified: z.string(),
    link: z.string(),
    owner: z.string(),
    sheets: z.array(SheetTab),
    comments: z.object({ ref: z.string() }).optional(),
  },
  instructions: `# Gsheet Cards

**Location:** Anywhere in the box, commonly \`store/drive/\`.

Each synced Google Spreadsheet has a \`.gsheet.card\` metadata file plus
an attach scope (\`{basename}.attach/\`) containing one JSON file per
sheet tab. The \`sheets:\` field lists \`{ref, title, gid}\` entries
pointing into that scope.

## Data format
Each tab is a JSON file with one row per line. Cell values are:
- Plain values: strings, numbers, booleans, or null
- Formula cells: \`{"f": "=SUM(A1:B1)", "v": "$42.00"}\` — \`f\` is the
  formula, \`v\` is the computed display value

## Reading spreadsheet data
1. Read the card to understand structure: title, tabs, Google link
2. Read the JSON tab files — plain values are bare, formula cells have
   both the formula and computed result

## Editing spreadsheet data
Edit the JSON file directly and commit. For plain cells, just change
the value. For formula cells, edit the \`f\` field (the \`v\` field will
be updated on next sync). On next sync (\`cb wakeup\` or
\`cb drive sync\`), local changes are pushed to Google Sheets. Do NOT
modify the card frontmatter — it is managed by the connector — with one
exception: \`contains:\` is agent-owned and survives sync; set it freely
(\`cb contains update\`).

## Comments
Collaborative feedback from the upstream spreadsheet is captured as a
sidecar inside the attach scope (\`{basename}.comments.json\`), referenced
by the \`comments.ref:\` field when present. It holds the full comment
thread: content, author, timestamps, resolved status, the anchored text,
and replies. This is read-only context regenerated on each pull — editing
or pushing tab data does NOT write comments back upstream. Read it to
understand reviewer feedback; don't expect changes to round-trip.

## Moving spreadsheets
Moving the card moves its attach scope (with the tab data inside)
atomically — the \`drive-id\` field maintains the link to Google Drive.`,
});

export type GsheetFields = InferCardFields<typeof GsheetSchema>;

export function createGsheetTemplate(options: {
  driveId: string;
  title: string;
  modified: string;
  link: string;
  owner: string;
  sheets: Array<{ ref: string; title: string; gid: string }>;
  commentsFile?: string | undefined;
  status?: "synced" | "error" | "new";
}): string {
  const fields: Record<string, unknown> = {
    "drive-id": options.driveId,
    status: options.status === undefined ? "synced" : options.status,
    title: options.title,
    modified: options.modified,
    link: options.link,
    owner: options.owner,
    sheets: options.sheets,
  };
  if (options.commentsFile !== undefined) {
    fields["comments"] = { ref: `attach/${options.commentsFile}` };
  }
  return `---\n${stringifyYaml(fields)}---\n`;
}
