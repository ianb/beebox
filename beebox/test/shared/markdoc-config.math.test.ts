// Dollar-delimited TeX math in the frontend parser: `$…$` inline, `$$…$$`
// display. Prices, shell text and code stay text; the TeX reaches the renderer
// unescaped; an unclosed `$$` (a message still streaming) stays text.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import * as markdoc from "@markdoc/markdoc";
import type { Config } from "@markdoc/markdoc";
import { createMarkdownParser, parseMarkdown } from "../../src/shared/markdoc-config/parse/core.js";

const { renderers, transform, Tag } = markdoc.default;

const parser = createMarkdownParser({ linkify: false, math: true });

// The HTML renderer prints a soft line break as a space.
// Each math tag renders as `<m>` (inline) or `<M>` (block), with `d` marking
// display mode, so a check reads as the structure the React renderer gets.
const config: Config = {
  tags: {
    math: {
      selfClosing: true,
      attributes: { tex: { type: String, required: true }, display: { type: Boolean } },
      transform(node) {
        const { tex, display } = node.attributes;
        return new Tag(node.inline ? "m" : "M", display === true ? { d: "" } : {}, [String(tex)]);
      },
    },
  },
};

function render(src: string): string {
  return renderers.html(transform(parser.parse(src), config)).replace(/^<article>|<\/article>$/g, "");
}

void test("inline and display math", async (t) => {
  t.check(render("Energy is $E = mc^2$ here."), "<p>Energy is <m>E = mc^2</m> here.</p>");
  t.check(render("$$\\ce{H2 + Cl2 -> 2HCl}$$"), "<M d=\"\">\\ce{H2 + Cl2 -&gt; 2HCl}</M>");
  t.check(render("Before:\n$$\na = b \\\\\nc = d\n$$\nafter"), "<p>Before:</p><M d=\"\">a = b \\\\\nc = d</M><p>after</p>");
  // `$$…$$` inside a sentence is display math in the line.
  t.check(render("so $$x^2$$ holds"), "<p>so <m d=\"\">x^2</m> holds</p>");
});

// The rule sees raw source, so Markdown escapes and emphasis do not touch TeX.
void test("TeX reaches the renderer as written", async (t) => {
  t.check(render("$\\{a_1*b*c\\}$"), "<p><m>\\{a_1*b*c\\}</m></p>");
  t.check(render("$a \\$ b$"), "<p><m>a \\$ b</m></p>");
});

void test("prices and shell text stay text", async (t) => {
  t.check(render("It costs $5 and $10."), "<p>It costs $5 and $10.</p>");
  t.check(render("Between $5-$10 per month"), "<p>Between $5-$10 per month</p>");
  t.check(render("Pay $ 5 or $ 6"), "<p>Pay $ 5 or $ 6</p>");
  t.check(render("Set $HOME and $PATH first"), "<p>Set $HOME and $PATH first</p>");
  t.check(render("A lone $ sign"), "<p>A lone $ sign</p>");
  t.check(render("Escaped \\$x\\$ stays"), "<p>Escaped $x$ stays</p>");
  // A price never pairs with a later formula's closing `$`.
  t.check(render("It costs $5 and $10; calculate $x$."), "<p>It costs $5 and $10; calculate <m>x</m>.</p>");
  // Inline math does not cross a line break.
  t.check(render("from $a\nto b$"), "<p>from $a to b$</p>");
});

void test("code is never math", async (t) => {
  t.check(render("Run `echo $A$B` now"), "<p>Run <code>echo $A$B</code> now</p>");
  t.check(render("```sh\necho $x$\n```"), "<pre data-language=\"sh\">echo $x$\n</pre>");
  // An unclosed `$` stops at a backtick, so the code span keeps its formatting.
  t.check(render("See $x `code$` then $y$."), "<p>See $x <code>code$</code> then <m>y</m>.</p>");
});

// A message still streaming: the opening `$$` arrived, the closing one has not.
void test("an unclosed $$ stays text", async (t) => {
  t.check(render("$$\n\\frac{a}{b"), "<p>$$ \\frac{a}{b</p>");
  t.check(render("see $$x^2"), "<p>see $$x^2</p>");
  // A blank line ends the search for the closing line.
  t.check(render("$$\na\n\nb\n$$"), "<p>$$ a</p><p>b $$</p>");
});

void test("math inside lists and quotes", async (t) => {
  t.check(render("- item $x$\n- next"), "<ul><li>item <m>x</m></li><li>next</li></ul>");
  t.check(render("> $$\n> y\n> $$"), "<blockquote><M d=\"\">y</M></blockquote>");
});

// Backend walkers and publishing use the plain parser, which has no math.
void test("the plain parser leaves dollars alone", async (t) => {
  t.check(renderers.html(transform(parseMarkdown("$x$"), config)), "<article><p>$x$</p></article>");
});
