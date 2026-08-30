# Docling — reading the canonical extraction

A pdf card keeps Docling's own `DoclingDocument` beside the original, gzipped, at
`attach/docling.json.gz` (`src/schemas/pdf.ts`). `src/frontend/src/lib/docling.ts`
is the only thing in the repo that reads it back.

The schema is upstream and versioned, so the reader's contract is: **never throw
on shape**. It renders what it recognizes and counts what it doesn't.

```ts setup
import { gzipSync } from "node:zlib";
import {
  gunzipToText,
  isDoclingPath,
  itemsByPage,
  parseDoclingJson,
  readDoclingDocument,
} from "../../../src/frontend/src/lib/docling.js";

/** A small but realistic DoclingDocument: two pages, a table, a picture. */
const HANDBOOK = {
  schema_name: "DoclingDocument",
  version: "1.3.0",
  name: "source",
  origin: { mimetype: "application/pdf", filename: "handbook-2026.pdf" },
  pages: { "1": { page_no: 1 }, "2": { page_no: 2 } },
  body: {
    self_ref: "#/body",
    children: [
      { $ref: "#/texts/0" },
      { $ref: "#/texts/1" },
      { $ref: "#/tables/0" },
      { $ref: "#/pictures/0" },
      { $ref: "#/texts/3" },
      { $ref: "#/key_value_items/0" },
    ],
  },
  texts: [
    { self_ref: "#/texts/0", label: "title", text: "Employee Handbook 2026", level: 1,
      prov: [{ page_no: 1, bbox: { l: 0, t: 0, r: 1, b: 1 }, charspan: [0, 22] }] },
    { self_ref: "#/texts/1", label: "paragraph", text: "Onboarding starts on your first Monday.",
      prov: [{ page_no: 1 }] },
    { self_ref: "#/texts/2", label: "caption", text: "Figure 1 — the org chart", prov: [{ page_no: 2 }] },
    { self_ref: "#/texts/3", label: "section_header", text: "Policies", level: 2, prov: [{ page_no: 2 }] },
  ],
  tables: [
    { self_ref: "#/tables/0", label: "table", prov: [{ page_no: 2 }],
      data: { num_rows: 2, num_cols: 2, table_cells: [
        { text: "Plan", start_row_offset_idx: 0, end_row_offset_idx: 1, start_col_offset_idx: 0, end_col_offset_idx: 1, column_header: true },
        { text: "Cost", start_row_offset_idx: 0, end_row_offset_idx: 1, start_col_offset_idx: 1, end_col_offset_idx: 2, column_header: true },
        { text: "Standard", start_row_offset_idx: 1, end_row_offset_idx: 2, start_col_offset_idx: 0, end_col_offset_idx: 1 },
        { text: "$0", start_row_offset_idx: 1, end_row_offset_idx: 2, start_col_offset_idx: 1, end_col_offset_idx: 2 },
      ] } },
  ],
  pictures: [
    { self_ref: "#/pictures/0", label: "picture", prov: [{ page_no: 2 }],
      captions: [{ $ref: "#/texts/2" }] },
  ],
  key_value_items: [{ self_ref: "#/key_value_items/0" }],
};
```

## Gunzip

The raw-file route serves `.gz` bytes verbatim — no `Content-Encoding` — so the
decode belongs to the reader. `gunzipToText` takes the fetched `ArrayBuffer`.

```ts
const gz = gzipSync(Buffer.from(JSON.stringify(HANDBOOK)));
const text = await gunzipToText(gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.byteLength));
JSON.parse(text).name
=> source
```

Bytes that aren't gzip reject rather than returning garbage:

```ts
await gunzipToText(new TextEncoder().encode("not gzip at all").buffer).then(
  () => "resolved",
  (e) => `rejected: ${e.name}`,
)
=> rejected: TypeError
```

## Reading order comes from the body tree

Items come back in `body.children` order — text, table, and picture interleaved
as the document actually reads, not grouped by kind.

```ts
const doc = readDoclingDocument(HANDBOOK);
doc.items.map((item) => `${item.kind}:${item.page}`).join(" ")
=> text:1 text:1 table:2 picture:2 text:2
```

`#/texts/2` is the picture's caption. It is reachable through the picture, and
the body tree doesn't list it separately, so it doesn't appear as its own item:

```ts continue
doc.items.filter((item) => item.kind === "picture").map((p) => p.caption).join("")
=> Figure 1 — the org chart
```

The `key_value_items` ref names an array this viewer doesn't render. That is
counted, not hidden — a newer docling release adding a shape must be visible:

```ts continue
doc.unrecognized
=> 1
```

Metadata and the page list read off the document (declared pages plus any page
an item references):

```ts continue
[doc.schemaName, doc.version, doc.originFilename, doc.pageNumbers.join(",")].join(" | ")
=> DoclingDocument | 1.3.0 | handbook-2026.pdf | 1,2
```

## Tables become real rows

Docling records cells with half-open row/column offsets; the reader places each
cell at its start offset and carries spans as `colSpan`/`rowSpan`.

```ts
const table = readDoclingDocument(HANDBOOK).items.find((item) => item.kind === "table");
table.rows.map((row) => row.map((cell) => cell.text).join("|")).join(" / ")
=> Plan|Cost / Standard|$0

table.rows[0].every((cell) => cell.header)
=> true
```

A table docling recorded no cell data for yields no rows — the view says so
rather than drawing an empty grid:

```ts
readDoclingDocument({ tables: [{ label: "table", data: {} }] }).items[0].rows.length
=> 0
```

## Page sections

`itemsByPage` groups the reading order into consecutive runs, which is what the
viewer draws as page sections.

```ts
itemsByPage(readDoclingDocument(HANDBOOK)).map((s) => `${s.page}:${s.items.length}`).join(" ")
=> 1:2 2:3
```

## Nothing throws on an unknown shape

Every one of these is a real possibility: a version we've never seen, a
truncated file, a JSON document that isn't a DoclingDocument at all.

```ts
[
  readDoclingDocument(null).items.length,
  readDoclingDocument(42).items.length,
  readDoclingDocument({ texts: "not an array" }).items.length,
  readDoclingDocument({ body: { children: [{ $ref: "#/texts/99" }] } }).unrecognized,
].join(",")
=> 0,0,0,1
```

A document with no usable `body` tree still renders: the item arrays are read
flat, which loses interleaving but keeps every item.

```ts
const flat = readDoclingDocument({
  texts: [{ label: "paragraph", text: "Only item", prov: [{ page_no: 4 }] }],
});
`${flat.items.length} ${flat.items[0].text} p${flat.pageNumbers.join("")}`
=> 1 Only item p4
```

A cyclic group can't loop the walk:

```ts
readDoclingDocument({
  body: { children: [{ $ref: "#/groups/0" }] },
  groups: [{ children: [{ $ref: "#/groups/0" }, { $ref: "#/texts/0" }] }],
  texts: [{ label: "paragraph", text: "reached", prov: [{ page_no: 1 }] }],
}).items.map((i) => i.text).join("")
=> reached
```

## Parsing

`parseDoclingJson` has exactly one fatal arm — the bytes aren't JSON.

```ts
parseDoclingJson(JSON.stringify(HANDBOOK)).ok
=> true

parseDoclingJson("{ not json").ok
=> false
```

## Which files this reader claims

`bbx pdf extract` writes exactly `docling.json.gz` into the attach scope; a
prefixed form is accepted too, for a box keeping more than one extraction.

```ts
[
  isDoclingPath("inbox/Handbook.attach/docling.json.gz"),
  isDoclingPath("inbox/Handbook.attach/second.docling.json.gz"),
  isDoclingPath("inbox/Handbook.attach/source.pdf"),
  isDoclingPath("inbox/notes.json.gz"),
].join(",")
=> true,true,false,false
```
