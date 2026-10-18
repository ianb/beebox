// # Markdown footnotes
//
// Bodies support GFM footnotes: a `[^label]` reference and a `[^label]: text`
// definition anywhere in the body. Footnotes are numbered in order of first
// reference and listed at the end, each with a link back to its references.

import { test } from "tap";
import "agent-doctest/tap";
import * as markdoc from "@markdoc/markdoc";
import { markdocConfig } from "../../src/shared/markdoc-config/tags/core.js";
import { parseMarkdown } from "../../src/shared/markdoc-config/parse/core.js";

// `renderers` is not an ES named export of the CommonJS package, so it is read
// from the default export.
const { renderers, transform, validate } = markdoc.default;

function render(src: string): string {
  return renderers.html(transform(parseMarkdown(src), markdocConfig));
}

void test("line 19", async (t) => {
  // doctest:L20
  t.check(render("Claim[^src].\n\n[^src]: The source."), "<article><p>Claim<sup class=\"footnote-ref\"><a href=\"#fn-1\" id=\"fnref-1\">1</a></sup>.</p><section class=\"footnotes\" aria-label=\"Footnotes\"><hr><ol><li id=\"fn-1\"><p>The source.<a href=\"#fnref-1\" class=\"footnote-backref\" aria-label=\"Back to reference 1\">↩</a></p></li></ol></section></article>");
});

// A footnote referenced twice gets one back-link per reference, and a definition
// can span paragraphs when its continuation is indented:
void test("A footnote referenced twice gets one back-link per reference, and a definitio...", async (t) => {
  // doctest:L28
  t.check(render("a[^1] b[^1] c[^2]\n\n[^1]: one\n[^2]: two\n\n    more"), "<article><p>a<sup class=\"footnote-ref\"><a href=\"#fn-1\" id=\"fnref-1\">1</a></sup> b<sup class=\"footnote-ref\"><a href=\"#fn-1\" id=\"fnref-1-1\">1</a></sup> c<sup class=\"footnote-ref\"><a href=\"#fn-2\" id=\"fnref-2\">2</a></sup></p><section class=\"footnotes\" aria-label=\"Footnotes\"><hr><ol><li id=\"fn-1\"><p>one<a href=\"#fnref-1\" class=\"footnote-backref\" aria-label=\"Back to reference 1\">↩</a><a href=\"#fnref-1-1\" class=\"footnote-backref\" aria-label=\"Back to reference 1\">↩</a></p></li><li id=\"fn-2\"><p>two</p><p>more<a href=\"#fnref-2\" class=\"footnote-backref\" aria-label=\"Back to reference 2\">↩</a></p></li></ol></section></article>");
});

// The rendered structure validates against the box config:
void test("The rendered structure validates against the box config:", async (t) => {
  // doctest:L35
  t.check(validate(parseMarkdown("a[^1]\n\n[^1]: one"), markdocConfig), []);
});
