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
import { resolveAttachRef } from "../../lib/attach-path.js";
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

const TITLE_MAX = 80;

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
  const contains = firstNonEmpty([str(fields["contains"]), fold.contains]);
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
    content: s.text,
  }));
  return [cardDoc, ...sectionDocs];
}

function docId(path: string, fragment: string): string {
  return `${path}#${fragment}`;
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
  contains?: string | undefined;
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
    case "image":
      return {
        title: str(fields["description"]),
        contains: str(fields["description"]),
        extra: compact([str(fields["description"])]),
      };
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
    content: collectElementText(card.element),
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
  return parts
    .map((p) => p.trim())
    .filter((p) => p !== "")
    .join("\n")
    .trim();
}
