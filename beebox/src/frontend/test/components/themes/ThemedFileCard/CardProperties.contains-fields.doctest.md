# Card Properties: filed at, found by, then the type fields

`CardFacts` is the top of a card's Properties face. It names where the card
is filed and its type, then the common fields that say how the card is found
(`contains`, `prominence`, `symbol`, with `contains-evidence` folded under a
disclosure), then the type fields that `splitCardFields` sends to Properties.

```ts setup
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CardFacts } from "../../../../src/components/themes/ThemedFileCard/CardProperties.js";

globalThis.React = React;

const memoSchema = { hasBodyField: true, defaultProminence: "ordinary" };

function textOf(html) {
  return html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();
}

/** Each `<dt>`/`<dd>` pair as "label = value", in order. */
function rows(html) {
  return [...html.matchAll(/<dt[^>]*>(.*?)<\/dt>\s*<dd[^>]*>(.*?)<\/dd>/gs)].map(([, label, value]) => `${textOf(label)} = ${textOf(value)}`);
}

function render(data) {
  return renderToStaticMarkup(React.createElement(CardFacts, { data, boxSlug: "test", onNavigate: () => undefined }));
}

const memo = render({
  path: "_content/projects/Porch.memo.card",
  kind: "frontmatter",
  type: "memo",
  schema: memoSchema,
  frontmatter: {
    title: "Porch",
    contains: "Porch repair quotes",
    "contains-evidence": "Three quotes in the body",
    symbol: { glyph: "🏠", background: "#fde" },
    todos: [{ text: "Book the inspector" }],
    status: "new",
    created: "2026-07-01",
  },
});
```

A memo with no declared `prominence` shows its type's default and says so.
The symbol row draws the mark and the group as written. The memo's own fields
follow, in the shared fields table; the title, todos, and theme are shown
elsewhere and are not repeated:

```ts
rows(memo)
=> [
  "Filed at = _content/projects/Porch.memo.card",
  "Card type = memo",
  "Contains = Porch repair quotes",
  "Prominence = ordinary, the type's default",
  "Symbol = 🏠 glyph: 🏠 · background: #fde",
  "status: = new",
  "created: = 2026-07-01",
]
```

The evidence for `contains` sits under a closed disclosure:

```ts
memo.match(/<details[^>]*>.*?<\/details>/s)?.[0].replace(/ class="[^"]*"/g, "")
=> <details><summary>Contains evidence</summary><p>Three quotes in the body</p></details>
```

A declared level shows as declared:

```ts
rows(render({ path: "_content/Plan.doc.card", type: "doc", schema: memoSchema, frontmatter: { prominence: "primary" } }))
=> ["Filed at = _content/Plan.doc.card", "Card type = doc", "Prominence = primary"]
```

A card that failed validation has no schema facts (`schema: null`), so
Properties cannot name the type's default: it shows a declared value as
written, or no Prominence row at all. Its type fields stay on the front
(`splitCardFields`), so Properties has no fields table:

```ts
const broken = { path: "_content/Broken.memo.card", type: "memo", schema: null };
rows(render({ ...broken, frontmatter: { prominence: "global", status: [1, 2] } }))
=> ["Filed at = _content/Broken.memo.card", "Card type = memo", "Prominence = global"]

rows(render({ ...broken, frontmatter: { status: [1, 2] } }))
=> ["Filed at = _content/Broken.memo.card", "Card type = memo"]
```
