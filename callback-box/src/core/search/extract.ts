/**
 * Card → search-document extraction.
 *
 * Pure module: callers read files and pass content in; nothing here touches
 * the filesystem. The indexer drives it in two phases:
 *
 *   1. `declareInputFiles(card)` — extra files (beyond the `.card` file)
 *      whose content this card's documents are built from. The indexer
 *      watches them in its manifest and passes their content back in.
 *   2. `extractCardDocs(...)` — the card's search documents.
 *
 * Email bodies are deliberately NOT inputs: they live outside the card
 * because the content is untrusted (see src/schemas/email-message.tsx) and
 * indexing them would re-inject untrusted text into agent context via
 * search excerpts. Mail is reached via subject/snippet/participants and the
 * agent-written `contains`.
 */

import type { ElementNode } from "cardworks";
import type { LoadedCard, FrontmatterLoadedCard, XmlLoadedCard } from "../card-io.js";
import { resolveAttachRef } from "../../shared/attach-path.js";
import { titleFromFilename, truncateTitle } from "../file-summary.js";
import { splitMarkdownSections } from "./markdown-sections.js";

/** One Orama document. `fragment` is "" for the card's own document. */
export interface SearchDoc {
  /** `<path>#<fragment>` — unique within the index. */
  id: string;
  path: string;
  fragment: string;
  kind: string;
  title: string;
  contains: string;
  content: string;
  created: string;
  contentHash: string;
}

/** Bodies longer than this split into per-section documents. */
export const SECTION_SPLIT_THRESHOLD = 2000;

/** The `kind` for standalone markdown files (not cards). */
export const MARKDOWN_KIND = "markdown";

const TITLE_MAX = 80;

/**
 * Kinds whose pipeline-maintained summary field doubles as the `contains`
 * fallback (role separation: `description` stays the visual/file summary —
 * alt text etc. — while also satisfying retrieval until an explicit
 * `contains` is written).
 */
const CONTAINS_FALLBACK_FIELD: Record<string, string> = {
  image: "description",
  file: "description",
};

/**
 * The card's effective `contains`: the explicit field, or the per-kind
 * fallback. The single source for the index column, the staleness sidecar,
 * and the missing-contains worklist — a described image is not "missing".
 */
export function effectiveContains(kind: string, fields: Record<string, unknown>): string {
  const explicit = str(fields["contains"]);
  if (explicit !== undefined) return explicit;
  const fallbackField = CONTAINS_FALLBACK_FIELD[kind];
  if (fallbackField === undefined) return "";
  return str(fields[fallbackField]) ?? "";
}

/**
 * Extra files this card's documents are built from (box-relative paths).
 * Currently only gdocs declare one: the markdown content snapshot in the
 * card's attach scope.
 */
export function declareInputFiles(input: { path: string; card: LoadedCard }): string[] {
  const { path, card } = input;
  if (card.kind !== "frontmatter") return [];
  if (card.schema.type !== "gdoc") return [];
  const content = card.fields["content"];
  const ref = isRefObject(content) ? content.ref : undefined;
  if (ref === undefined) return [];
  const resolved = resolveAttachRef(path, ref);
  return resolved === null ? [] : [resolved];
}

export interface ExtractInput {
  /** Box-relative card path. */
  path: string;
  card: LoadedCard;
  /** Hash of the card file content (computed by the indexer). */
  contentHash: string;
  /** Content of each declared input file, keyed by box-relative path. */
  inputContents?: Map<string, string>;
}

/**
 * Extract the search documents for one card: the card document plus
 * per-section documents when the body is long.
 */
export function extractCardDocs(input: ExtractInput): SearchDoc[] {
  const { path, card, contentHash } = input;
  if (card.kind === "xml") return [xmlDoc(path, { card, contentHash })];

  const fields = card.fields;
  const kind = card.schema.type;
  const fold = foldFields(kind, fields);
  const title = truncateTitle(
    firstNonEmpty([str(fields["title"]), fold.title, titleFromFilename(path)])
      .replace(/\s+/g, " ")
      .trim(),
    TITLE_MAX
  );
  const contains = effectiveContains(kind, fields);
  const created = firstNonEmpty([str(fields["created"]), fold.created]);

  const bodyText = bodyTextFor(card, input);
  const base = { path, kind, title, contains, created, contentHash };

  if (bodyText.length <= SECTION_SPLIT_THRESHOLD) {
    const content = joinContent([...fold.extra, bodyText]);
    return [{ ...base, id: docId(path, ""), fragment: "", content }];
  }

  const { preamble, sections } = splitMarkdownSections(bodyText);
  const cardDoc: SearchDoc = {
    ...base,
    id: docId(path, ""),
    fragment: "",
    content: joinContent([...fold.extra, preamble]),
  };
  const sectionDocs = sections.map((s): SearchDoc => ({
    ...base,
    id: docId(path, s.fragment),
    fragment: s.fragment,
    content: normalizeContent(s.text),
  }));
  return dedupeDocIds([cardDoc, ...sectionDocs]);
}

function docId(path: string, fragment: string): string {
  return `${path}#${fragment}`;
}

/**
 * Repeated headings produce identical fragment paths; ids must be unique
 * within the index, so duplicates get a ~N suffix.
 */
function dedupeDocIds(docs: SearchDoc[]): SearchDoc[] {
  const seen = new Map<string, number>();
  return docs.map((d) => {
    const n = seen.get(d.id) ?? 0;
    seen.set(d.id, n + 1);
    if (n === 0) return d;
    const fragment = `${d.fragment}~${String(n + 1)}`;
    return { ...d, fragment, id: docId(d.path, fragment) };
  });
}

/**
 * Extract documents for a standalone markdown file (kind "markdown"):
 * title from the first heading, same section-splitting rules as card
 * bodies, no contains/created.
 */
export function extractMarkdownFileDocs(input: {
  path: string;
  content: string;
  contentHash: string;
}): SearchDoc[] {
  const { path, content, contentHash } = input;
  const heading = content.match(/^#{1,6}\s+(.+)$/m);
  const title = truncateTitle(
    firstNonEmpty([heading?.[1], titleFromFilename(path)]).replace(/\s+/g, " ").trim(),
    TITLE_MAX
  );
  const base = { path, kind: MARKDOWN_KIND, title, contains: "", created: "", contentHash };

  if (content.length <= SECTION_SPLIT_THRESHOLD) {
    return [{ ...base, id: docId(path, ""), fragment: "", content: normalizeContent(content) }];
  }
  const { preamble, sections } = splitMarkdownSections(content);
  return dedupeDocIds([
    { ...base, id: docId(path, ""), fragment: "", content: normalizeContent(preamble) },
    ...sections.map((s): SearchDoc => ({
      ...base,
      id: docId(path, s.fragment),
      fragment: s.fragment,
      content: normalizeContent(s.text),
    })),
  ]);
}

/** The markdown text a card's content documents are built from. */
function bodyTextFor(card: FrontmatterLoadedCard, input: ExtractInput): string {
  if (card.schema.type === "gdoc") {
    const declared = declareInputFiles({ path: input.path, card });
    const first = declared[0];
    if (first === undefined) return "";
    return input.inputContents?.get(first) ?? "";
  }
  const bodyName = card.schema.bodyFieldName;
  if (bodyName === null) return "";
  const body = card.fields[bodyName];
  return typeof body === "string" ? body : "";
}

interface FoldResult {
  title?: string | undefined;
  created?: string | undefined;
  /** Frontmatter text folded into the card document's content. */
  extra: string[];
}

/** Per-kind frontmatter folding into searchable text. */
function foldFields(kind: string, fields: Record<string, unknown>): FoldResult {
  switch (kind) {
    case "email-thread":
      return {
        title: str(fields["subject"]),
        created: str(path2(fields["date-range"], "start")),
        extra: compact([str(fields["subject"]), ...strArray(fields["participants"]), ...strArray(fields["labels"])]),
      };
    case "email-message":
      // The body file is deliberately excluded — see module doc.
      return {
        title: str(fields["subject"]),
        created: str(fields["date"]),
        extra: compact([
          str(fields["subject"]),
          str(fields["from"]),
          str(fields["to"]),
          str(fields["snippet"]),
        ]),
      };
    case "person":
      return {
        title: str(fields["name"]),
        extra: compact([str(fields["name"]), str(fields["role"]), str(fields["contact"])]),
      };
    case "record":
      return {
        title: str(fields["name"]),
        extra: compact([str(fields["name"]), str(fields["description"]), str(fields["notes"])]),
      };
    case "image":
      // text: carries the OCR'd content the analysis step keeps (amounts,
      // account numbers, names) — the needles people search for.
      return {
        title: str(fields["description"]),
        extra: compact([str(fields["description"]), ...textBlockContents(fields["text"])]),
      };
    case "file":
      return { extra: compact([str(fields["description"])]) };
    case "sheet":
      return { extra: tabTitles(fields["sheets"]) };
    case "telegram-message":
      return { extra: compact([str(fields["text"])]) };
    case "memo":
      // Mirrors memoLoader: a memo's display title is its (truncated) text.
      return {
        title: firstNonEmpty([str(fields["body"]), str(path2(fields["transcription"], "text"))]),
        extra: [],
      };
    default:
      return { extra: [] };
  }
}

function xmlDoc(path: string, input: { card: XmlLoadedCard; contentHash: string }): SearchDoc {
  const { card, contentHash } = input;
  const attrs = card.element.attrs;
  const title = truncateTitle(
    firstNonEmpty([str(attrs["title"]), str(attrs["name"]), titleFromFilename(path)]),
    TITLE_MAX
  );
  return {
    id: docId(path, ""),
    path,
    fragment: "",
    kind: card.element.tagName,
    title,
    contains: "",
    content: normalizeContent(collectElementText(card.element)),
    created: "",
    contentHash,
  };
}

/** Collect all text content from an XML element tree (text, mixed, children). */
function collectElementText(node: ElementNode): string {
  const parts: string[] = [];
  const visit = (n: ElementNode): void => {
    if (typeof n.text === "string" && n.text.trim() !== "") parts.push(n.text);
    if (Array.isArray(n.mixed)) {
      for (const m of n.mixed) {
        if (typeof m === "string") parts.push(m);
        else if (isElementNode(m)) visit(m);
      }
    }
    for (const child of n.children) {
      if (isElementNode(child)) visit(child);
    }
  };
  visit(node);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function isElementNode(value: unknown): value is ElementNode {
  return (
    typeof value === "object"
    && value !== null
    && "tagName" in value
    && "children" in value
  );
}

function isRefObject(value: unknown): value is { ref: string } {
  return (
    typeof value === "object"
    && value !== null
    && typeof (value as { ref?: unknown }).ref === "string"
  );
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function strArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.trim() !== "");
}

function path2(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  return (value as Record<string, unknown>)[key];
}

function textBlockContents(text: unknown): string[] {
  if (!Array.isArray(text)) return [];
  const contents: string[] = [];
  for (const block of text) {
    const content = str(path2(block, "content"));
    if (content !== undefined) contents.push(content);
  }
  return contents;
}

function tabTitles(sheets: unknown): string[] {
  if (!Array.isArray(sheets)) return [];
  const titles: string[] = [];
  for (const tab of sheets) {
    const title = str(path2(tab, "title"));
    if (title !== undefined) titles.push(title);
  }
  return titles;
}

function compact(values: Array<string | undefined>): string[] {
  return values.filter((v): v is string => v !== undefined);
}

function firstNonEmpty(values: Array<string | undefined>): string {
  for (const v of values) {
    if (v !== undefined && v.trim() !== "") return v;
  }
  return "";
}

function joinContent(parts: string[]): string {
  return normalizeContent(
    parts
      .map((p) => p.trim())
      .filter((p) => p !== "")
      .join("\n")
  );
}

/**
 * Split unbroken character runs longer than 64 chars. Nobody searches a
 * 64+ char token (they're OCR mash like "ReturnOMB No.1545-00742025Dept..."),
 * and Orama's radix tree nests per character — runs past ~100 chars blow
 * msgpack's depth limit when the index persists.
 */
function normalizeContent(text: string): string {
  return text.trim().replace(/\S{64}/g, "$& ");
}
