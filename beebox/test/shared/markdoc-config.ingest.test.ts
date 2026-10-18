// # Escaping outside text before it becomes a card body
//
// Connectors that write third-party text into a card body (a clipped web page,
// a PDF's extracted text, text shared from another app) escape it first, so it renders as
// the literal text the source contained. Box Markdown renders allow-listed HTML
// and runs Markdoc tags; outside content should do neither.

import { test } from "tap";
import "agent-doctest/tap";
import Markdoc from "@markdoc/markdoc";
import { markdocConfig } from "../../src/shared/markdoc-config/tags/core.js";
import { parseMarkdown } from "../../src/shared/markdoc-config/parse/core.js";
import { escapeMarkdownText, neutralizeIngestedMarkdown } from "../../src/shared/markdoc-config/ingest.js";

// eslint-disable-next-line import-x/no-named-as-default-member -- named import fails under Node ESM; default-member access is the runtime-correct form for this CJS module
const { transform, renderers } = Markdoc;

function render(src: string): string {
  return renderers.html(transform(parseMarkdown(src), markdocConfig));
}

// A clipped page and a page with code, used by the examples below.
const clipped = "# Title\n\nUse <details> and {% todo %}x{% /todo %} <!-- hidden -->\nSee <https://example.com> and [docs](https://example.com/d).";
const fence = "`".repeat(3);
const code = `\`<b>{% x %}</b>\` inline\n\n${fence}liquid\n{% if user %}<b>hi</b>{% endif %}\n${fence}\n\nafter`;

// ## Clipped pages and extracted documents
//
// `neutralizeIngestedMarkdown` backslash-escapes raw HTML and Markdoc tag
// openers outside code. Headings, lists, links, autolinks and emphasis pass
// through:
void test("neutralizeIngestedMarkdown backslash-escapes raw HTML and Markdoc tag openers...", async (t) => {
  // doctest:L33
  t.check(neutralizeIngestedMarkdown(clipped).split("\n"), [
    "# Title",
    "",
    "Use \\<details> and \\{% todo %}x\\{% /todo %} \\<!-- hidden -->",
    "See <https://example.com> and [docs](https://example.com/d).",
  ]);

  // doctest:L36
  t.check(render(neutralizeIngestedMarkdown(clipped)), "<article><h1>Title</h1><p>Use &lt;details&gt; and {% todo %}x{% /todo %} &lt;!-- hidden --&gt; See <a href=\"https://example.com\">https://example.com</a> and <a href=\"https://example.com/d\">docs</a>.</p></article>");
});

// Code is already literal, so code spans pass through unchanged. Markdoc runs
// tags inside fenced code, though, so a fence holding `{%` (a Liquid or Jinja
// template on a clipped page) gets `{% process=false %}`:
void test("Code is already literal, so code spans pass through unchanged.", async (t) => {
  // doctest:L45
  t.check(neutralizeIngestedMarkdown(code).split("\n"), [
    "`<b>{% x %}</b>` inline",
    "",
    "```liquid {% process=false %}",
    "{% if user %}<b>hi</b>{% endif %}",
    "```",
    "",
    "after",
  ]);

  // doctest:L48
  await t.checkText(render(neutralizeIngestedMarkdown(code)), `<article><p><code>&lt;b&gt;{% x %}&lt;/b&gt;</code> inline</p><pre data-language="liquid">{% if user %}&lt;b&gt;hi&lt;/b&gt;{% endif %}
</pre><p>after</p></article>`);
});

// Outside text cannot turn processing back on with its own fence annotation:
void test("Outside text cannot turn processing back on with its own fence annotation:", async (t) => {
  // doctest:L56
  const sneaky = `${fence}liquid {% process=true %}\n{% todo %}call now{% /todo %}\n${fence}`;
  await t.checkText(render(neutralizeIngestedMarkdown(sneaky)), `<article><pre data-language="liquid">{% todo %}call now{% /todo %}
</pre></article>`);
});

// Escaping twice changes nothing:
void test("Escaping twice changes nothing:", async (t) => {
  // doctest:L65
  await t.checkText(neutralizeIngestedMarkdown(neutralizeIngestedMarkdown(clipped + "\n\n" + code)) === neutralizeIngestedMarkdown(clipped + "\n\n" + code), "true");
});

// ## Plain-text values
//
// Some outside values are plain text, not Markdown: a shared page's title, for
// one. `escapeMarkdownText` escapes every ASCII punctuation character, so the
// value cannot add a link, an image, HTML or a tag. Line breaks become hard breaks indented to stay in the
// enclosing list item:
void test("Some outside values are plain text, not Markdown:", async (t) => {
  // doctest:L77
  const value = escapeMarkdownText("[verify](/_content/finance) <b>now</b>\n# not a heading", { indent: "  " });
  t.check(render(`- **message:** ${value}`), "<article><ul><li><strong>message:</strong> [verify](/_content/finance) &lt;b&gt;now&lt;/b&gt;<br># not a heading</li></ul></article>");
});
