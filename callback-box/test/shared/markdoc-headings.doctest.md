# Markdoc heading anchors

`makeHeadingNode()` is the Markdoc `heading` schema installed by the React
render config (`Markdown.tsx`). It gives rendered headings a stable `id`
anchor (slug of the heading text) and a `data-line` carrying the 1-indexed
source line. The id is the most stable signal the selection-commentary
position locator anchors to; headings have no id by default.

It returns a fresh schema per call so the duplicate-slug set is scoped to one
transform pass. Tested headlessly through Markdoc's own `renderers.html` — no
React, no DOM.

```ts setup
import Markdoc from "@markdoc/markdoc";
import { makeHeadingNode } from "../../src/shared/markdoc-config.js";

const { parse, transform, renderers } = Markdoc;

function render(src: string): string {
  const config = { nodes: { heading: makeHeadingNode() } };
  return renderers.html(transform(parse(src), config));
}
```

## A heading gets an id slug and a source line

```ts
render("# Hello World")
=>
<article><h1 id="hello-world" data-line="1">Hello World</h1></article>
```

## Duplicate headings get numeric suffixes

The `seen` set is scoped to the single `makeHeadingNode()` instance, so the
second `Notes` becomes `notes-1`. `data-line` tracks each heading's own line.

```ts
render("## Notes\n\ntext\n\n## Notes\n")
=>
<article><h2 id="notes" data-line="1">Notes</h2><p>text</p><h2 id="notes-1" data-line="5">Notes</h2></article>
```

## Inline code contributes to the slug

```ts
render("# The `cb` command")
=>
<article><h1 id="the-cb-command" data-line="1">The <code>cb</code> command</h1></article>
```

## A heading with no word characters falls back to `section`

```ts
render("# 🎉")
=>
<article><h1 id="section" data-line="1">🎉</h1></article>
```
