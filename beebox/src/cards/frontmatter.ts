/**
 * Frontmatter stripping (and composing) for .card files.
 *
 * Cards may optionally begin with a YAML frontmatter block delimited by
 * `---` fences. This module locates the body (`splitCardContent`) and
 * provides a best-effort, validation-free frontmatter read
 * (`parseFrontmatterObject`); the schema-validating YAML parse lives in
 * `core/card-io.ts`.
 *
 *   ---
 *   status: new
 *   ---
 *   markdown body...
 *
 * If no frontmatter is present, the input is returned unchanged with
 * lineOffset 0.
 *
 * (Absorbed from the former `cardworks` package — see
 * docs/implemented-plans/remove-cardworks-package.md.)
 */

import { Document, isMap, parseDocument, stringify as stringifyYaml } from "yaml";
import { parseYaml } from "../lib/read-yaml.js";
import { isRecord } from "../shared/is-record.js";

/**
 * Result of splitting a card's text into frontmatter prefix and body.
 */
export interface SplitCardContent {
  /** Raw frontmatter text (between the fences, no fences). Empty string if no frontmatter. */
  frontmatterText: string;
  /** Body text (everything after the closing fence). Equals input if no frontmatter. */
  body: string;
  /** Number of lines preceding the body in the original input. */
  lineOffset: number;
  /** Whether a well-formed frontmatter block was found. */
  hasFrontmatter: boolean;
}

/**
 * The one frontmatter fence rule, shared by cards, repo docs and issues, and
 * the dev tools that edit them line by line:
 *
 * - an optional byte-order mark, then `---` at column 0;
 * - fence lines may carry trailing spaces or tabs, and end in LF or CRLF;
 * - the closing `---` may end the file;
 * - an empty block (`---` directly followed by `---`) is a block with no text;
 * - `---x` or `----` is not a fence, so it stays inside the block.
 */
const FRONTMATTER_BLOCK = /^\uFEFF?---[\t ]*\r?\n(?:([\S\s]*?)\r?\n)?---[\t ]*(?:\r?\n|$)/;

/**
 * Where a text's frontmatter block sits, as character offsets: the block's
 * text runs from `textStart` to `textEnd` (no fences, no final newline), and
 * the body starts at `bodyStart`. Null when the text has no block. For tools
 * that edit inside the block without reserializing it.
 */
export interface FrontmatterFence {
  textStart: number;
  textEnd: number;
  bodyStart: number;
  /** Index of the closing fence line in `content.split("\n")`; the block's
   *  text lines are 1 up to (not including) it. */
  closingLine: number;
}

export function frontmatterFence(content: string): FrontmatterFence | null {
  const match = FRONTMATTER_BLOCK.exec(content);
  if (!match) return null;
  const opening = /^\uFEFF?---[\t ]*\r?\n/.exec(content);
  const textStart = opening === null ? 0 : opening[0].length;
  const text = match[1] ?? "";
  return {
    textStart,
    textEnd: textStart + text.length,
    bodyStart: match[0].length,
    closingLine: match[1] === undefined ? 1 : 2 + (text.match(/\n/g)?.length ?? 0),
  };
}

/**
 * Split a .card file's raw text into optional frontmatter and body.
 *
 * Only detects the block; does not parse the YAML inside it.
 */
export function splitCardContent(content: string): SplitCardContent {
  const fence = frontmatterFence(content);
  if (fence === null) {
    return {
      frontmatterText: "",
      body: content,
      lineOffset: 0,
      hasFrontmatter: false,
    };
  }
  let lineOffset = 0;
  for (let i = 0; i < fence.bodyStart; i++) {
    if (content.codePointAt(i) === 10) {
      lineOffset++;
    }
  }
  return {
    frontmatterText: content.slice(fence.textStart, fence.textEnd),
    body: content.slice(fence.bodyStart),
    lineOffset,
    hasFrontmatter: true,
  };
}

/**
 * Parse a card's frontmatter block into a plain mapping, best-effort.
 *
 * Returns `null` when there is no frontmatter block, the YAML is unparseable,
 * or the frontmatter is not a mapping (an array, a scalar, or an empty/`null`
 * block). This is the shared primitive behind the connectors' ad-hoc
 * "peek at a card's fields without the schema machinery" reads — a loose,
 * validation-free view. Callers that need validated, typed fields use
 * `parseCardText`/`loadCardFile` (`core/card-io.ts`) instead; callers that
 * want empty frontmatter to read as `{}` rather than `null` use
 * `readCardFrontmatter` (`core/card-io.ts`).
 */
export function parseFrontmatterObject(content: string): Record<string, unknown> | null {
  const split = splitCardContent(content);
  if (!split.hasFrontmatter) return null;
  let parsed: unknown;
  try {
    parsed = parseYaml(split.frontmatterText);
  } catch (_e) {
    // Malformed YAML in a hand-editable card: treat as "no readable
    // frontmatter" so scans skip the card rather than crashing.
    return null;
  }
  if (!isRecord(parsed)) return null;
  return parsed;
}

/**
 * Render a frontmatter block (plus optional body) as `.card` file text —
 * the inverse of `splitCardContent`. `lineWidth: 0` disables yaml's default
 * ~80-column scalar wrapping: frontmatter/YAML output must never fold a long
 * line, since folded scalars change the on-disk representation (and diff)
 * of a value without changing its meaning.
 */
export function renderFrontmatterBlock(fields: object, body?: string): string {
  return `---\n${stringifyYaml(fields, { lineWidth: 0 })}---\n${body ?? ""}`;
}

/**
 * A frontmatter block as an editable YAML document, or null when it does not
 * parse or is not a mapping. An empty block is an empty mapping. Editing the
 * document keeps untouched keys' comments and quoting.
 */
export function editableFrontmatterDocument(frontmatterText: string): Document | null {
  const document = frontmatterText.trim() === "" ? new Document({}) : parseDocument(frontmatterText);
  return document.errors.length > 0 || !isMap(document.contents) ? null : document;
}

/**
 * Card text from an edited frontmatter document and an unchanged body, with
 * long values on one line like {@link renderFrontmatterBlock}.
 */
export function renderFrontmatterDocument(document: Document, body: string): string {
  const yaml = document.toString({ lineWidth: 0 });
  return `---\n${yaml.endsWith("\n") ? yaml : `${yaml}\n`}---\n${body}`;
}

