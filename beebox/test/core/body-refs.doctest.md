# Body refs

`extractBodyRefs(body)` walks a card's markdown body for refs carried by
Markdoc tag attributes literally named `ref`. Cardworks' frontmatter ref
walker doesn't see into body strings, so this complements it for refs that
live in body tags like `{% source ref="…" %}` — any body tag whose
attribute is literally named `ref`.

```ts setup
import { extractBodyRefs, extractReferenceDefinitions } from "../../src/core/body-refs.js";
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

## Reference-style link definitions: continuation-line and angle-bracket destinations

CommonMark allows a link reference definition's destination to be on the
line AFTER the `[id]:` label, and to be delimited with `<...>` instead of
written bare. The Markdoc parser this codebase renders/lints with already
resolves both forms as real links, so the extractor needs to see them too.

```ts
const body = [
  "[s]:",
  "  /store/recipes/Soup.recipe.card",
  "",
  "See [soup][s].",
].join("\n");
JSON.stringify(extractReferenceDefinitions(body), null, 2)
=>
[
  {
    "path": "body:2:ref-def",
    "ref": "/store/recipes/Soup.recipe.card"
  }
]
```

```ts
JSON.stringify(extractReferenceDefinitions("[t]: </store/x.card>\n\nSee [thing][t]."), null, 2)
=>
[
  {
    "path": "body:1:ref-def",
    "ref": "/store/x.card"
  }
]
```

A blank line between the label and a would-be continuation destination ends
the definition — no destination is found (matching CommonMark and this
codebase's Markdoc parser).

```ts
extractReferenceDefinitions("[s]:\n\n  /store/x.card").length
=> 0
```

## CRLF line endings don't hide a reference definition (finding 7, round 3 hardening)

JS regex `.` excludes every line-terminator character, `\r` included — a
Windows-line-ending body's raw `\r`-suffixed line (left attached after
`body.split("\n")`) previously made the label-line pattern's `(.*)$` fail to
match at all, so a CRLF body's reference definitions were invisible to both
extraction and the migration's rewriter (they share this one matcher).

```ts
const crlfBody = "[s]: /store/recipes/Soup.recipe.card\r\n\r\nSee [soup][s].\r\n";
JSON.stringify(extractReferenceDefinitions(crlfBody), null, 2)
=>
[
  {
    "path": "body:1:ref-def",
    "ref": "/store/recipes/Soup.recipe.card"
  }
]
```

The continuation-line form works under CRLF too:

```ts
const crlfContinuation = "[s]:\r\n  /store/recipes/Soup.recipe.card\r\n\r\nSee [soup][s].\r\n";
JSON.stringify(extractReferenceDefinitions(crlfContinuation), null, 2)
=>
[
  {
    "path": "body:2:ref-def",
    "ref": "/store/recipes/Soup.recipe.card"
  }
]
```

## A reference definition inside a blockquote is recognized (finding 7)

CommonMark allows a link reference definition inside a blockquote
container — `> [id]: /path` — and this codebase's Markdoc parser already
resolves it into a real link.

```ts
const quoted = "> [s]: /store/recipes/Soup.recipe.card\n\nSee [soup][s].\n";
JSON.stringify(extractReferenceDefinitions(quoted), null, 2)
=>
[
  {
    "path": "body:1:ref-def",
    "ref": "/store/recipes/Soup.recipe.card"
  }
]
```

A nested blockquote (`> > [id]: /path`) is recognized too:

```ts
const nestedQuoted = "> > [s]: /store/recipes/Soup.recipe.card\n\nSee [soup][s].\n";
JSON.stringify(extractReferenceDefinitions(nestedQuoted), null, 2)
=>
[
  {
    "path": "body:1:ref-def",
    "ref": "/store/recipes/Soup.recipe.card"
  }
]
```

## A reference definition inside a list item is recognized (finding 6, round 4 hardening)

CommonMark allows a link reference definition to be the first block inside a
list item — `- [id]: /path` — and this codebase's Markdoc parser already
resolves it into a real link. Before this fix, only the blockquote prefix was
stripped, so a list-contained definition was invisible to extraction (and to
the migration's rewriter and the hard link gate, which share this matcher).

```ts
const bulleted = "- [id]: /people/X.person.card\n\nSee [x][id].\n";
JSON.stringify(extractReferenceDefinitions(bulleted), null, 2)
=>
[
  {
    "path": "body:1:ref-def",
    "ref": "/people/X.person.card"
  }
]
```

`*` and `+` bullets, and an ordered marker (`1.` / `2)`), all work:

```ts
JSON.stringify({
  star: extractReferenceDefinitions("* [id]: /a.card").map((r) => r.ref),
  plus: extractReferenceDefinitions("+ [id]: /a.card").map((r) => r.ref),
  ordered: extractReferenceDefinitions("1. [id]: /a.card").map((r) => r.ref),
  orderedParen: extractReferenceDefinitions("2) [id]: /a.card").map((r) => r.ref),
})
=> {"star":["/a.card"],"plus":["/a.card"],"ordered":["/a.card"],"orderedParen":["/a.card"]}
```

A quoted list item (blockquote containing a list) strips both prefixes:

```ts
JSON.stringify(extractReferenceDefinitions("> - [id]: /people/X.person.card").map((r) => r.ref))
=> ["/people/X.person.card"]
```

## Malformed bodies are swallowed

A body that throws on parse is treated as "no refs" rather than crashing the
caller (validation/move would rather miss a warning than fail the card).

```ts
Array.isArray(extractBodyRefs("{% source ref=unclosed"))
=> true
```
