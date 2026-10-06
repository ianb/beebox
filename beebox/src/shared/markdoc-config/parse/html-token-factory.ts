/**
 * Token construction shared by the raw-HTML rewrite passes
 * (`html-inline.ts`, `html-tokens.ts`): markdown-it tokens built with the
 * tokenizer's own `Token` class, the Markdoc `html` tag token, literal text,
 * and URL validation that matches markdown-it's handling of link destinations.
 */

import type MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.js";
import { warning, type HtmlWarning } from "./html-lex.js";

/** The Markdoc tag name every rebuilt element uses (see `core.ts`'s `html` schema). */
export const HTML_TAG = "html";

/** Markdoc reads `errors` off a token into the node's validation errors; markdown-it's type lacks it. */
export interface MarkdocToken extends Token {
  errors?: HtmlWarning[];
}

/** Turn an emitted open token back into the literal text of its tag. */
export function literalize(token: MarkdocToken, src: string): void {
  token.type = "text";
  token.nesting = 0;
  token.content = src;
  token.attrs = null;
  token.meta = null;
  delete token.errors;
}

/** An element open in the current pass: its name, the Markdown depth it opened at, and what closes it. */
export interface OpenElement {
  name: string;
  depth: number;
  close: () => Token;
  /** Inline only: the open token and its source, turned back into text if no close tag comes. */
  open?: { token: Token; src: string };
}

export class TokenFactory {
  protected readonly md: MarkdownIt;

  constructor(md: MarkdownIt) {
    this.md = md;
  }

  protected token(type: string, { nesting, map }: { nesting: Token.Nesting; map?: [number, number] | null }): Token {
    const t = new this.md.core.State.prototype.Token(type, "", nesting);
    t.map = map ?? null;
    return t;
  }

  protected htmlTag(
    element: string,
    { nesting, attributes, map }: { nesting: Token.Nesting; attributes: Record<string, string | true>; map: [number, number] | null },
  ): Token {
    const type = nesting === 1 ? "tag_open" : nesting === -1 ? "tag_close" : "tag";
    const t = this.token(type, { nesting, map });
    t.meta = {
      tag: HTML_TAG,
      attributes:
        nesting === -1
          ? []
          : [
              { type: "attribute", name: "element", value: element },
              ...Object.entries(attributes).map(([name, value]) => ({ type: "attribute", name, value })),
            ],
    };
    return t;
  }

  /** A text token showing `src` verbatim, optionally with a validation warning. */
  protected literal(src: string, message?: string): Token {
    const t: MarkdocToken = this.token("text", { nesting: 0 });
    t.content = src;
    if (message !== undefined) t.errors = [warning(message)];
    return t;
  }

  /** Normalize and validate a URL attribute the way markdown-it treats a link destination. */
  protected url(value: string | true | undefined): string | null {
    if (typeof value !== "string" || value.trim() === "") return null;
    const href = this.md.normalizeLink(value.trim());
    return this.md.validateLink(href) ? href : null;
  }
}
