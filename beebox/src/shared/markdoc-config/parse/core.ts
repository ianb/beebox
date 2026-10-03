/**
 * The one way to parse a box Markdown body into a Markdoc AST.
 *
 * Every consumer — the React renderer, the publish renderer, and the backend
 * walkers (body refs, lint, todo extraction, the briefing emitter) — parses
 * through here, so they agree on what a body contains. On top of Markdoc's
 * defaults this turns on:
 *
 *  - raw HTML, rebuilt through the allow-list (`html-tokens.ts`);
 *  - HTML comments, which render as nothing;
 *  - GFM footnotes (`footnote-tokens.ts`);
 *  - optionally, bare-URL autolinking for explicit-scheme URLs only. Fuzzy
 *    links are off: in a Markdown-centric box, `README.md` would otherwise
 *    become a link (`.md` is a TLD), and `i.e.`-style prose could misfire.
 *    The publish renderer leaves autolinking off so a bundle gains no
 *    external references it did not ask for.
 */

import Markdoc from "@markdoc/markdoc";
import type { Node } from "@markdoc/markdoc";
import type MarkdownIt from "markdown-it";
import footnote from "markdown-it-footnote";
import { rewriteHtmlTokens } from "./html-tokens.js";
import { rewriteFootnoteTokens } from "./footnote-tokens.js";

// Named value imports don't resolve from this CommonJS module under Node's
// ESM loader; destructure off the default import (same as `core.ts`).
// eslint-disable-next-line import-x/no-named-as-default-member -- named import fails under Node ESM; default-member access is the runtime-correct form for this CJS module
const { Tokenizer, parse } = Markdoc;

/** A configured parser and the markdown-it instance behind it (for callers that tune link normalization). */
export interface MarkdownParser {
  parse: (source: string) => Node;
  md: MarkdownIt;
}

/**
 * Structural view of `Tokenizer.parser`, which is `private`: Markdoc exposes
 * no public way to reach the markdown-it instance, and plugins, linkify
 * options and the token rewrites all need it. Cast once here.
 */
interface ExposedTokenizer {
  parser: MarkdownIt;
}

export function createMarkdownParser({ linkify }: { linkify: boolean }): MarkdownParser {
  const tokenizer = new Tokenizer({ html: true, allowComments: true, linkify });
  // eslint-disable-next-line no-restricted-syntax -- Tokenizer.parser is private and no public Markdoc API exposes the markdown-it instance; centralized one-time cast (see interface docstring above).
  const md = (tokenizer as unknown as ExposedTokenizer).parser;
  md.linkify.set({ fuzzyLink: false, fuzzyEmail: false, fuzzyIP: false });
  md.use(footnote);
  return {
    md,
    parse: (source) => parse(rewriteFootnoteTokens(rewriteHtmlTokens(tokenizer.tokenize(source), md))),
  };
}

const plain = createMarkdownParser({ linkify: false });

/** Parse a Markdown body without bare-URL autolinking (backend walkers, publishing). */
export function parseMarkdown(source: string): Node {
  return plain.parse(source);
}
