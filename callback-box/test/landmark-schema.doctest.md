# Landmark Schema and Resolution

A landmark card marks a directory as a notable spot in the box. A
landmark carries one or more *role* child elements; the `<navigation>`
role holds a label, an iconic symbol, and a curated list of links
to other cards (hand-listed and/or templated via `<expand>`).

See `docs/landmarks.md` for the full design.

```ts setup
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import {
  LandmarkSchema,
  createLandmarkTemplate,
  getCardTypes,
  createSchemaRegistry,
} from "../src/schemas/index.js";
import { parseCard } from "cardworks";
import { resolveLandmark } from "../src/core/landmark/resolve.js";
import { makeTmpBox } from "./helpers/doctest-helpers.js";
```

## Schema registration

Landmark is one of the built-in card types:

```
getCardTypes().includes("landmark")
=> true

LandmarkSchema.tagName
=> landmark

const registry = await createSchemaRegistry();
registry.get("landmark")?.tagName
=> landmark
```

## Template

`createLandmarkTemplate` produces a starter card wrapping label and symbol in the `<navigation>` role:

```
createLandmarkTemplate({ label: "Recipes", symbol: "🍳" })
=>
<landmark>
<navigation>
<label>Recipes</label>
<symbol>🍳</symbol>
</navigation>
</landmark>
```

Special characters in label are XML-escaped:

```
createLandmarkTemplate({ label: "A & B", symbol: "📍" })
=>
<landmark>
<navigation>
<label>A &amp; B</label>
<symbol>📍</symbol>
</navigation>
</landmark>
```

## Image symbols

`<symbol>` accepts either text (emoji) or an `src` attribute pointing
at an image. Both forms validate cleanly.

```
const xml = `<landmark>
<navigation>
<label>Character</label>
<symbol src="images/portrait.webp"/>
</navigation>
</landmark>`;

const root = await parseCard(xml, { source: "test.xml" });
const nav = root.children.find((c) => c.tagName === "navigation");
const symbolEl = nav.children.find((c) => c.tagName === "symbol");
JSON.stringify({ src: symbolEl.attrs.src, text: symbolEl.text || "" }, null, 2)
=>
{
  "src": "images/portrait.webp",
  "text": ""
}
```

## Hand-listed links

A landmark with two `<link>` references resolves to a flat list. Inner
text becomes the per-landmark `label`; `ref` is normalized to a
box-relative path.

```
const box = await makeTmpBox();
await box.write("store/recipes/Bread.recipe.card", "<recipe><title>Bread</title></recipe>");
await box.write("store/recipes/Pasta.recipe.card", "<recipe><title>Pasta</title></recipe>");

const xml = `<landmark>
<navigation>
<label>Recipes</label>
<symbol>🍳</symbol>
<link ref="Bread.recipe.card">the bread</link>
<link ref="Pasta.recipe.card"/>
</navigation>
</landmark>`;

const root = await parseCard(xml, { source: "test.xml" });
const links = await resolveLandmark(root, {
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

```cleanup
await box.cleanup();
```

## Missing targets are flagged but not dropped

A `<link>` to a file that doesn't exist still appears, with `exists: false`:

```
const box = await makeTmpBox();
await box.write("store/recipes/Bread.recipe.card", "<recipe><title>Bread</title></recipe>");

const xml = `<landmark>
<navigation>
<label>Recipes</label>
<symbol>🍳</symbol>
<link ref="Bread.recipe.card"/>
<link ref="Vanished.recipe.card"/>
</navigation>
</landmark>`;

const root = await parseCard(xml, { source: "test.xml" });
const links = await resolveLandmark(root, {
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

```cleanup
await box.cleanup();
```

## Expand: glob with default template

Without a template body, `<expand>` emits one bare link per match,
sorted alphabetically by default.

```
const box = await makeTmpBox();
await box.write("store/recipes/Apple.recipe.card", "<recipe><title>Apple</title></recipe>");
await box.write("store/recipes/Bread.recipe.card", "<recipe><title>Bread</title></recipe>");
await box.write("store/recipes/Carrot.recipe.card", "<recipe><title>Carrot</title></recipe>");

const xml = `<landmark>
<navigation>
<label>Recipes</label>
<symbol>🍳</symbol>
<expand query="*.recipe.card"/>
</navigation>
</landmark>`;

const root = await parseCard(xml, { source: "test.xml" });
const links = await resolveLandmark(root, {
  landmarkDir: box.path("store/recipes"),
  boxRoot: box.root,
});

links.map((l) => l.ref).join("\n")
=>
store/recipes/Apple.recipe.card
store/recipes/Bread.recipe.card
store/recipes/Carrot.recipe.card
```

```cleanup
await box.cleanup();
```

## Expand: template with ${path} and ${title}

Template placeholders interpolate per match. Templates use
`template-ref="..."` (not `ref="..."`) so the cardworks ref-checker
doesn't try to resolve the placeholder as a real path. `${path}` is
the matched card's path relative to the landmark's directory; any
other expression is XPath-evaluated against the matched card's root.

```
const box = await makeTmpBox();
await box.write("store/recipes/Bread.recipe.card", "<recipe><title>Crusty Bread</title></recipe>");
await box.write("store/recipes/Pasta.recipe.card", "<recipe><title>Cacio e Pepe</title></recipe>");

const xml = `<landmark>
<navigation>
<label>Recipes</label>
<symbol>🍳</symbol>
<expand query="*.recipe.card">
<link template-ref="\${path}">\${title}</link>
</expand>
</navigation>
</landmark>`;

const root = await parseCard(xml, { source: "test.xml" });
const links = await resolveLandmark(root, {
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

```cleanup
await box.cleanup();
```

## Dedup: hand-listed beats expanded

A card appearing in both a hand-listed `<link>` and an `<expand>`
result shows once — first occurrence in source order wins, including
its label.

```
const box = await makeTmpBox();
await box.write("store/recipes/Bread.recipe.card", "<recipe><title>Bread</title></recipe>");
await box.write("store/recipes/Pasta.recipe.card", "<recipe><title>Pasta</title></recipe>");

const xml = `<landmark>
<navigation>
<label>Recipes</label>
<symbol>🍳</symbol>
<link ref="Bread.recipe.card">the bread</link>
<expand query="*.recipe.card"/>
</navigation>
</landmark>`;

const root = await parseCard(xml, { source: "test.xml" });
const links = await resolveLandmark(root, {
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

```cleanup
await box.cleanup();
```

## Order: modified-desc

`order="modified-desc"` sorts matches by mtime, newest first.

```
const box = await makeTmpBox();
await box.write("store/recipes/A.recipe.card", "<recipe/>");
// Backdate A so B is newer.
const aPath = box.path("store/recipes/A.recipe.card");
const { utimes } = await import("node:fs/promises");
await utimes(aPath, new Date(2020, 0, 1), new Date(2020, 0, 1));
await box.write("store/recipes/B.recipe.card", "<recipe/>");

const xml = `<landmark>
<navigation>
<label>Recipes</label>
<symbol>🍳</symbol>
<expand query="*.recipe.card" order="modified-desc"/>
</navigation>
</landmark>`;

const root = await parseCard(xml, { source: "test.xml" });
const links = await resolveLandmark(root, {
  landmarkDir: box.path("store/recipes"),
  boxRoot: box.root,
});

links.map((l) => l.ref).join("\n")
=>
store/recipes/B.recipe.card
store/recipes/A.recipe.card
```

```cleanup
await box.cleanup();
```

## Cross-directory references

A `<link ref="...">` may point outside its own directory; the
resolved ref is normalized to box-relative.

```
const box = await makeTmpBox();
await box.write("store/recipes/Bread.recipe.card", "<recipe/>");
await box.write("docs/About.doc.card", "<doc/>");

const xml = `<landmark>
<navigation>
<label>Recipes</label>
<symbol>🍳</symbol>
<link ref="Bread.recipe.card"/>
<link ref="../../docs/About.doc.card">about</link>
</navigation>
</landmark>`;

const root = await parseCard(xml, { source: "test.xml" });
const links = await resolveLandmark(root, {
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

```cleanup
await box.cleanup();
```
