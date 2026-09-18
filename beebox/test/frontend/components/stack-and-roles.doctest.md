# Stack and the text roles — layout and element come from the component

`Stack` used to space its children with `space-y-*`, a top margin. Margin does
nothing to an inline element, so a `Stack` of `Text` spans rendered as one
run-together line. `Stack` is now a flex column with `gap-*`, which separates
children whatever their display type.

The role components render the element the role needs, so the caller never
chooses between a `<span>` and a `<p>`.

```ts setup
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Stack } from "../../../src/frontend/src/components/ui/Stack.js";
import { Text } from "../../../src/frontend/src/components/ui/Text.js";
import { Heading } from "../../../src/frontend/src/components/ui/Heading.js";
import { Hint } from "../../../src/frontend/src/components/ui/Hint.js";
import { ErrorText } from "../../../src/frontend/src/components/ui/ErrorText.js";
import { StatusMessage } from "../../../src/frontend/src/components/ui/StatusMessage.js";

globalThis.React = React;

const h = React.createElement;
const html = (el: React.ReactElement): string => renderToStaticMarkup(el);
```

## Stack separates inline children

Two `Text` spans in a `Stack` are flex items, so each takes its own line and
the gap applies between them.

```ts
html(h(Stack, { gap: "xs" }, h(Text, null, "Label"), h(Text, null, "Description")))
=> <div class="flex flex-col gap-1"><span class="text-warm-900 text-base">Label</span><span class="text-warm-900 text-base">Description</span></div>
```

The default gap is `md`, and `as` still selects the element:

```ts
html(h(Stack, { as: "ul" }, h("li", null, "a")))
=> <ul class="flex flex-col gap-3"><li>a</li></ul>
```

## Heading renders a real heading; the level decides the look

```ts
html(h(Heading, { level: 2 }, "This box"))
=> <h2 class="text-lg font-semibold text-warm-900">This box</h2>

html(h(Heading, { level: 3, className: "mb-2" }, "Engines"))
=> <h3 class="text-sm font-semibold text-warm-900 mb-2">Engines</h3>
```

## Hint and ErrorText are block paragraphs

```ts
html(h(Hint, null, "Which harnesses a new chat may choose."))
=> <p class="text-sm text-warm-500">Which harnesses a new chat may choose.</p>

html(h(ErrorText, null, "Could not save."))
=> <p class="text-sm text-danger-dark">Could not save.</p>
```

## StatusMessage announces a pane's placeholder

The caller's padding replaces the default `p-8` (`cn` merges with
`tailwind-merge`, and the caller wins).

```ts
html(h(StatusMessage, null, "Loading…"))
=> <div role="status" class="p-8 text-warm-600">Loading…</div>

html(h(StatusMessage, { className: "p-4" }, "Loading…"))
=> <div role="status" class="text-warm-600 p-4">Loading…</div>
```
