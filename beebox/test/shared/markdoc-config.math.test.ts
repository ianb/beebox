// TeX math in the frontend parser: `$…$` or `\(…\)` inline, `$$…$$` or
// `\[…\]` display. Prices, shell text and code stay text; the TeX reaches the renderer
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

// GPT models write LaTeX's backslash delimiters. The rule runs before the
// escape rule, which would turn `\(` into `(`.
void test("backslash delimiters", async (t) => {
  t.check(render("Kepler: \\(T^2 = a^3\\) for orbits."), "<p>Kepler: <m>T^2 = a^3</m> for orbits.</p>");
  t.check(render("Law:\n\\[\nT^2 = \\frac{4\\pi^2}{GM} a^3\n\\]\nafter"), "<p>Law:</p><M d=\"\">T^2 = \\frac{4\\pi^2}{GM} a^3</M><p>after</p>");
  t.check(render("\\[ x^2 \\]"), "<M d=\"\">x^2</M>");
  // `\\` inside is a TeX line break, not part of a closer.
  t.check(render("\\[\na \\\\\nb\n\\]"), "<M d=\"\">a \\\\\nb</M>");
  t.check(render("\\(a \\\\ b\\)"), "<p><m>a \\\\ b</m></p>");
  // `\\]` is a row break and a literal bracket; the real closer comes later.
  t.check(render("\\[\n\\begin{gathered}a \\\\] b\\end{gathered}\n\\]"), "<M d=\"\">\\begin{gathered}a \\\\] b\\end{gathered}</M>");
  // A line holding only `\[…\]` is display math, even if it reads as words.
  t.check(render("\\[link\\]"), "<M d=\"\">link</M>");
  t.check(render("> \\[\n> y\n> \\]"), "<blockquote><M d=\"\">y</M></blockquote>");
});

void test("backslash delimiters that are not math", async (t) => {
  // A blank line ends the search for the closing line, as with `$$`.
  t.check(render("\\[\na\n\nb\n\\]"), "<p>[ a</p><p>b ]</p>");
  // Unclosed while streaming: the escape rule makes a plain paren or bracket.
  t.check(render("see \\(x^2"), "<p>see (x^2</p>");
  t.check(render("\\[\n\\frac{a}{b"), "<p>[ \\frac{a}{b</p>");
  // Escaped brackets inside a sentence stay brackets; only a block is display math.
  t.check(render("Not a \\[link\\] here"), "<p>Not a [link] here</p>");
  t.check(render("A \\(paren\nacross lines\\)"), "<p>A (paren across lines)</p>");
  t.check(render("Empty \\(\\) stays"), "<p>Empty () stays</p>");
  // A backslash at the end of a line is a hard break, not part of the formula.
  t.check(render("Before \\(a\\\nb\\) after"), "<p>Before (a<br>b) after</p>");
  // A closer inside a later code fence does not pair with an open `\[` or `$$`.
  t.check(render("\\[\n```tex\nx \\]\n```"), "<p>[</p><pre data-language=\"tex\">x \\]\n</pre>");
  t.check(render("$$\n```tex\nx $$\n```"), "<p>$$</p><pre data-language=\"tex\">x $$\n</pre>");
  t.check(render("Run `echo \\(x\\)` now"), "<p>Run <code>echo \\(x\\)</code> now</p>");
  t.check(render("```tex\n\\[x\\]\n```"), "<pre data-language=\"tex\">\\[x\\]\n</pre>");
});

// Backend walkers use the plain parser, which has no math.
void test("the plain parser leaves dollars alone", async (t) => {
  t.check(renderers.html(transform(parseMarkdown("$x$"), config)), "<article><p>$x$</p></article>");
});
