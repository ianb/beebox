# Escaping outside text before it becomes a card body

Connectors that write third-party text into a card body (a clipped web page,
a PDF's extracted text, text shared from another app) escape it first, so it renders as
the literal text the source contained. Box Markdown renders allow-listed HTML
and runs Markdoc tags; outside content should do neither.

```ts setup
import Markdoc from "@markdoc/markdoc";
import { markdocConfig } from "../../src/shared/markdoc-config/tags/core.js";
import { parseMarkdown } from "../../src/shared/markdoc-config/parse/core.js";
import { escapeMarkdownText, neutralizeIngestedMarkdown } from "../../src/shared/markdoc-config/ingest.js";

const { transform, renderers } = Markdoc;

function render(src: string): string {
  return renderers.html(transform(parseMarkdown(src), markdocConfig));
}

// A clipped page and a page with code, used by the examples below.
const clipped = "# Title\n\nUse <details> and {% todo %}x{% /todo %} <!-- hidden -->\nSee <https://example.com> and [docs](https://example.com/d).";
const fence = "`".repeat(3);
const code = `\`<b>{% x %}</b>\` inline\n\n${fence}liquid\n{% if user %}<b>hi</b>{% endif %}\n${fence}\n\nafter`;
```

## Clipped pages and extracted documents

`neutralizeIngestedMarkdown` backslash-escapes raw HTML and Markdoc tag
openers outside code. Headings, lists, links, autolinks and emphasis pass
through:

```ts
neutralizeIngestedMarkdown(clipped).split("\n")
=> ["# Title", "", "Use \\<details> and \\{% todo %}x\\{% /todo %} \\<!-- hidden -->", "See <https://example.com> and [docs](https://example.com/d)."]

render(neutralizeIngestedMarkdown(clipped))
=> <article><h1>Title</h1><p>Use &lt;details&gt; and {% todo %}x{% /todo %} &lt;!-- hidden --&gt; See <a href="https://example.com">https://example.com</a> and <a href="https://example.com/d">docs</a>.</p></article>
```

Code is already literal, so code spans pass through unchanged. Markdoc runs
tags inside fenced code, though, so a fence holding `{%` (a Liquid or Jinja
template on a clipped page) gets `{% process=false %}`:

```ts
neutralizeIngestedMarkdown(code).split("\n")
=> ["`<b>{% x %}</b>` inline", "", "```liquid {% process=false %}", "{% if user %}<b>hi</b>{% endif %}", "```", "", "after"]

render(neutralizeIngestedMarkdown(code))
=> <article><p><code>&lt;b&gt;{% x %}&lt;/b&gt;</code> inline</p><pre data-language="liquid">{% if user %}&lt;b&gt;hi&lt;/b&gt;{% endif %}
</pre><p>after</p></article>
```

Outside text cannot turn processing back on with its own fence annotation:

```ts
const sneaky = `${fence}liquid {% process=true %}\n{% todo %}call now{% /todo %}\n${fence}`;
render(neutralizeIngestedMarkdown(sneaky))
=> <article><pre data-language="liquid">{% todo %}call now{% /todo %}
</pre></article>
```

Escaping twice changes nothing:

```ts
neutralizeIngestedMarkdown(neutralizeIngestedMarkdown(clipped + "\n\n" + code)) === neutralizeIngestedMarkdown(clipped + "\n\n" + code)
=> true
```

## Plain-text values

Some outside values are plain text, not Markdown: a shared page's title, for
one. `escapeMarkdownText` escapes every ASCII punctuation character, so the
value cannot add a link, an image, HTML or a tag. Line breaks become hard breaks indented to stay in the
enclosing list item:

```ts
const value = escapeMarkdownText("[verify](/_content/finance) <b>now</b>\n# not a heading", { indent: "  " });
render(`- **message:** ${value}`)
=> <article><ul><li><strong>message:</strong> [verify](/_content/finance) &lt;b&gt;now&lt;/b&gt;<br># not a heading</li></ul></article>
```
