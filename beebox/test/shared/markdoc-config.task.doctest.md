# Markdoc task-list items

A GFM task item (`- [ ]` / `- [x]`) becomes a `Task` checkbox. The checkbox and
the item's inline text share a `label`, so the checkbox's accessible name is
the task text. A nested list stays outside the label.

Tested headlessly through Markdoc's own `renderers.html` — no React, no DOM.

```ts setup
import Markdoc from "@markdoc/markdoc";
import { markdocConfig } from "../../src/shared/markdoc-config/tags/core.js";

const { parse, transform, renderers } = Markdoc;

function render(src: string): string {
  return renderers.html(transform(parse(src), markdocConfig));
}
```

## The label holds the checkbox and the inline text

```ts
render("- [x] Pack **tent**\n- [ ] Stove")
=>
<article><ul><li><label><Task done="true"></Task>Pack <strong>tent</strong></label></li><li><label><Task done="false"></Task>Stove</label></li></ul></article>
```

## A nested list stays outside the label

```ts
render("- [ ] Gear\n  - [x] Tent")
=>
<article><ul><li><label><Task done="false"></Task>Gear</label><ul><li><label><Task done="true"></Task>Tent</label></li></ul></li></ul></article>
```

## A plain list item is unchanged

```ts
render("- Tent")
=>
<article><ul><li>Tent</li></ul></article>
```
