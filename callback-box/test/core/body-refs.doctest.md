# Body refs

`extractBodyRefs(body)` walks a card's markdown body for refs carried by
Markdoc tag attributes literally named `ref`. Cardworks' frontmatter ref
walker doesn't see into body strings, so this complements it for refs that
live in body tags like `{% source ref="…" %}` — any body tag whose
attribute is literally named `ref`.

```ts setup
import { extractBodyRefs } from "../../src/core/body-refs.js";
```

## A single `{% source %}` tag

The ref value and a `body:<line>:<tag>.<attr>` path are returned.

```ts
JSON.stringify(
  extractBodyRefs('Dana said: {% source ref="/box/people/dana.person.card" usage="verbatim" %}ship Friday{% /source %}'),
  null,
  2,
)
=>
[
  {
    "path": "body:1:source.ref",
    "ref": "/box/people/dana.person.card"
  }
]
```

Only the `ref` attribute is a ref — `as` and other attributes are opaque.

```ts
extractBodyRefs('{% source ref="a/b.doc.card" usage="summary" %}x{% /source %}').length
=> 1
```

## Multiple tags across lines

Line numbers are 1-indexed and track each tag's start line.

```ts
const body = [
  "Intro paragraph.",
  "",
  '{% source ref="/box/a.doc.card" %}first{% /source %}',
  "",
  '{% subrecipe ref="/box/sauce.recipe.card" %}Sauce{% /subrecipe %}',
].join("\n");
JSON.stringify(extractBodyRefs(body), null, 2)
=>
[
  {
    "path": "body:3:source.ref",
    "ref": "/box/a.doc.card"
  },
  {
    "path": "body:5:subrecipe.ref",
    "ref": "/box/sauce.recipe.card"
  }
]
```

## Nested tags

A `ref` on the outer tag is found; the inner tag without a ref contributes
nothing.

```ts
JSON.stringify(
  extractBodyRefs('{% source ref="/box/m.memo.card" usage="verbatim" %}{% quote %}exact words{% /quote %}{% /source %}'),
  null,
  2,
)
=>
[
  {
    "path": "body:1:source.ref",
    "ref": "/box/m.memo.card"
  }
]
```

## Bodies with no body-tag refs

Plain markdown (including inline markdown links, which are not Markdoc tags)
yields nothing — link rewriting is handled elsewhere, not here.

```ts
extractBodyRefs("Just prose with a [link](people/Priya.person.card) and **bold**.").length
=> 0

extractBodyRefs("").length
=> 0

extractBodyRefs("# Heading\n\nNo tags here.").length
=> 0
```

A tag with no `ref` attribute is ignored.

```ts
extractBodyRefs("{% callout type=\"note\" %}heads up{% /callout %}").length
=> 0
```

## Malformed bodies are swallowed

A body that throws on parse is treated as "no refs" rather than crashing the
caller (validation/move would rather miss a warning than fail the card).

```ts
Array.isArray(extractBodyRefs("{% source ref=unclosed"))
=> true
```
