// # Docling — reading the canonical extraction
//
// A pdf card keeps Docling's own `DoclingDocument` beside the original, gzipped, at
// `attach/docling.json.gz` (`src/schemas/pdf.ts`). `src/frontend/src/lib/docling.ts`
// is the only thing in the repo that reads it back.
//
// The schema is upstream and versioned, so the reader's contract is: **never throw
// on shape**. It renders what it recognizes and counts what it doesn't.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any } from "@ianbicking/tap-check/check";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import {
  gunzipToText,
  isDoclingPath,
  itemsByPage,
  parseDoclingJson,
  readDoclingDocument,
} from "../../../src/lib/docling/parse.js";
import type { DoclingItem } from "../../../src/lib/docling/parse.js";

/** The item as a table; fails the example when it is anything else. */
function tableOf(item: DoclingItem | undefined) {
  assert.ok(item?.kind === "table", "expected a table item");
  return item;
}

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

// ## Gunzip
//
// The raw-file route serves `.gz` bytes verbatim — no `Content-Encoding` — so the
// decode belongs to the reader. `gunzipToText` takes the fetched `ArrayBuffer`.
void test("The raw-file route serves .gz bytes verbatim — no Content-Encoding — so the d...", async (t) => {
  // doctest:L82
  const gz = gzipSync(Buffer.from(JSON.stringify(HANDBOOK)));
  const text = await gunzipToText(gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.byteLength));
  t.check(JSON.parse(text), HANDBOOK);
});

// Bytes that aren't gzip reject rather than returning garbage:
void test("Bytes that aren't gzip reject rather than returning garbage:", async (t) => {
  await t.checkThrows(() => gunzipToText(new TextEncoder().encode("not gzip at all").buffer), "TypeError");
});

// ## Reading order comes from the body tree
//
// Items come back in `body.children` order — text, table, and picture interleaved
// as the document actually reads, not grouped by kind.
void test("Items come back in body.children order — text, table, and picture interleaved...", async (t) => {
  // `#/texts/2` is the picture's caption. It is reachable through the picture, and
  // the body tree doesn't list it separately, so it doesn't appear as its own item.
  // The `key_value_items` ref names an array this viewer doesn't render. That is
  // counted in `unrecognized`, not hidden — a newer docling release adding a shape
  // must be visible. The page list is the declared pages plus any page an item
  // references.
  t.check(readDoclingDocument(HANDBOOK), {
    schemaName: "DoclingDocument",
    version: "1.3.0",
    name: "source",
    originFilename: "handbook-2026.pdf",
    originMimetype: "application/pdf",
    pageNumbers: [1, 2],
    items: [
      { kind: "text", ref: "#/texts/0", label: "title", text: "Employee Handbook 2026", page: 1, level: 1 },
      { kind: "text", ref: "#/texts/1", label: "paragraph", text: "Onboarding starts on your first Monday.", page: 1, level: null },
      {
        kind: "table",
        ref: "#/tables/0",
        label: "table",
        page: 2,
        caption: null,
        rows: [
          [
            { text: "Plan", rowSpan: 1, colSpan: 1, header: true },
            { text: "Cost", rowSpan: 1, colSpan: 1, header: true },
          ],
          [
            { text: "Standard", rowSpan: 1, colSpan: 1, header: false },
            { text: "$0", rowSpan: 1, colSpan: 1, header: false },
          ],
        ],
      },
      { kind: "picture", ref: "#/pictures/0", label: "picture", page: 2, caption: "Figure 1 — the org chart", index: 0 },
      { kind: "text", ref: "#/texts/3", label: "section_header", text: "Policies", page: 2, level: 2 },
    ],
    unrecognized: 1,
  });
});

// ## Tables become real rows
//
// Docling records cells with half-open row/column offsets; the reader places each
// cell at its start offset and carries spans as `colSpan`/`rowSpan`.
void test("Docling records cells with half-open row/column offsets; the reader places ea...", async (t) => {
  // doctest:L139
  const table = tableOf(readDoclingDocument(HANDBOOK).items.find((item) => item.kind === "table"));
  t.check(table.rows, [
    [
      { text: "Plan", rowSpan: 1, colSpan: 1, header: true },
      { text: "Cost", rowSpan: 1, colSpan: 1, header: true },
    ],
    [
      { text: "Standard", rowSpan: 1, colSpan: 1, header: false },
      { text: "$0", rowSpan: 1, colSpan: 1, header: false },
    ],
  ]);
});

// A table docling recorded no cell data for yields no rows — the view says so
// rather than drawing an empty grid:
void test("A table docling recorded no cell data for yields no rows — the view says so r...", async (t) => {
  // doctest:L151
  t.check(readDoclingDocument({ tables: [{ label: "table", data: {} }] }).items, [
    { kind: "table", ref: "#/tables/0", label: "table", page: null, caption: null, rows: [] },
  ]);
});

// ## Page sections
//
// `itemsByPage` groups the reading order into consecutive runs, which is what the
// viewer draws as page sections.
void test("itemsByPage groups the reading order into consecutive runs, which is what the...", async (t) => {
  // doctest:L161
  t.check(itemsByPage(readDoclingDocument(HANDBOOK)).map((section) => ({ page: section.page, refs: section.items.map((item) => item.ref) })), [
    { page: 1, refs: ["#/texts/0", "#/texts/1"] },
    { page: 2, refs: ["#/tables/0", "#/pictures/0", "#/texts/3"] },
  ]);
});

// ## Nothing throws on an unknown shape
//
// Every one of these is a real possibility: a version we've never seen, a
// truncated file, a JSON document that isn't a DoclingDocument at all.
void test("Every one of these is a real possibility:", async (t) => {
  // doctest:L171
  t.check([
    readDoclingDocument(null),
    readDoclingDocument(42),
    readDoclingDocument({ texts: "not an array" }),
    readDoclingDocument({ body: { children: [{ $ref: "#/texts/99" }] } }),
  ], [
    { schemaName: null, version: null, name: null, originFilename: null, originMimetype: null, pageNumbers: [], items: [], unrecognized: 0 },
    { schemaName: null, version: null, name: null, originFilename: null, originMimetype: null, pageNumbers: [], items: [], unrecognized: 0 },
    { schemaName: null, version: null, name: null, originFilename: null, originMimetype: null, pageNumbers: [], items: [], unrecognized: 0 },
    { schemaName: null, version: null, name: null, originFilename: null, originMimetype: null, pageNumbers: [], items: [], unrecognized: 1 },
  ]);
});

// A document with no usable `body` tree still renders: the item arrays are read
// flat, which loses interleaving but keeps every item.
void test("A document with no usable body tree still renders:", async (t) => {
  // doctest:L184
  const flat = readDoclingDocument({
    texts: [{ label: "paragraph", text: "Only item", prov: [{ page_no: 4 }] }],
  });
  t.check(flat, {
    schemaName: null,
    version: null,
    name: null,
    originFilename: null,
    originMimetype: null,
    pageNumbers: [4],
    items: [{ kind: "text", ref: "#/texts/0", label: "paragraph", text: "Only item", page: 4, level: null }],
    unrecognized: 0,
  });
});

// A cyclic group can't loop the walk:
void test("A cyclic group can't loop the walk:", async (t) => {
  // doctest:L194
  t.check(readDoclingDocument({
    body: { children: [{ $ref: "#/groups/0" }] },
    groups: [{ children: [{ $ref: "#/groups/0" }, { $ref: "#/texts/0" }] }],
    texts: [{ label: "paragraph", text: "reached", prov: [{ page_no: 1 }] }],
  }).items, [{ kind: "text", ref: "#/texts/0", label: "paragraph", text: "reached", page: 1, level: null }]);
});

// ## Parsing
//
// `parseDoclingJson` has exactly one fatal arm — the bytes aren't JSON.
void test("parseDoclingJson has exactly one fatal arm — the bytes aren't JSON.", async (t) => {
  // doctest:L207
  t.check(parseDoclingJson(JSON.stringify(HANDBOOK)), { ok: true, document: readDoclingDocument(HANDBOOK) });

  // doctest:L210
  t.check(parseDoclingJson("{ not json"), { ok: false, error: any(String) });
});

// ## Which files this reader claims
//
// `bbx pdf extract` writes exactly `docling.json.gz` into the attach scope; a
// prefixed form is accepted too, for a box keeping more than one extraction.
void test("bbx pdf extract writes exactly docling.json.gz into the attach scope; a prefi...", async (t) => {
  // doctest:L220
  t.check(
    [
      "inbox/Handbook.attach/docling.json.gz",
      "inbox/Handbook.attach/second.docling.json.gz",
      "inbox/Handbook.attach/source.pdf",
      "inbox/notes.json.gz",
    ].map((path) => isDoclingPath(path)),
    [true, true, false, false],
  );
});
