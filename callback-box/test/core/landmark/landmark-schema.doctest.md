# Landmark Schema and Resolution

A landmark card marks a directory as a notable spot in the box. It is
pure YAML frontmatter (no body): a `navigation` role holds a label, an
iconic symbol, and a curated list of links to other cards (hand-listed
and/or templated via `expand`); `destinations` mark the directory as a
filing target.

See `docs/landmarks.md` for the full design.

```ts setup
import {
  LandmarkSchema,
  createLandmarkTemplate,
  parseLandmarkFields,
  getCardTypes,
} from "../../../src/schemas/index.js";
import { resolveLandmark } from "../../../src/core/landmark/resolve.js";
import { findDestination } from "../../../src/core/landmark/destination.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
```

## Schema registration

Landmark is a built-in frontmatter card type:

```ts
getCardTypes().includes("landmark")
=> true

LandmarkSchema.type
=> landmark
```

## Parsing a landmark's frontmatter

`parseLandmarkFields` reads a landmark file's frontmatter into a typed
object:

```ts
const fields = parseLandmarkFields(`---
navigation:
  label: Recipes
  symbol: 🍳
  links:
    - ref: Bread.recipe.card
      label: the bread
destinations:
  - for: [triage]
    rules: Recipes — anything describing how to cook a dish.
---
`);
JSON.stringify(fields, null, 2)
=>
{
  "navigation": {
    "label": "Recipes",
    "symbol": "🍳",
    "links": [
      {
        "ref": "Bread.recipe.card",
        "label": "the bread"
      }
    ]
  },
  "destinations": [
    {
      "for": [
        "triage"
      ],
      "rules": "Recipes — anything describing how to cook a dish."
    }
  ]
}
```

## Template

`createLandmarkTemplate` produces a starter card with a `navigation`
role holding the label and a text symbol:

```ts
createLandmarkTemplate({ label: "Recipes", symbol: "🍳" })
=>
---
navigation:
  label: Recipes
  symbol: 🍳
---
```

An image symbol becomes a `{ src }` mapping:

```ts
createLandmarkTemplate({ label: "Character", symbolSrc: "images/portrait.webp" })
=>
---
navigation:
  label: Character
  symbol:
    src: images/portrait.webp
---
```

## Hand-listed links

A `navigation` with two `links` resolves to a flat list. `label` is the
per-landmark label; `ref` is normalized to a box-relative path.

```ts
const box = await makeTmpBox();
await box.write("store/recipes/Bread.recipe.card", "---\ntitle: Bread\n---\n");
await box.write("store/recipes/Pasta.recipe.card", "---\ntitle: Pasta\n---\n");

const navigation = {
  label: "Recipes",
  symbol: "🍳",
  links: [
    { ref: "Bread.recipe.card", label: "the bread" },
    { ref: "Pasta.recipe.card" },
  ],
};
const links = await resolveLandmark(navigation, {
  landmarkDir: box.path("store/recipes"),
  boxRoot: box.root,
});

JSON.stringify(links.map((l) => ({ ref: l.ref, label: l.label, exists: l.exists })), null, 2)
=>
[
  {
    "ref": "store/recipes/Bread.recipe.card",
    "label": "the bread",
    "exists": true
  },
  {
    "ref": "store/recipes/Pasta.recipe.card",
    "label": null,
    "exists": true
  }
]
```

```ts cleanup
await box.cleanup();
```

## Missing targets are flagged but not dropped

A link to a file that doesn't exist still appears, with `exists: false`:

```ts
const box = await makeTmpBox();
await box.write("store/recipes/Bread.recipe.card", "---\ntitle: Bread\n---\n");

const navigation = {
  label: "Recipes",
  links: [
    { ref: "Bread.recipe.card" },
    { ref: "Vanished.recipe.card" },
  ],
};
const links = await resolveLandmark(navigation, {
  landmarkDir: box.path("store/recipes"),
  boxRoot: box.root,
});

JSON.stringify(links.map((l) => ({ ref: l.ref, exists: l.exists })), null, 2)
=>
[
  {
    "ref": "store/recipes/Bread.recipe.card",
    "exists": true
  },
  {
    "ref": "store/recipes/Vanished.recipe.card",
    "exists": false
  }
]
```

```ts cleanup
await box.cleanup();
```

## Expand: glob with default template

Without a template, `expand` emits one bare link per match, sorted
alphabetically by default.

```ts
const box = await makeTmpBox();
await box.write("store/recipes/Apple.recipe.card", "---\ntitle: Apple\n---\n");
await box.write("store/recipes/Bread.recipe.card", "---\ntitle: Bread\n---\n");
await box.write("store/recipes/Carrot.recipe.card", "---\ntitle: Carrot\n---\n");

const navigation = { label: "Recipes", expand: [{ query: "*.recipe.card" }] };
const links = await resolveLandmark(navigation, {
  landmarkDir: box.path("store/recipes"),
  boxRoot: box.root,
});

links.map((l) => l.ref).join("\n")
=>
store/recipes/Apple.recipe.card
store/recipes/Bread.recipe.card
store/recipes/Carrot.recipe.card
```

```ts cleanup
await box.cleanup();
```

## Expand: template with ${path} and a frontmatter field

Template placeholders interpolate per match. `${path}` is the matched
card's path relative to the landmark's directory; any other `${field}`
reads that field from the matched card's frontmatter (replacing the old
XPath-over-XML evaluation).

```ts
const box = await makeTmpBox();
await box.write("store/recipes/Bread.recipe.card", "---\ntitle: Crusty Bread\n---\n");
await box.write("store/recipes/Pasta.recipe.card", "---\ntitle: Cacio e Pepe\n---\n");

const navigation = {
  label: "Recipes",
  expand: [{ query: "*.recipe.card", "template-ref": "${path}", "template-label": "${title}" }],
};
const links = await resolveLandmark(navigation, {
  landmarkDir: box.path("store/recipes"),
  boxRoot: box.root,
});

JSON.stringify(links.map((l) => ({ ref: l.ref, label: l.label })), null, 2)
=>
[
  {
    "ref": "store/recipes/Bread.recipe.card",
    "label": "Crusty Bread"
  },
  {
    "ref": "store/recipes/Pasta.recipe.card",
    "label": "Cacio e Pepe"
  }
]
```

```ts cleanup
await box.cleanup();
```

## Dedup: hand-listed beats expanded

A card appearing in both a hand-listed link and an `expand` result shows
once — hand-listed links come first and keep their label.

```ts
const box = await makeTmpBox();
await box.write("store/recipes/Bread.recipe.card", "---\ntitle: Bread\n---\n");
await box.write("store/recipes/Pasta.recipe.card", "---\ntitle: Pasta\n---\n");

const navigation = {
  label: "Recipes",
  links: [{ ref: "Bread.recipe.card", label: "the bread" }],
  expand: [{ query: "*.recipe.card" }],
};
const links = await resolveLandmark(navigation, {
  landmarkDir: box.path("store/recipes"),
  boxRoot: box.root,
});

JSON.stringify(links.map((l) => ({ ref: l.ref, label: l.label })), null, 2)
=>
[
  {
    "ref": "store/recipes/Bread.recipe.card",
    "label": "the bread"
  },
  {
    "ref": "store/recipes/Pasta.recipe.card",
    "label": null
  }
]
```

```ts cleanup
await box.cleanup();
```

## Order: modified-desc

`order: modified-desc` sorts matches by mtime, newest first.

```ts
const box = await makeTmpBox();
await box.write("store/recipes/A.recipe.card", "---\ntitle: A\n---\n");
// Backdate A so B is newer.
const aPath = box.path("store/recipes/A.recipe.card");
const { utimes } = await import("node:fs/promises");
await utimes(aPath, new Date(2020, 0, 1), new Date(2020, 0, 1));
await box.write("store/recipes/B.recipe.card", "---\ntitle: B\n---\n");

const navigation = { label: "Recipes", expand: [{ query: "*.recipe.card", order: "modified-desc" }] };
const links = await resolveLandmark(navigation, {
  landmarkDir: box.path("store/recipes"),
  boxRoot: box.root,
});

links.map((l) => l.ref).join("\n")
=>
store/recipes/B.recipe.card
store/recipes/A.recipe.card
```

```ts cleanup
await box.cleanup();
```

## Cross-directory references

A link may point outside its own directory; the resolved ref is
normalized to box-relative.

```ts
const box = await makeTmpBox();
await box.write("store/recipes/Bread.recipe.card", "---\ntitle: Bread\n---\n");
await box.write("docs/About.doc.card", "---\ntitle: About\n---\n");

const navigation = {
  label: "Recipes",
  links: [
    { ref: "Bread.recipe.card" },
    { ref: "../../docs/About.doc.card", label: "about" },
  ],
};
const links = await resolveLandmark(navigation, {
  landmarkDir: box.path("store/recipes"),
  boxRoot: box.root,
});

JSON.stringify(links.map((l) => ({ ref: l.ref, label: l.label, exists: l.exists })), null, 2)
=>
[
  {
    "ref": "store/recipes/Bread.recipe.card",
    "label": null,
    "exists": true
  },
  {
    "ref": "docs/About.doc.card",
    "label": "about",
    "exists": true
  }
]
```

```ts cleanup
await box.cleanup();
```

## Destinations: `for` kinds

`findDestination` locates the destination advertising a given kind among
a landmark's `destinations`.

```ts
const fields = parseLandmarkFields(`---
navigation:
  label: Reading
  symbol: 📖
destinations:
  - for: [triage, commentary]
    rules: Articles saved for close reading and commentary.
---
`);
const dest = findDestination(fields.destinations, "commentary");
JSON.stringify(dest.for)
=> ["triage","commentary"]

findDestination(fields.destinations, "triage") === dest
=> true

findDestination(fields.destinations, "commentary") === dest
=> true
```

A landmark without a matching destination returns null:

```ts continue
const navOnly = parseLandmarkFields("---\nnavigation:\n  label: Just a bookmark\n---\n");
findDestination(navOnly.destinations, "triage")
=> null
```
