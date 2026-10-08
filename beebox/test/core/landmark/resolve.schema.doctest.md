# Landmark Schema and Resolution

A landmark card marks a directory as a notable spot in the box. It is
pure YAML frontmatter (no body): a `navigation` role holds a label, an
iconic symbol, and a curated list of links to other cards (hand-listed
and/or templated via `expand`); `destinations` mark the directory as a
filing target.

See `docs/landmarks.md` for the full design.

```ts setup
import { utimes } from "node:fs/promises";
import {
  createLandmarkTemplate,
  parseLandmarkFields,
} from "../../../src/schemas/landmark.js";
import { resolveLandmark } from "../../../src/core/landmark/resolve/core.js";
import { findDestination } from "../../../src/core/landmark/destination.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";

const card = (title: string) => `---\ntitle: ${title}\n---\n`;

// Resolve a `Recipes` landmark's navigation over a throwaway box holding
// `files` (box path -> title). `backdated` paths get a 2020 mtime, written first.
async function resolveIn(files: Record<string, string>, navigation, backdated: string[] = []) {
  const box = await makeTmpBox();
  try {
    for (const rel of backdated) await box.write(rel, card(files[rel]!));
    for (const rel of backdated) await utimes(box.path(rel), new Date(2020, 0, 1), new Date(2020, 0, 1));
    for (const [rel, title] of Object.entries(files)) if (!backdated.includes(rel)) await box.write(rel, card(title));
    return await resolveLandmark({ label: "Recipes", ...navigation }, {
      landmarkDir: box.path("_content/recipes"),
      landmarkPath: "_content/recipes/Recipes.landmark.card",
      boxRoot: box.root,
    });
  } finally {
    await box.cleanup();
  }
}
```

## Parsing a landmark's frontmatter

`parseLandmarkFields` reads a landmark file's frontmatter into a typed
object:

```ts
parseLandmarkFields(`---
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
`)
=>
{
  navigation: { label: "Recipes", symbol: "🍳", links: [{ ref: "Bread.recipe.card", label: "the bread" }] },
  destinations: [{ for: ["triage"], rules: "Recipes — anything describing how to cook a dish." }]
}
```

`prominence` is admitted the same way `symbol` is (`landmark.ts`): a written
value describes the place, not the file, so a reader must still see it.

```ts
parseLandmarkFields("---\nnavigation:\n  label: Logs\nprominence: background\n---\n").prominence
=> background
```

Presentation metadata is validated by the presentation reader. A malformed
system theme must not erase the landmark roles used by navigation, chat startup,
and root installation — a theme is decoration, and the roles are how the box is
navigated.

```ts
const badPrimitiveTheme = parseLandmarkFields("---\nnavigation:\n  label: Still here\ndestinations:\n  - for: [triage]\nsystem-theme: bogus\n---\n");
[badPrimitiveTheme?.navigation?.label, badPrimitiveTheme?.destinations?.[0]?.for, badPrimitiveTheme?.["system-theme"]]
=> ["Still here", ["triage"], null]
```

Malformed means the wrong SHAPE. A name or stock the engine does not recognize
is not malformed: theme names and stocks are an open set rather than a catalog
allowlist, so an unknown stock reaches the renderer as authored and falls back
there.

```ts
const unknownStock = parseLandmarkFields("---\nnavigation:\n  label: Also here\nsystem-theme:\n  name: paper\n  stock: purple\n---\n");
[unknownStock?.navigation?.label, unknownStock?.["system-theme"]]
=> ["Also here", { name: "paper", stock: "purple" }]
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

## Link resolution

A link to a file that doesn't exist still appears, with `exists: false`
(missing targets are flagged, not dropped). A link may point outside its own
directory; the resolved ref is normalized to box-relative. A leading-`/` ref
means the box root — the same form `bbx validate` and `bbx mv` understand (the
render layer used to resolve it against the OS filesystem root and report every
such link missing). A ref that climbs out of the box resolves to nothing and is
reported `exists: false`, never clamped to some other file.

```ts
const { links } = await resolveIn(
  { "_content/recipes/Bread.recipe.card": "Bread", "_content/docs/About.doc.card": "About", "_content/docs/Index.doc.card": "Index" },
  {
    links: [
      { ref: "Bread.recipe.card" },
      { ref: "Vanished.recipe.card" },
      { ref: "../docs/About.doc.card", label: "about" },
      { ref: "/_content/docs/Index.doc.card", label: "index" },
      { ref: "/_content/recipes/Gone.recipe.card" },
      { ref: "../../../../etc/hosts", label: "escape" },
    ],
  },
);
links.map((l) => ({ ref: l.ref, label: l.label, exists: l.exists }))
=>
[
  { ref: "_content/recipes/Bread.recipe.card", label: null, exists: true },
  { ref: "_content/recipes/Vanished.recipe.card", label: null, exists: false },
  { ref: "_content/docs/About.doc.card", label: "about", exists: true },
  { ref: "_content/docs/Index.doc.card", label: "index", exists: true },
  { ref: "_content/recipes/Gone.recipe.card", label: null, exists: false },
  { ref: "../../../../etc/hosts", label: "escape", exists: false }
]
```

## Expand: glob with default template

Without a template, `expand` emits one bare link per match, sorted
alphabetically by default.

```ts
const { links } = await resolveIn(
  { "_content/recipes/Carrot.recipe.card": "Carrot", "_content/recipes/Apple.recipe.card": "Apple", "_content/recipes/Bread.recipe.card": "Bread" },
  { expand: [{ query: "*.recipe.card" }] },
);
links.map((l) => l.ref)
=> ["_content/recipes/Apple.recipe.card", "_content/recipes/Bread.recipe.card", "_content/recipes/Carrot.recipe.card"]
```

## Expand: an escaping query yields no rows

An `expand` `query` glob is evaluated with the landmark's own directory as
cwd — a pattern that climbs out of the box namespace (e.g. into `src/`,
outside every underscore area) must never be read or reported, since its
frontmatter (title, template fields) would otherwise leak into the rendered
label. The match is silently dropped, not surfaced as a broken link.

```ts
const { links } = await resolveIn(
  { "_content/recipes/Bread.recipe.card": "Bread", "src/private.memo.card": "Secret Memo" },
  { expand: [{ query: "../../src/private.memo.card", "template-label": "${title}" }] },
);
links.length
=> 0
```

## Expand: generated refs are box paths

The default (no `template-ref`) emits the match's **box path** — the canonical
leading-`/` form — instead of the landmark-dir-relative path the glob returns,
so a generated ref means the same thing wherever it is read. It is resolved as
a literal path, so a directory literally named `attach/` is itself, not the
landmark's own attach scope (the `attach/` virtual prefix is for *authored*
refs). An authored `template-ref` keeps `${path}` dir-relative.

```ts
const { links } = await resolveIn(
  { "_content/recipes/attach/Filed.recipe.card": "Filed", "_content/recipes/Recipes.attach/Trap.recipe.card": "Trap" },
  { expand: [{ query: "attach/*.recipe.card" }] },
);
links.map((l) => ({ ref: l.ref, exists: l.exists }))
=> [{ ref: "_content/recipes/attach/Filed.recipe.card", exists: true }]
```

## Expand: template with ${path} and a frontmatter field

Template placeholders interpolate per match. `${path}` is the matched
card's path relative to the landmark's directory; any other `${field}`
reads that field from the matched card's frontmatter (replacing the old
XPath-over-XML evaluation).

```ts
const { links } = await resolveIn(
  { "_content/recipes/Bread.recipe.card": "Crusty Bread", "_content/recipes/Pasta.recipe.card": "Cacio e Pepe" },
  { expand: [{ query: "*.recipe.card", "template-ref": "${path}", "template-label": "${title}" }] },
);
links.map((l) => ({ ref: l.ref, label: l.label }))
=>
[
  { ref: "_content/recipes/Bread.recipe.card", label: "Crusty Bread" },
  { ref: "_content/recipes/Pasta.recipe.card", label: "Cacio e Pepe" }
]
```

## Dedup: hand-listed beats expanded

A card appearing in both a hand-listed link and an `expand` result shows
once — hand-listed links come first and keep their label.

```ts
const { links } = await resolveIn(
  { "_content/recipes/Bread.recipe.card": "Bread", "_content/recipes/Pasta.recipe.card": "Pasta" },
  { links: [{ ref: "Bread.recipe.card", label: "the bread" }], expand: [{ query: "*.recipe.card" }] },
);
links.map((l) => ({ ref: l.ref, label: l.label }))
=>
[
  { ref: "_content/recipes/Bread.recipe.card", label: "the bread" },
  { ref: "_content/recipes/Pasta.recipe.card", label: null }
]
```

## Named expand becomes a collapsible group

An `expand` carrying a `group` title stays grouped instead of flattening
into the flat `links`. The group reports a `count` and resolved
`children`; the flat list holds only the static link.

```ts
const resolved = await resolveIn(
  {
    "_content/recipes/Bread.recipe.card": "Bread",
    "_content/recipes/images/A.image.card": "A",
    "_content/recipes/images/B.image.card": "B",
  },
  { links: [{ ref: "Bread.recipe.card", label: "the bread" }], expand: [{ query: "images/*.image.card", group: "Images" }] },
);
({
  links: resolved.links.map((l) => l.ref),
  groups: resolved.groups.map((g) => ({ label: g.label, count: g.count, children: g.children.map((c) => c.ref) })),
})
=>
{
  links: ["_content/recipes/Bread.recipe.card"],
  groups: [{ label: "Images", count: 2, children: ["_content/recipes/images/A.image.card", "_content/recipes/images/B.image.card"] }]
}
```

## Order: modified-desc

`order: modified-desc` sorts matches by mtime, newest first.

```ts
const { links } = await resolveIn(
  { "_content/recipes/A.recipe.card": "A", "_content/recipes/B.recipe.card": "B" },
  { expand: [{ query: "*.recipe.card", order: "modified-desc" }] },
  ["_content/recipes/A.recipe.card"], // backdated so B is newer
);
links.map((l) => l.ref)
=> ["_content/recipes/B.recipe.card", "_content/recipes/A.recipe.card"]
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
```

A landmark without a matching destination returns null:

```ts continue
const navOnly = parseLandmarkFields("---\nnavigation:\n  label: Just a bookmark\n---\n");
findDestination(navOnly.destinations, "triage")
=> null
```
