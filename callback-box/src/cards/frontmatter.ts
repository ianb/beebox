/**
 * Frontmatter stripping for .card files.
 *
 * Cards may optionally begin with a YAML frontmatter block delimited by
 * `---` fences. This module only locates the body and reports a line
 * offset; YAML parsing lives in `core/card-io.ts`.
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

const FRONTMATTER_BLOCK = /^---\r?\n([\S\s]*?)\r?\n---\r?\n/;

/**
 * Split a .card file's raw text into optional frontmatter and body.
 *
 * Only detects the block; does not parse the YAML inside it.
 */
export function splitCardContent(content: string): SplitCardContent {
  const match = FRONTMATTER_BLOCK.exec(content);
  if (!match) {
    return {
      frontmatterText: "",
      body: content,
      lineOffset: 0,
      hasFrontmatter: false,
    };
  }
  const prefixLength = match[0].length;
  const frontmatterText = match[1] === undefined ? "" : match[1];
  const body = content.slice(prefixLength);
  let lineOffset = 0;
  for (let i = 0; i < prefixLength; i++) {
    if (content.codePointAt(i) === 10) {
      lineOffset++;
    }
  }
  return {
    frontmatterText,
    body,
    lineOffset,
    hasFrontmatter: true,
  };
}
