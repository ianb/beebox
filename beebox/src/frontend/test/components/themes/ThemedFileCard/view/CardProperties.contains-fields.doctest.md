# Card Properties: filed at, found by, then the type fields

`CardFacts` is the top of a card's Properties face. It names where the card
is filed and its type, then the common fields that say how the card is found
(`contains`, `prominence`, `symbol`, with `contains-evidence` folded under a
disclosure), then the type fields that `splitCardFields` sends to Properties.

```ts setup
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CardFacts } from "../../../../../src/components/themes/ThemedFileCard/view/CardProperties.js";

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
  body: "Three quotes so far.\n",
});
```

A memo with no declared `prominence` shows its type's default and says so.
The memo has a body, so its type fields are here rather than on the front.
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
  "Status = new",
  "Created = 2026-07-01",
]
```

The fields table reads its keys as labels and small objects as one value
(`test/lib/readable-fields.doctest.md`). A record is headed by its `name:`
(`cardTitle`), so the table leaves out the `name` row that would repeat the
header:

```ts
rows(render({
  path: "_content/lending/Camp_stove.record.card",
  type: "record",
  schema: memoSchema,
  frontmatter: { name: "Camp stove", location: { text: "With Idris" }, quantity: { value: "1 stove", note: "missing lid" } },
  body: "Borrowed for the lake trip.\n",
}))
=> [
  "Filed at = _content/lending/Camp_stove.record.card",
  "Card type = record",
  "Prominence = ordinary, the type's default",
  "Location = With Idris",
  "Quantity = 1 stove (missing lid)",
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

A landmark's body is the place summary, and most landmarks have none. With an
empty body, `splitCardFields` sends the type fields to the front, but the place
page replaces that front and draws no fields. So for a landmark Properties
shows them under Fields whether or not it has a body; otherwise `navigation`
would show only in Source (docs/implemented-plans/landmark-arrival.md, Track C;
docs/implemented-plans/place-shows-cards.md, Track C).

```ts
const landmarkSchema = { hasBodyField: true, defaultProminence: "background" };
const landmark = (body) => render({
  path: "_content/lending/Lending.landmark.card",
  type: "landmark",
  schema: landmarkSchema,
  frontmatter: { symbol: { glyph: "🤝" }, navigation: { label: "Lending" } },
  body,
});
[undefined, "The stove is with Idris.\n"].map((body) => ({ fields: landmark(body).includes('data-card-section="fields"'), navigation: /Navigation/.test(landmark(body)) }))
=> [{ fields: true, navigation: true }, { fields: true, navigation: true }]
```

Other body-less types keep their fields on the front.

```ts
const bodiless = { hasBodyField: false, defaultProminence: null };
const question = render({ path: "_content/Q.question.card", type: "question", schema: bodiless, frontmatter: { question: "Which?" } });
question.includes('data-card-section="fields"')
=> false
```

## An empty body leaves the type fields on the front

With no body text, the front shows the type fields
(`test/lib/card-field-faces.doctest.md`), so Properties lists no Fields
section and nothing shows twice. A body that only repeats the title counts as
empty, the same test the front uses.

```ts
const emptyMemo = (body) => render({
  path: "_content/projects/Porch.memo.card", type: "memo", schema: memoSchema,
  frontmatter: { title: "Porch", status: "new" }, body,
});
[emptyMemo(undefined).includes('data-card-section="fields"'), emptyMemo("# Porch\n").includes('data-card-section="fields"'), emptyMemo("Quotes.\n").includes('data-card-section="fields"')]
=> [false, false, true]
```
