# Rendered todos carry the collector's locator

A rendered `{% todo %}` needs the same locator the collector gives it, so a
tick (Track 3) and a plate-state lookup (Track 2) address the todo the reader
sees (`docs/plans/todos-ui.md`). `Markdown.tsx` runs `assignLocators` on the
parsed body with the card's body line offset and stamps each todo node
(`stampLocators`); the `todo` transform in `markdoc-config.ts` copies the
stamp onto the `Tag` as `locator`.

```ts setup
import Markdoc from "@markdoc/markdoc";
import type { RenderableTreeNode, Tag } from "@markdoc/markdoc";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { markdocConfig } from "../../src/shared/markdoc-config.js";
import { assignLocators, stampLocators } from "../../src/shared/todo-locators.js";
import { extractBodyTodos } from "../../src/core/todo/extract-body.js";
import { makeTodoComponents } from "../../src/frontend/src/components/Todo.js";

globalThis.React = React;
const { parse, transform, renderers } = Markdoc;

/** Every TodoInline/TodoBlock tag in a transformed tree, in document order. */
function todoTags(node: RenderableTreeNode): Tag[] {
  if (!Markdoc.Tag.isTag(node)) return [];
  const here = node.name === "TodoInline" || node.name === "TodoBlock" ? [node] : [];
  return [...here, ...node.children.flatMap(todoTags)];
}

function locatorsOf(body: string, lineOffset: number | null): string {
  const ast = parse(body);
  if (lineOffset !== null) stampLocators(assignLocators(ast, lineOffset));
  return todoTags(transform(ast, markdocConfig)).map((tag) => JSON.stringify(tag.attributes["locator"] ?? null)).join(" ");
}

const body = [
  "# Porch",
  "",
  "{% todo %}Order lumber{% /todo %} and {% todo due=\"2026-09-15\" %}book the inspector{% /todo %}",
  "",
  "{% todo %}",
  "Pick a stain colour",
  "{% /todo %}",
].join("\n");
```

## The locator survives Markdoc's transform

`Markdoc.transform` resolves the tree first, which clones every node, so a
lookup keyed by the parsed node object would miss. The stamp rides on the
clone. With a four-line frontmatter block, the body's first line is file
line 5:

```ts
locatorsOf(body, 4)
=> {"kind":"body","line":7} {"kind":"body","line":7,"nth":2} {"kind":"body","line":9}
```

They are exactly the collector's locators for the same body:

```ts
const collected = extractBodyTodos({ relPath: "Porch.memo.card", bodyText: body, lineOffset: 4 });
collected.ok ? collected.items.map((item) => JSON.stringify(item.locator)).join(" ") : collected.message
=> {"kind":"body","line":7} {"kind":"body","line":7,"nth":2} {"kind":"body","line":9}
```

## Without a card, no locator

Markdown that is not a card's body (chat, a commit message) is never
stamped, and its todos carry no locator:

```ts
locatorsOf(body, null)
=> null null null
```

## An author cannot write one

`locator` is not a declared attribute, so a hand-written one is dropped; the
only locator a todo can carry is the stamped one.

```ts
locatorsOf('{% todo locator="99" %}Forged{% /todo %}', null)
=> null

locatorsOf('{% todo locator="99" %}Forged{% /todo %}', 0)
=> {"kind":"body","line":1}
```

## It reaches the rendered element

Rendered with the todo components, each todo's element names its locator,
which is what the card summary scrolls to and what a later tick reads.

```ts
const ast = parse(body);
stampLocators(assignLocators(ast, 4));
const { TodoInline, TodoBlock } = makeTodoComponents({ cardPath: "Porch.memo.card" });
const html = renderToStaticMarkup(React.createElement(React.Fragment, null,
  renderers.react(transform(ast, markdocConfig), React, { components: { TodoInline, TodoBlock } })));
[...html.matchAll(/data-todo-locator="([^"]*)"/g)].map((m) => m[1]).join(" ")
=> 7 7#2 9
```
