/**
 * Markdoc parse with bare-URL auto-linking.
 *
 * Markdoc's tokenizer leaves markdown-it's `linkify` rule off, so a literal
 * `https://…` URL written in a card/view/chat body renders as plain text. We
 * turn it on — but only for URLs with an explicit scheme: `fuzzyLink` is
 * disabled so schemeless domains do NOT autolink. That matters in a
 * Markdown-centric box, where bare file refs like `README.md` would otherwise
 * become links (`.md` is a valid TLD) and `i.e.`-style prose could misfire.
 *
 * The tokenizer is constructed once (stateless across `tokenize` calls) and
 * shared by every render.
 */

import { Tokenizer, parse, type Node } from "@markdoc/markdoc";

/**
 * Structural view of the bit of markdown-it we must reach: `Tokenizer.parser`
 * is `private`, but suppressing schemeless autolinks is only configurable on
 * its linkify-it instance, which no public Markdoc API exposes. Cast once here.
 */
interface LinkifyConfigurableTokenizer {
  parser: {
    linkify: { set: (opts: { fuzzyLink: boolean; fuzzyEmail: boolean; fuzzyIP: boolean }) => unknown };
  };
}

const tokenizer = new Tokenizer({ linkify: true });
// eslint-disable-next-line no-restricted-syntax -- Tokenizer.parser is private and no public Markdoc API exposes the linkify-it instance; centralized one-time cast (see interface docstring above).
(tokenizer as unknown as LinkifyConfigurableTokenizer).parser.linkify.set({
  fuzzyLink: false,
  fuzzyEmail: false,
  fuzzyIP: false,
});

/** Parse markdown into a Markdoc AST, autolinking explicit-scheme URLs. */
export function parseMarkdown(source: string): Node {
  return parse(tokenizer.tokenize(source));
}
