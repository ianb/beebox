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

`prominence` is admitted the same way `symbol` is (`landmark.ts`): a written
value describes the place, not the file, so a reader must still see it.

```ts continue
const withProminence = parseLandmarkFields(`---
navigation:
  label: Logs
prominence: background
---
`);
withProminence.prominence
=> background
```

Presentation metadata is validated by the presentation reader. A malformed
system theme must not erase the landmark roles used by navigation, chat startup,
and root installation — a theme is decoration, and the roles are how the box is
navigated.

```ts
const badPrimitiveTheme = parseLandmarkFields("---\nnavigation:\n  label: Still here\ndestinations:\n  - for: [triage]\nsystem-theme: bogus\n---\n");
JSON.stringify([badPrimitiveTheme?.navigation?.label, badPrimitiveTheme?.destinations?.[0]?.for, badPrimitiveTheme?.["system-theme"]])
=> ["Still here",["triage"],null]
```

Malformed means the wrong SHAPE. A name or stock the engine does not recognize
is not malformed: theme names and stocks are an open set rather than a catalog
allowlist, so an unknown stock reaches the renderer as authored and falls back
there.

```ts continue
const unknownStock = parseLandmarkFields("---\nnavigation:\n  label: Also here\nsystem-theme:\n  name: paper\n  stock: purple\n---\n");
JSON.stringify([unknownStock?.navigation?.label, unknownStock?.["system-theme"]])
=> ["Also here",{"name":"paper","stock":"purple"}]
```

## Template

`createLandmarkTemplate` produces a starter card with a `navigation` role for
the label and the card's own `symbol` group for the mark. A new landmark is
never written in the legacy `navigation.symbol` shape — that is read for boxes
that predate the `landmark-symbol` migration and written by nothing.

```ts
createLandmarkTemplate({ label: "Recipes", symbol: "🍳" })
=>
---
navigation:
  label: Recipes
symbol:
  glyph: 🍳
---
```

An image symbol becomes a `{ src }` mapping under the same key:

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
await box.write("_content/recipes/Bread.recipe.card", "---\ntitle: Bread\n---\n");
await box.write("_content/recipes/Pasta.recipe.card", "---\ntitle: Pasta\n---\n");

const navigation = {
  label: "Recipes",
  symbol: "🍳",
  links: [
    { ref: "Bread.recipe.card", label: "the bread" },
    { ref: "Pasta.recipe.card" },
  ],
};
const { links } = await resolveLandmark(navigation, {
  landmarkDir: box.path("_content/recipes"),
  landmarkPath: "_content/recipes/Recipes.landmark.card",
  boxRoot: box.root,
});

JSON.stringify(links.map((l) => ({ ref: l.ref, label: l.label, exists: l.exists })), null, 2)
=>
[
  {
    "ref": "_content/recipes/Bread.recipe.card",
    "label": "the bread",
    "exists": true
  },
  {
    "ref": "_content/recipes/Pasta.recipe.card",
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
await box.write("_content/recipes/Bread.recipe.card", "---\ntitle: Bread\n---\n");

const navigation = {
  label: "Recipes",
  links: [
    { ref: "Bread.recipe.card" },
    { ref: "Vanished.recipe.card" },
  ],
};
const { links } = await resolveLandmark(navigation, {
  landmarkDir: box.path("_content/recipes"),
  landmarkPath: "_content/recipes/Recipes.landmark.card",
  boxRoot: box.root,
});

JSON.stringify(links.map((l) => ({ ref: l.ref, exists: l.exists })), null, 2)
=>
[
  {
    "ref": "_content/recipes/Bread.recipe.card",
    "exists": true
  },
  {
    "ref": "_content/recipes/Vanished.recipe.card",
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
await box.write("_content/recipes/Apple.recipe.card", "---\ntitle: Apple\n---\n");
await box.write("_content/recipes/Bread.recipe.card", "---\ntitle: Bread\n---\n");
await box.write("_content/recipes/Carrot.recipe.card", "---\ntitle: Carrot\n---\n");

const navigation = { label: "Recipes", expand: [{ query: "*.recipe.card" }] };
const { links } = await resolveLandmark(navigation, {
  landmarkDir: box.path("_content/recipes"),
  landmarkPath: "_content/recipes/Recipes.landmark.card",
  boxRoot: box.root,
});

links.map((l) => l.ref).join("\n")
=>
_content/recipes/Apple.recipe.card
_content/recipes/Bread.recipe.card
_content/recipes/Carrot.recipe.card
```

```ts cleanup
await box.cleanup();
```

## Expand: an escaping query yields no rows

An `expand` `query` glob is evaluated with the landmark's own directory as
cwd — a pattern that climbs out of the box namespace (e.g. into `src/`,
outside every underscore area) must never be read or reported, since its
frontmatter (title, template fields) would otherwise leak into the rendered
label. The match is silently dropped, not surfaced as a broken link.

```ts
const box = await makeTmpBox();
await box.write("_content/recipes/Bread.recipe.card", "---\ntitle: Bread\n---\n");
await box.write("src/private.memo.card", "---\ntitle: Secret Memo\n---\n");

const navigation = {
  label: "Recipes",
  expand: [{ query: "../../src/private.memo.card", "template-label": "${title}" }],
};
const { links } = await resolveLandmark(navigation, {
  landmarkDir: box.path("_content/recipes"),
  landmarkPath: "_content/recipes/Recipes.landmark.card",
  boxRoot: box.root,
});

links.length
=> 0
```

Normal in-namespace expansion still works alongside it:

```ts continue
const navigation2 = { label: "Recipes", expand: [{ query: "*.recipe.card" }] };
const { links: links2 } = await resolveLandmark(navigation2, {
  landmarkDir: box.path("_content/recipes"),
  landmarkPath: "_content/recipes/Recipes.landmark.card",
  boxRoot: box.root,
});

links2.map((l) => l.ref).join("\n")
=>
_content/recipes/Bread.recipe.card
```

```ts cleanup
await box.cleanup();
```

## Expand: generated refs are box paths

The default (no `template-ref`) emits the match's **box path** — the canonical
leading-`/` form — instead of the landmark-dir-relative path the glob returns,
so a generated ref means the same thing wherever it is read. It is resolved as
a literal path, so a directory literally named `attach/` is itself, not the
landmark's own attach scope (the `attach/` virtual prefix is for *authored*
refs). An authored `template-ref` keeps `${path}` dir-relative.

```ts
const box = await makeTmpBox();
await box.write("_content/recipes/attach/Filed.recipe.card", "---\ntitle: Filed\n---\n");
await box.write("_content/recipes/Recipes.attach/Trap.recipe.card", "---\ntitle: Trap\n---\n");

const navigation = { label: "Recipes", expand: [{ query: "attach/*.recipe.card" }] };
const { links } = await resolveLandmark(navigation, {
  landmarkDir: box.path("_content/recipes"),
  landmarkPath: "_content/recipes/Recipes.landmark.card",
  boxRoot: box.root,
});

JSON.stringify(links.map((l) => ({ ref: l.ref, exists: l.exists })), null, 2)
=>
[
  {
    "ref": "_content/recipes/attach/Filed.recipe.card",
    "exists": true
  }
]
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
await box.write("_content/recipes/Bread.recipe.card", "---\ntitle: Crusty Bread\n---\n");
await box.write("_content/recipes/Pasta.recipe.card", "---\ntitle: Cacio e Pepe\n---\n");

const navigation = {
  label: "Recipes",
  expand: [{ query: "*.recipe.card", "template-ref": "${path}", "template-label": "${title}" }],
};
const { links } = await resolveLandmark(navigation, {
  landmarkDir: box.path("_content/recipes"),
  landmarkPath: "_content/recipes/Recipes.landmark.card",
  boxRoot: box.root,
});

JSON.stringify(links.map((l) => ({ ref: l.ref, label: l.label })), null, 2)
=>
[
  {
    "ref": "_content/recipes/Bread.recipe.card",
    "label": "Crusty Bread"
  },
  {
    "ref": "_content/recipes/Pasta.recipe.card",
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
await box.write("_content/recipes/Bread.recipe.card", "---\ntitle: Bread\n---\n");
await box.write("_content/recipes/Pasta.recipe.card", "---\ntitle: Pasta\n---\n");

const navigation = {
  label: "Recipes",
  links: [{ ref: "Bread.recipe.card", label: "the bread" }],
  expand: [{ query: "*.recipe.card" }],
};
const { links } = await resolveLandmark(navigation, {
  landmarkDir: box.path("_content/recipes"),
  landmarkPath: "_content/recipes/Recipes.landmark.card",
  boxRoot: box.root,
});

JSON.stringify(links.map((l) => ({ ref: l.ref, label: l.label })), null, 2)
=>
[
  {
    "ref": "_content/recipes/Bread.recipe.card",
    "label": "the bread"
  },
  {
    "ref": "_content/recipes/Pasta.recipe.card",
    "label": null
  }
]
```

```ts cleanup
await box.cleanup();
```

## Named expand becomes a collapsible group

An `expand` carrying a `group` title stays grouped instead of flattening
into the flat `links`. The group reports a `count` and resolved
`children`; the flat list holds only the static link.

```ts
const box = await makeTmpBox();
await box.write("_content/recipes/Bread.recipe.card", "---\ntitle: Bread\n---\n");
await box.write("_content/recipes/images/A.image.card", "---\ntitle: A\n---\n");
await box.write("_content/recipes/images/B.image.card", "---\ntitle: B\n---\n");

const navigation = {
  label: "Recipes",
  links: [{ ref: "Bread.recipe.card", label: "the bread" }],
  expand: [{ query: "images/*.image.card", group: "Images" }],
};
const resolved = await resolveLandmark(navigation, {
  landmarkDir: box.path("_content/recipes"),
  landmarkPath: "_content/recipes/Recipes.landmark.card",
  boxRoot: box.root,
});

JSON.stringify({
  links: resolved.links.map((l) => l.ref),
  groups: resolved.groups.map((g) => ({
    label: g.label,
    count: g.count,
    children: g.children.map((c) => c.ref),
  })),
}, null, 2)
=>
{
  "links": [
    "_content/recipes/Bread.recipe.card"
  ],
  "groups": [
    {
      "label": "Images",
      "count": 2,
      "children": [
        "_content/recipes/images/A.image.card",
        "_content/recipes/images/B.image.card"
      ]
    }
  ]
}
```

```ts cleanup
await box.cleanup();
```

## Order: modified-desc

`order: modified-desc` sorts matches by mtime, newest first.

```ts
const box = await makeTmpBox();
await box.write("_content/recipes/A.recipe.card", "---\ntitle: A\n---\n");
// Backdate A so B is newer.
const aPath = box.path("_content/recipes/A.recipe.card");
const { utimes } = await import("node:fs/promises");
await utimes(aPath, new Date(2020, 0, 1), new Date(2020, 0, 1));
await box.write("_content/recipes/B.recipe.card", "---\ntitle: B\n---\n");

const navigation = { label: "Recipes", expand: [{ query: "*.recipe.card", order: "modified-desc" }] };
const { links } = await resolveLandmark(navigation, {
  landmarkDir: box.path("_content/recipes"),
  landmarkPath: "_content/recipes/Recipes.landmark.card",
  boxRoot: box.root,
});

links.map((l) => l.ref).join("\n")
=>
_content/recipes/B.recipe.card
_content/recipes/A.recipe.card
```

```ts cleanup
await box.cleanup();
```

## Cross-directory references

A link may point outside its own directory; the resolved ref is
normalized to box-relative.

```ts
const box = await makeTmpBox();
await box.write("_content/recipes/Bread.recipe.card", "---\ntitle: Bread\n---\n");
await box.write("_content/docs/About.doc.card", "---\ntitle: About\n---\n");

const navigation = {
  label: "Recipes",
  links: [
    { ref: "Bread.recipe.card" },
    { ref: "../docs/About.doc.card", label: "about" },
  ],
};
const { links } = await resolveLandmark(navigation, {
  landmarkDir: box.path("_content/recipes"),
  landmarkPath: "_content/recipes/Recipes.landmark.card",
  boxRoot: box.root,
});

JSON.stringify(links.map((l) => ({ ref: l.ref, label: l.label, exists: l.exists })), null, 2)
=>
[
  {
    "ref": "_content/recipes/Bread.recipe.card",
    "label": null,
    "exists": true
  },
  {
    "ref": "_content/docs/About.doc.card",
    "label": "about",
    "exists": true
  }
]
```

```ts cleanup
await box.cleanup();
```

## Box-root refs render; escaping refs are missing

A leading-`/` ref means the box root — the same form `bbx validate` and `bbx mv`
understand (the render layer used to resolve it against the OS filesystem root
and report every such link missing). A ref that climbs out of the box resolves
to nothing and is reported `exists: false`, never clamped to some other file.

```ts
const box = await makeTmpBox();
await box.write("_content/recipes/Bread.recipe.card", "---\ntitle: Bread\n---\n");
await box.write("_content/docs/About.doc.card", "---\ntitle: About\n---\n");

const navigation = {
  label: "Recipes",
  links: [
    { ref: "/_content/docs/About.doc.card", label: "about" },
    { ref: "/_content/recipes/Gone.recipe.card" },
    { ref: "../../../../etc/hosts", label: "escape" },
  ],
};
const { links } = await resolveLandmark(navigation, {
  landmarkDir: box.path("_content/recipes"),
  landmarkPath: "_content/recipes/Recipes.landmark.card",
  boxRoot: box.root,
});

JSON.stringify(links.map((l) => ({ ref: l.ref, label: l.label, exists: l.exists })), null, 2)
=>
[
  {
    "ref": "_content/docs/About.doc.card",
    "label": "about",
    "exists": true
  },
  {
    "ref": "_content/recipes/Gone.recipe.card",
    "label": null,
    "exists": false
  },
  {
    "ref": "../../../../etc/hosts",
    "label": "escape",
    "exists": false
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
