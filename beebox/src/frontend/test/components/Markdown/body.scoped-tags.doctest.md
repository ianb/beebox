# Scoped Markdoc tags in the Markdown widget

A type's `markdocTags` reach the widget as the `tags` prop and render through
the `components` prop. A tag the active table does not know renders as the
text the author wrote, so nothing disappears on a surface without the type's
tags (`docs/plans/plugins-slice-2.md`, Track 1). The tag names below are not
in the core table; `subrecipe` and `ingredient` still are until the recipe
plugin takes them.

```ts setup
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdoc, { type Schema } from "@markdoc/markdoc";

const { Tag } = Markdoc;
import { Markdown } from "../../../src/components/Markdown/body.js";
import { BoxSlugProvider } from "../../../src/lib/box-slug.js";

globalThis.React = React;

const render = (text: string, extra: Record<string, unknown> = {}): string =>
  renderToStaticMarkup(
    React.createElement(BoxSlugProvider, { boxSlug: "test" }, React.createElement(Markdown, { onNavigate: () => undefined, ...extra }, text)),
  );

const garnish: Schema = {
  attributes: { amount: { type: String }, unit: { type: String } },
  transform: (node, config) => new Tag("Garnish", node.transformAttributes(config), node.transformChildren(config)),
};
const Garnish = ({ amount, unit, children }: { amount?: string; unit?: string; children?: React.ReactNode }) =>
  React.createElement("b", { className: "garnish" }, `[${amount} ${unit}] `, children);
```

## Without `tags`, the authored tag and its attributes stay visible

```ts
const plain = render('Top with {% garnish amount="2" unit="cups" %}flour{% /garnish %}.');
plain.includes("garnish amount=&quot;2&quot; unit=&quot;cups&quot;") && plain.includes("flour")
=> true
```

## With `tags` and `components`, the component renders and no authored tag text remains

```ts
const scoped = render('Top with {% garnish amount="2" unit="cups" %}flour{% /garnish %}.', {
  tags: { garnish },
  components: { Garnish },
});
scoped.includes('<b class="garnish">[2 cups] flour</b>') && !scoped.includes("{%")
=> true
```

## A block tag keeps its attribute values visible

```ts
const block = render('{% plating ref="x.recipe.card" %}\nBody\n{% /plating %}');
block.includes("plating ref=&quot;x.recipe.card&quot;")
=> true
```
