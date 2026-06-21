# Markdoc `redacted` tag

The `redacted` Markdoc tag wraps agent-authored spoiler content. The transform
emits `RedactedInline` or `RedactedBlock` based on `node.inline`, mirroring
the `quote` / `source` split — the React renderer then renders each shape
appropriately (inline blur span vs. block container).

Tested headlessly through Markdoc's own `renderers.html` — no React, no DOM.

```ts setup
import Markdoc from "@markdoc/markdoc";
import { markdocConfig } from "../src/shared/markdoc-config.js";

const { parse, transform, renderers } = Markdoc;

function render(src: string): string {
  return renderers.html(transform(parse(src), markdocConfig));
}
```

## Inline redacted within a paragraph

A tag whose body has no newlines is inline — emits `RedactedInline`.

```ts
render("The answer is {% redacted %}42{% /redacted %}.")
=>
<article><p>The answer is <RedactedInline>42</RedactedInline>.</p></article>
```

## Block redacted

A tag with block-level body emits `RedactedBlock`.

```ts
render("{% redacted %}\n\nA spoiler paragraph.\n\n{% /redacted %}")
=>
<article><RedactedBlock><p>A spoiler paragraph.</p></RedactedBlock></article>
```
