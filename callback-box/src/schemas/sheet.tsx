/** @jsxImportSource cardworks/jsx */
/**
 * Sheet card schema — metadata for a Google Sheets spreadsheet synced to the box.
 *
 * Each spreadsheet gets a `.sheet.card` with metadata, linking to CSV files
 * per sheet tab in a subdirectory with the same basename.
 *
 * Example layout:
 *   store/drive/Budget.sheet.card
 *   store/drive/Budget/Summary.csv
 *   store/drive/Budget/Expenses.csv
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
    file: z.string(),
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
 * <sheet-tab file="Budget/Summary.csv" title="Summary" gid="0"/>
 * <sheet-tab file="Budget/Expenses.csv" title="Expenses" gid="123456"/>
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

Each synced Google Spreadsheet has a \`.sheet.card\` metadata file plus a subdirectory
(same basename) containing one CSV file per sheet tab.

## Reading spreadsheet data
1. Read the card to understand structure: title, tabs, Google link
2. Read the CSV files for actual data — they contain formulas (e.g., \`=SUM(A1:A10)\`), not computed values

## Editing spreadsheet data
Edit the CSV file directly and commit. On next sync (\`cb wakeup\` or \`cb drive sync\`),
local changes are pushed back to Google Sheets. Do NOT modify the card XML — it is
managed by the connector.

## Moving spreadsheets
Moving the card (and its CSV directory) to a new location is safe — the \`drive-id\`
attribute in the card maintains the link to Google Drive.`,
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
  sheets: Array<{ file: string; title: string; gid: string }>;
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
          <sheet-tab file={s.file} title={s.title} gid={s.gid} />
        ))}
      </sheets>
    </sheet>
  );

  return serialize(card) + "\n";
}
