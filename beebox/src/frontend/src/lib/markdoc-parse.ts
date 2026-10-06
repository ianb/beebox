/**
 * The frontend's Markdown parse: the shared parser (`@shared/markdoc-config/
 * parse`, which owns raw HTML, comments and footnotes) with bare-URL
 * autolinking on, and in-box link destinations normalized for the resolver.
 *
 * The parser is constructed once (stateless across `parse` calls) and shared
 * by every render.
 */

import type { Node } from "@markdoc/markdoc";
import { createMarkdownParser } from "@shared/markdoc-config/parse/core";
import { normalizeMarkdownLink } from "./view-url";

const parser = createMarkdownParser({ linkify: true });

// In-box link destinations reach the resolver decoded; see normalizeMarkdownLink.
const encodeLink = parser.md.normalizeLink.bind(parser.md);
parser.md.normalizeLink = (url: string): string => normalizeMarkdownLink(url, encodeLink);

/** Parse markdown into a Markdoc AST, autolinking explicit-scheme URLs. */
export function parseMarkdown(source: string): Node {
  return parser.parse(source);
}
