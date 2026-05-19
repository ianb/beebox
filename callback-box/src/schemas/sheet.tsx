/** @jsxImportSource cardworks/jsx */
/**
 * Sheet card schema — metadata for a Google Sheets spreadsheet synced to the box.
 *
 * Each spreadsheet gets a `.sheet.card` with metadata, linking to JSON tab
 * files inside the card's attach scope.
 *
 * Example layout:
 *   store/drive/Budget.sheet.card
 *   store/drive/Budget.attach/Summary.json
 *   store/drive/Budget.attach/Expenses.json
 */

import { element, serialize } from "cardworks";
import { z } from "zod";

export const SheetTitle = element("title", {
  text: z.string(),
});

export const SheetModified = element("modified", {
  text: z.string(),
});

export const SheetLink = element("link", {
  text: z.string(),
});

export const SheetOwner = element("owner", {
  text: z.string(),
});

/**
 * Reference to a single sheet tab's CSV file.
 */
export const SheetTab = element("sheet-tab", {
  attrs: {
    ref: z.string(),
    title: z.string(),
    gid: z.string(),
  },
});

/**
 * Container for sheet tab references.
 */
export const SheetTabs = element("sheets", {
  children: z.array(SheetTab),
});

/**
 * Sheet card schema.
 *
 * Example:
 * ```xml
 * <sheet drive-id="1abc..." status="synced">
 * <title>Household Budget 2026</title>
 * <modified>2026-03-29T14:30:00Z</modified>
 * <link>https://docs.google.com/spreadsheets/d/1abc.../edit</link>
 * <owner>ian@example.com</owner>
 * <sheets>
 * <sheet-tab ref="attach/Summary.json" title="Summary" gid="0"/>
 * <sheet-tab ref="attach/Expenses.json" title="Expenses" gid="123456"/>
 * </sheets>
 * </sheet>
 * ```
 */
export const SheetSchema = element("sheet", {
  attrs: {
    "drive-id": z.string(),
    status: z.enum(["synced", "error", "new"]).optional(),
  },
  children: z.array(
    z.union([
      SheetTitle,
      SheetModified,
      SheetLink,
      SheetOwner,
      SheetTabs,
    ])
  ),
  instructions: `# Sheet Cards

**Location:** Anywhere in the box, commonly \`store/drive/\`.

Each synced Google Spreadsheet has a \`.sheet.card\` metadata file plus an
attach scope (\`{basename}.attach/\`) containing one JSON file per sheet
tab. The \`<sheet-tab ref="attach/…">\` entries point into that scope.

## Data format
Each tab is a JSON file with one row per line. Cell values are:
- Plain values: strings, numbers, booleans, or null
- Formula cells: \`{"f": "=SUM(A1:B1)", "v": "$42.00"}\` — \`f\` is the formula, \`v\` is the computed display value

Example:
\`\`\`json
[
["Name", "Amount", "Total"],
["Alice", 100, {"f": "=SUM(B2:B3)", "v": "250"}],
["Bob", 150, ""]
]
\`\`\`

## Reading spreadsheet data
1. Read the card to understand structure: title, tabs, Google link
2. Read the JSON tab files — plain values are bare, formula cells have both the formula and computed result

## Editing spreadsheet data
Edit the JSON file directly and commit. For plain cells, just change the value.
For formula cells, edit the \`f\` field (the \`v\` field will be updated on next sync).
On next sync (\`cb wakeup\` or \`cb drive sync\`), local changes are pushed to Google Sheets.
Do NOT modify the card XML — it is managed by the connector.

## Moving spreadsheets
Moving the card moves its attach scope (with the tab data inside) atomically —
the \`drive-id\` attribute in the card maintains the link to Google Drive.`,
});

export type Sheet = z.infer<typeof SheetSchema>;

/**
 * Create a sheet card from metadata.
 */
export function createSheetTemplate(options: {
  driveId: string;
  title: string;
  modified: string;
  link: string;
  owner: string;
  sheets: Array<{ ref: string; title: string; gid: string }>;
  status?: "synced" | "error" | "new";
}): string {
  const card = (
    <sheet drive-id={options.driveId} status={options.status ?? "synced"}>
      <title>{options.title}</title>
      <modified>{options.modified}</modified>
      <link>{options.link}</link>
      <owner>{options.owner}</owner>
      <sheets>
        {options.sheets.map((s) => (
          <sheet-tab ref={s.ref} title={s.title} gid={s.gid} />
        ))}
      </sheets>
    </sheet>
  );

  return serialize(card) + "\n";
}
