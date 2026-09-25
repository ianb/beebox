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
import { normalizeMarkdownLink } from "./view-url";

/**
 * Structural view of the bits of markdown-it we must reach: `Tokenizer.parser`
 * is `private`, but suppressing schemeless autolinks is only configurable on
 * its linkify-it instance, and link normalization on the markdown-it instance
 * itself; no public Markdoc API exposes either. Cast once here.
 */
interface ConfigurableTokenizer {
  parser: {
    linkify: { set: (opts: { fuzzyLink: boolean; fuzzyEmail: boolean; fuzzyIP: boolean }) => unknown };
    normalizeLink: (url: string) => string;
  };
}

const tokenizer = new Tokenizer({ linkify: true });
// eslint-disable-next-line no-restricted-syntax -- Tokenizer.parser is private and no public Markdoc API exposes the markdown-it instance; centralized one-time cast (see interface docstring above).
const { parser } = tokenizer as unknown as ConfigurableTokenizer;
parser.linkify.set({
  fuzzyLink: false,
  fuzzyEmail: false,
  fuzzyIP: false,
});

// In-box link destinations reach the resolver decoded; see normalizeMarkdownLink.
const encodeLink = parser.normalizeLink.bind(parser);
parser.normalizeLink = (url: string): string => normalizeMarkdownLink(url, encodeLink);

/** Parse markdown into a Markdoc AST, autolinking explicit-scheme URLs. */
export function parseMarkdown(source: string): Node {
  return parse(tokenizer.tokenize(source));
}
