/**
 * Reading the canonical extraction a pdf card keeps at `attach/docling.json.gz`
 * (`src/schemas/pdf.ts`).
 *
 * Until now the repo treated that file as opaque cargo — it was written by
 * `bbx pdf extract` and never read back. Two consumers need it: the docling
 * viewer (`components/DoclingView.tsx`) and the text↔page mapping in
 * `components/PdfCardView.tsx`. Both go through here; the block→page matcher
 * itself lives next door in `docling-match.ts`.
 *
 * **The schema is not ours.** `DoclingDocument` is an upstream, versioned
 * Python model; a box can hold JSON written by any release we ever pinned.
 * So every function here narrows defensively and *never throws on shape*: an
 * item we don't recognize is counted, not fatal, and a document missing a field
 * renders with that field absent. `parseDoclingJson` returns a result arm for
 * the one genuinely fatal case (the bytes aren't JSON at all).
 *
 * Everything is pure over `ArrayBuffer`/`string`, so it is unit-testable in
 * plain Node — `DecompressionStream` is available there too. No React, no
 * Markdoc, no bundler-only imports (see `test/frontend/lib/docling.doctest.md`).
 */

import { isRecord } from "@shared/is-record";
import { readTableRows } from "./docling-table";

/**
 * Cap on the decompressed JSON we will hold in memory. A DoclingDocument for a
 * scanner-sized document is a few megabytes; anything past this is a bug or a
 * hostile file, and refusing it beats wedging the tab.
 */
const MAX_DECOMPRESSED_BYTES = 64 * 1024 * 1024;

/** The runtime has no `DecompressionStream`; the caller offers a download instead. */
class DecompressionUnsupportedError extends Error {
  constructor() {
    super("This browser cannot decompress .gz files in the page");
    this.name = "DecompressionUnsupportedError";
  }
}

/** The decompressed file went past {@link MAX_DECOMPRESSED_BYTES}. */
class DecompressedTooLargeError extends Error {
  constructor() {
    super("The decompressed file is too large to display");
    this.name = "DecompressedTooLargeError";
  }
}

/**
 * Is this path a gzipped DoclingDocument?
 *
 * `bbx pdf extract` writes exactly `docling.json.gz` into a card's attach scope
 * (`core/commands/pdf-extract.ts`), so that basename is the case that matters.
 * The `*.docling.json.gz` form is accepted too, for a box that keeps more than
 * one extraction beside a document.
 */
export function isDoclingPath(path: string): boolean {
  const basename = path.split("/").pop() ?? path;
  return basename === "docling.json.gz" || basename.endsWith(".docling.json.gz");
}

/** One cell of a reconstructed docling table. */
export interface DoclingTableCell {
  text: string;
  colSpan: number;
  rowSpan: number;
  /** True for a cell docling marked as a column or row header. */
  header: boolean;
}

/** A text item — a heading, a paragraph, a list item, a caption. */
export interface DoclingTextItem {
  kind: "text";
  /** Docling's own `self_ref` (`#/texts/3`). */
  ref: string;
  /** Docling's label: `section_header`, `paragraph`, `list_item`, `caption`, … */
  label: string;
  text: string;
  /** 1-based page from `prov[0].page_no`, or null when the item carries no provenance. */
  page: number | null;
  /** Heading level for `section_header` items, else null. */
  level: number | null;
}

/** A table item, reconstructed into rows of cells when the cell data is present. */
export interface DoclingTableItem {
  kind: "table";
  ref: string;
  label: string;
  page: number | null;
  caption: string | null;
  /** Empty when the cell data was missing or unreadable — the view says so. */
  rows: DoclingTableCell[][];
}

/** A picture item. `index` is its position in the document's `pictures` array. */
export interface DoclingPictureItem {
  kind: "picture";
  ref: string;
  label: string;
  page: number | null;
  caption: string | null;
  /**
   * 0-based position in `pictures[]`. `bbx pdf extract` writes figures as
   * `figure-001.avif`, `figure-002.avif`, … in exactly that order (it sorts
   * Docling's `image_NNNNNN_*.png` artifacts by their embedded index), so
   * `figure-{index+1}` names this picture's render. That is a convention, not
   * a recorded link — callers must only use it when the file actually exists.
   */
  index: number;
}

export type DoclingItem = DoclingTextItem | DoclingTableItem | DoclingPictureItem;

/** What the viewer needs out of a DoclingDocument, with the unknown counted. */
export interface DoclingDocumentSummary {
  schemaName: string | null;
  version: string | null;
  name: string | null;
  originFilename: string | null;
  originMimetype: string | null;
  /** Page numbers the document declares (or that its items reference), ascending. */
  pageNumbers: number[];
  /** Items in reading order (`body.children` order when that tree is present). */
  items: DoclingItem[];
  /**
   * Body-tree entries we could not turn into an item: a `$ref` into an array we
   * don't render (`key_value_items`, `form_items`), a dangling ref, a shape a
   * newer docling release introduced. Surfaced in the viewer rather than hidden.
   */
  unrecognized: number;
}

/* ---------- gunzip ---------- */

/** True where the browser/runtime can gunzip in-process (everything but old Safari). */
export function decompressionSupported(): boolean {
  return typeof DecompressionStream !== "undefined";
}

/**
 * Gunzip a fetched `.gz` body to text. The raw-file route serves these bytes
 * verbatim — no `Content-Encoding: gzip` — so the browser hands us the
 * compressed bytes and the decode is ours to do.
 *
 * Rejects when the runtime has no `DecompressionStream`, when the bytes are
 * not gzip, or when the text would exceed {@link MAX_DECOMPRESSED_BYTES}.
 */
export async function gunzipToText(bytes: ArrayBuffer): Promise<string> {
  if (!decompressionSupported()) throw new DecompressionUnsupportedError();
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_DECOMPRESSED_BYTES) {
      await reader.cancel();
      throw new DecompressedTooLargeError();
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return text;
}

/* ---------- narrowing helpers ---------- */

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function int(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** First `prov[].page_no`, which is the page an item is printed on. */
function provPage(item: Record<string, unknown>): number | null {
  const first = array(item["prov"]).at(0);
  return isRecord(first) ? int(first["page_no"]) : null;
}

/** Resolve `{ "$ref": "#/texts/3" }` into `{ array: "texts", index: 3 }`. */
function parseRef(value: unknown): { array: string; index: number } | null {
  const raw = isRecord(value) ? str(value["$ref"]) : str(value);
  if (raw === null) return null;
  const match = /^#\/([A-Za-z_]+)\/(\d+)$/u.exec(raw);
  if (match === null) return null;
  const name = match[1];
  const index = Number(match[2]);
  if (name === undefined || !Number.isInteger(index)) return null;
  return { array: name, index };
}

/* ---------- reading order ---------- */

/** Bounds a group chain's nesting depth — see {@link DocumentReader.children}. */
const MAX_BODY_DEPTH = 64;
/** Bounds total items+unrecognized emitted — see {@link DocumentReader.overBudget}. */
const MAX_EMITTED_ITEMS = 10_000;

/**
 * Walks a document's `body.children` tree, resolving each `$ref` into an item.
 * State (the arrays, the visited set, the count of what didn't resolve) lives
 * on the instance so the recursion stays two-argument and readable.
 */
class DocumentReader {
  readonly items: DoclingItem[] = [];
  /** `$ref`s that named nothing we render — reported, never silently dropped. */
  unrecognized = 0;
  private readonly seen = new Set<string>();
  private readonly texts: unknown[];
  private readonly tables: unknown[];
  private readonly pictures: unknown[];
  private readonly groups: unknown[];

  constructor(doc: Record<string, unknown>) {
    this.texts = array(doc["texts"]);
    this.tables = array(doc["tables"]);
    this.pictures = array(doc["pictures"]);
    this.groups = array(doc["groups"]);
  }

  /** True when the document's item arrays hold anything to fall back to. */
  get hasSourceItems(): boolean {
    return this.texts.length + this.tables.length + this.pictures.length > 0;
  }

  /** Resolve a caption ref list (`captions: [{$ref: "#/texts/5"}]`) to its text. */
  caption(refs: unknown): string | null {
    for (const entry of array(refs)) {
      const ref = parseRef(entry);
      if (ref === null || ref.array !== "texts") continue;
      const target = this.texts[ref.index];
      if (!isRecord(target)) continue;
      const text = str(target["text"]);
      if (text !== null) return text;
    }
    return null;
  }

  text(raw: Record<string, unknown>, ref: string): DoclingTextItem | null {
    const text = str(raw["text"]) ?? str(raw["orig"]);
    if (text === null) return null;
    return {
      kind: "text",
      ref,
      label: str(raw["label"]) ?? "text",
      text,
      page: provPage(raw),
      level: int(raw["level"]),
    };
  }

  table(raw: Record<string, unknown>, ref: string): DoclingTableItem {
    const rows = readTableRows(raw["data"]);
    if (rows === "too-large") this.unrecognized += 1;
    return {
      kind: "table",
      ref,
      label: str(raw["label"]) ?? "table",
      page: provPage(raw),
      caption: this.caption(raw["captions"]),
      rows: rows === "too-large" ? [] : rows,
    };
  }

  picture(raw: Record<string, unknown>, index: number): DoclingPictureItem {
    return {
      kind: "picture",
      ref: `#/pictures/${String(index)}`,
      label: str(raw["label"]) ?? "picture",
      page: provPage(raw),
      caption: this.caption(raw["captions"]),
      index,
    };
  }

  /** Read one `$ref`, recursing through `groups` (a list, an inline run, …). */
  ref(entry: unknown, depth: number): void {
    const parsed = parseRef(entry);
    if (parsed === null) { this.unrecognized += 1; return; }
    const key = `${parsed.array}/${String(parsed.index)}`;
    // A repeated or cyclic ref is read once; without this a malformed tree loops.
    if (this.seen.has(key)) return;
    this.seen.add(key);

    if (parsed.array === "groups") {
      const group = this.groups[parsed.index];
      if (isRecord(group)) this.children(group["children"], depth + 1);
      else this.unrecognized += 1;
      return;
    }
    const source =
      parsed.array === "texts" ? this.texts
        : parsed.array === "tables" ? this.tables
          : parsed.array === "pictures" ? this.pictures
            : null;
    const raw = source === null ? undefined : source[parsed.index];
    if (!isRecord(raw)) { this.unrecognized += 1; return; }

    if (parsed.array === "texts") {
      const item = this.text(raw, `#/${key}`);
      if (item === null) this.unrecognized += 1;
      else this.items.push(item);
      return;
    }
    this.items.push(
      parsed.array === "tables" ? this.table(raw, `#/${key}`) : this.picture(raw, parsed.index),
    );
  }

  /**
   * Depth past {@link MAX_BODY_DEPTH} stops recursing (an acyclic deep chain
   * isn't caught by {@link ref}'s cycle guard); width past {@link
   * MAX_EMITTED_ITEMS} stops the loop — both fold into `unrecognized` once.
   */
  children(value: unknown, depth?: number): void {
    if ((depth ?? 0) > MAX_BODY_DEPTH) { this.unrecognized += 1; return; }
    for (const child of array(value)) {
      if (this.items.length + this.unrecognized >= MAX_EMITTED_ITEMS) { this.unrecognized += 1; return; }
      this.ref(child, depth ?? 0);
    }
  }

  /**
   * Fallback for a document with no usable `body.children` tree: take the three
   * item arrays as they stand. Their own order is document order within each
   * kind, so this loses interleaving but keeps every item.
   */
  flat(): void {
    for (const [index, raw] of this.texts.entries()) {
      const item = isRecord(raw) ? this.text(raw, `#/texts/${String(index)}`) : null;
      if (item === null) this.unrecognized += 1;
      else this.items.push(item);
    }
    for (const [index, raw] of this.tables.entries()) {
      if (isRecord(raw)) this.items.push(this.table(raw, `#/tables/${String(index)}`));
      else this.unrecognized += 1;
    }
    for (const [index, raw] of this.pictures.entries()) {
      if (isRecord(raw)) this.items.push(this.picture(raw, index));
      else this.unrecognized += 1;
    }
  }
}

/**
 * Narrow an already-parsed JSON value into a {@link DoclingDocumentSummary}.
 * Total: any input, including `null` or a number, yields an empty summary
 * rather than an exception.
 */
export function readDoclingDocument(value: unknown): DoclingDocumentSummary {
  const doc = isRecord(value) ? value : {};
  const origin = isRecord(doc["origin"]) ? doc["origin"] : {};
  const body = isRecord(doc["body"]) ? doc["body"] : {};

  const reader = new DocumentReader(doc);
  reader.children(body["children"]);
  // A document whose body tree yielded nothing, but which has items in its
  // arrays, is either an older shape or one we mis-walked; read them flat
  // rather than render a blank page. With no items to fall back to, the walk's
  // own count of what didn't resolve is the honest answer.
  if (reader.items.length === 0 && reader.hasSourceItems) {
    reader.unrecognized = 0;
    reader.flat();
  }

  const declared = isRecord(doc["pages"])
    ? Object.keys(doc["pages"]).flatMap((key) => {
      const n = Number(key);
      return Number.isInteger(n) && n > 0 ? [n] : [];
    })
    : [];
  const referenced = reader.items.flatMap((item) => (item.page === null ? [] : [item.page]));

  return {
    schemaName: str(doc["schema_name"]),
    version: str(doc["version"]),
    name: str(doc["name"]),
    originFilename: str(origin["filename"]),
    originMimetype: str(origin["mimetype"]),
    pageNumbers: [...new Set([...declared, ...referenced])].toSorted((a, b) => a - b),
    items: reader.items,
    unrecognized: reader.unrecognized,
  };
}

/** Parse the decompressed JSON text. The only fatal arm is "not JSON at all". */
export function parseDoclingJson(
  text: string,
): { ok: true; document: DoclingDocumentSummary } | { ok: false; error: string } {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "not valid JSON" };
  }
  return { ok: true, document: readDoclingDocument(value) };
}

/** Items grouped into page sections, in reading order. `page: null` collects the unplaced. */
export function itemsByPage(
  document: DoclingDocumentSummary,
): Array<{ page: number | null; items: DoclingItem[] }> {
  const sections: Array<{ page: number | null; items: DoclingItem[] }> = [];
  for (const item of document.items) {
    const last = sections.at(-1);
    if (last !== undefined && last.page === item.page) last.items.push(item);
    else sections.push({ page: item.page, items: [item] });
  }
  return sections;
}
