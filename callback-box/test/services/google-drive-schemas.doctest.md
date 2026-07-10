# Inbound Google Drive response schemas

`services/google-drive-schemas.ts` holds the narrow, drift-tolerant zod schemas
that `validateResponse` runs over the raw Drive / Sheets / Docs API responses
the real `createGoogleDriveService` consumes. Only the fields we read are
modelled; unknown extra keys pass; a missing REQUIRED field is loud drift.

```ts setup
import {
  validateResponse,
  ConnectorResponseError,
} from "../../src/services/connector-response.js";
import {
  driveGetFileSchema,
  driveFileListSchema,
  spreadsheetMetadataSchema,
  sheetValuesSchema,
  documentStructureSchema,
  driveCommentListSchema,
} from "../../src/services/google-drive-schemas.js";
import type { z } from "zod";

function vErr(raw: unknown, ctx: { schema: z.ZodType; service: string; operation: string }): ConnectorResponseError | null {
  try { validateResponse(raw, ctx); return null; } catch (e) { return e instanceof ConnectorResponseError ? e : null; }
}
```

## getFile — well-shaped file validates, drift throws

A file with the fields we consume (plus extra keys Google sends) passes;
unknown keys are ignored.

```ts
const file = {
  id: "f1", name: "Budget", mimeType: "application/vnd.google-apps.spreadsheet",
  modifiedTime: "2026-03-29T10:00:00Z",
  owners: [{ emailAddress: "a@example.com", displayName: "A" }],
  webViewLink: "https://docs.google.com/x", capabilities: { canEdit: true },
};
validateResponse(file, { schema: driveGetFileSchema, service: "drive", operation: "getFile" });
"ok"
=> ok
```

A file missing its `id` is real drift — a loud error naming service + operation.

```ts continue
const bad = vErr({ name: "x", mimeType: "y", modifiedTime: "z" }, { schema: driveGetFileSchema, service: "drive", operation: "getFile" });
JSON.stringify({ service: bad?.service, operation: bad?.operation, issues: bad?.issues })
=> {"service":"drive","operation":"getFile","issues":["id: Invalid input: expected string, received undefined"]}
```

## File list, sheet values, spreadsheet metadata

The list envelope shared by `listFiles`/`listSpreadsheets` — an absent `files`
array is legal (empty page).

```ts
validateResponse({ nextPageToken: "p2" }, { schema: driveFileListSchema, service: "drive", operation: "listFiles" });
validateResponse({ values: [["Name", "Age"], ["Alice", "30"]] }, { schema: sheetValuesSchema, service: "drive", operation: "getSheetValues" });
const meta = { spreadsheetId: "s1", properties: { title: "T" }, sheets: [{ properties: { sheetId: 0, title: "Sheet1" } }] };
validateResponse(meta, { schema: spreadsheetMetadataSchema, service: "drive", operation: "getSpreadsheet" });
"ok"
=> ok
```

A spreadsheet whose sheet is missing its numeric `sheetId` is drift:

```ts continue
const bad = vErr(
  { spreadsheetId: "s1", properties: { title: "T" }, sheets: [{ properties: { title: "Sheet1" } }] },
  { schema: spreadsheetMetadataSchema, service: "drive", operation: "getSpreadsheet" },
);
JSON.stringify(bad?.issues)
=> ["sheets.0.properties.sheetId: Invalid input: expected number, received undefined"]
```

## comments — envelope with optional author/resolved

```ts
const comments = {
  comments: [
    { id: "c1", content: "nice", author: { displayName: "A" }, resolved: false, createdTime: "2026-01-01T00:00:00Z" },
    { id: "c2", content: "fix this" },
  ],
};
validateResponse(comments, { schema: driveCommentListSchema, service: "drive", operation: "listComments" });
"ok"
=> ok
```

## getDocument — the recursive document structure

A Google Doc body is a tree: a `table` cell's `content` is itself an array of
structural elements, so `documentStructureSchema` recurses through `z.lazy`. A
realistic response — a paragraph with a text run and an equation, plus a table
whose cell contains a nested paragraph — validates whole.

```ts
const doc = {
  documentId: "d1",
  title: "Design",
  revisionId: "rev-9",
  body: {
    content: [
      {
        paragraph: {
          elements: [
            { textRun: { content: "Hello ", suggestedInsertionIds: ["u1"] } },
            { equation: { suggestedInsertionIds: [] } },
          ],
        },
      },
      {
        table: {
          tableRows: [
            {
              tableCells: [
                { content: [{ paragraph: { elements: [{ textRun: { content: "cell A1" } }] } }] },
                { content: [{ paragraph: { elements: [{ textRun: { content: "cell A2" } }] } }] },
              ],
            },
          ],
        },
      },
    ],
  },
  inlineObjects: { img1: { objectId: "img1" } },
  footnotes: { fn1: {} },
};
validateResponse(doc, { schema: documentStructureSchema, service: "drive", operation: "getDocument" });
"ok"
=> ok
```

Recursion goes arbitrarily deep — a table cell holding a table holding a cell
holding a paragraph still validates.

```ts continue
const deep = {
  documentId: "d2", title: "Nested", revisionId: "rev-1",
  body: { content: [
    { table: { tableRows: [ { tableCells: [
      { content: [ { table: { tableRows: [ { tableCells: [
        { content: [ { paragraph: { elements: [ { textRun: { content: "deep" } } ] } } ] },
      ] } ] } } ] },
    ] } ] } },
  ] },
};
validateResponse(deep, { schema: documentStructureSchema, service: "drive", operation: "getDocument" });
"ok"
=> ok
```

A document missing its `revisionId` is drift:

```ts continue
const bad = vErr({ documentId: "d1", title: "x" }, { schema: documentStructureSchema, service: "drive", operation: "getDocument" });
JSON.stringify(bad?.issues)
=> ["revisionId: Invalid input: expected string, received undefined"]
```
