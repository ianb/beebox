// # Landmark Schema and Resolution
//
// A landmark card marks a directory as a notable spot in the box. It is
// pure YAML frontmatter (no body): a `navigation` role holds a label, an
// iconic symbol, and a curated list of links to other cards (hand-listed
// and/or templated via `expand`); `destinations` mark the directory as a
// filing target.
//
// See `docs/landmarks.md` for the full design.

import { test } from "tap";
import "agent-doctest/tap";
import assert from "node:assert/strict";
import { utimes } from "node:fs/promises";
import {
  createLandmarkTemplate,
  parseLandmarkFields,
  type LandmarkNavigationData,
} from "../../../src/schemas/landmark.js";
import { resolveLandmark } from "../../../src/core/landmark/resolve/core.js";
import { createCardSchemaMap } from "../../../src/schemas.js";
import { findDestination } from "../../../src/core/landmark/destination.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";

const card = (title: string) => `---\ntitle: ${title}\n---\n`;

// Resolve a `Recipes` landmark's navigation over a throwaway box holding
// `files` (box path -> title). `backdated` paths get a 2020 mtime, written first.
async function resolveIn({ files, navigation, backdated }: { files: Record<string, string>; navigation: Partial<LandmarkNavigationData>; backdated?: string[] }) {
  const box = await makeTmpBox();
  const backdatedPaths = backdated ?? [];
  try {
    for (const rel of backdatedPaths) await box.write(rel, card(files[rel]!));
    for (const rel of backdatedPaths) await utimes(box.path(rel), new Date(2020, 0, 1), new Date(2020, 0, 1));
    for (const [rel, title] of Object.entries(files)) if (!backdatedPaths.includes(rel)) await box.write(rel, card(title));
    return await resolveLandmark({ label: "Recipes", ...navigation }, {
      landmarkDir: box.path("_content/recipes"),
      landmarkPath: "_content/recipes/Recipes.landmark.card",
      boxRoot: box.root,
      cardSchemas: await createCardSchemaMap(box.root),
    });
  } finally {
    await box.cleanup();
  }
}

// ## Parsing a landmark's frontmatter
//
// `parseLandmarkFields` reads a landmark file's frontmatter into a typed
// object:
void test("parseLandmarkFields reads a landmark file's frontmatter into a typed object:", async (t) => {
  // doctest:L52
  t.check(
    parseLandmarkFields(`---
navigation:
  label: Recipes
  links:
    - ref: Bread.recipe.card
      label: the bread
destinations:
  - for: [triage]
    rules: Recipes — anything describing how to cook a dish.
---
`),
    {
    navigation: {
      label: "Recipes",
      links: [
        {
          ref: "Bread.recipe.card",
          label: "the bread",
        },
      ],
    },
    destinations: [
      {
        for: [
          "triage",
        ],
        rules: "Recipes — anything describing how to cook a dish.",
      },
    ],
  },
  );
});

// `prominence` is admitted the same way `symbol` is (`landmark.ts`): a written
// value describes the place, not the file, so a reader must still see it.
void test("prominence is admitted the same way symbol is (landmark.ts):", async (t) => {
  // doctest:L74
  t.check(parseLandmarkFields("---\nnavigation:\n  label: Logs\nprominence: background\n---\n")?.prominence, "background");
});

// Presentation metadata is validated by the presentation reader. A malformed
// system theme must not erase the landmark roles used by navigation, chat startup,
// and root installation — a theme is decoration, and the roles are how the box is
// navigated.
void test("Presentation metadata is validated by the presentation reader.", async (t) => {
  // doctest:L84
  const badPrimitiveTheme = parseLandmarkFields("---\nnavigation:\n  label: Still here\ndestinations:\n  - for: [triage]\nsystem-theme: bogus\n---\n");
  await t.checkText([badPrimitiveTheme?.navigation?.label, badPrimitiveTheme?.destinations?.[0]?.for, badPrimitiveTheme?.["system-theme"]], "[\"Still here\", [\"triage\"], null]");
});

// Malformed means the wrong SHAPE. A name or stock the engine does not recognize
// is not malformed: theme names and stocks are an open set rather than a catalog
// allowlist, so an unknown stock reaches the renderer as authored and falls back
// there.
void test("Malformed means the wrong SHAPE.", async (t) => {
  // doctest:L95
  const unknownStock = parseLandmarkFields("---\nnavigation:\n  label: Also here\nsystem-theme:\n  name: paper\n  stock: purple\n---\n");
  t.check([unknownStock?.navigation?.label, unknownStock?.["system-theme"]], [
    "Also here",
    {
      name: "paper",
      stock: "purple",
    },
  ]);
});

// ## Template
//
// `createLandmarkTemplate` produces a starter card with a `navigation` role for
// the label and the card's own `symbol` group for the mark. The mark is never nested
// under `navigation`.
void test("createLandmarkTemplate produces a starter card with a navigation role for the...", async (t) => {
  // doctest:L107
  await t.checkText(createLandmarkTemplate({ label: "Recipes", symbol: "🍳" }), `---
navigation:
  label: Recipes
symbol:
  glyph: 🍳
---`);
});

// An image symbol becomes a `{ src }` mapping under the same key:
void test("An image symbol becomes a { src } mapping under the same key:", async (t) => {
  // doctest:L120
  await t.checkText(createLandmarkTemplate({ label: "Character", symbolSrc: "images/portrait.webp" }), `---
navigation:
  label: Character
symbol:
  src: images/portrait.webp
---`);
});

// ## Link resolution
//
// A link to a file that doesn't exist still appears, with `exists: false`
// (missing targets are flagged, not dropped). A link may point outside its own
// directory; the resolved ref is normalized to box-relative. A leading-`/` ref
// means the box root — the same form `bbx validate` and `bbx mv` understand (the
// render layer used to resolve it against the OS filesystem root and report every
// such link missing). A ref that climbs out of the box resolves to nothing and is
// reported `exists: false`, never clamped to some other file.
void test("A link to a file that doesn't exist still appears, with exists:", async (t) => {
  // doctest:L141
  const { links } = await resolveIn({
    files: { "_content/recipes/Bread.recipe.card": "Bread", "_content/docs/About.doc.card": "About", "_content/docs/Index.doc.card": "Index" },
    navigation: {
      links: [
        { ref: "Bread.recipe.card" },
        { ref: "Vanished.recipe.card" },
        { ref: "../docs/About.doc.card", label: "about" },
        { ref: "/_content/docs/Index.doc.card", label: "index" },
        { ref: "/_content/recipes/Gone.recipe.card" },
        { ref: "../../../../etc/hosts", label: "escape" },
      ],
    },
  });
  t.check(links.map((l) => ({ ref: l.ref, label: l.label, exists: l.exists })), [
    {
      ref: "_content/recipes/Bread.recipe.card",
      label: null,
      exists: true,
    },
    {
      ref: "_content/recipes/Vanished.recipe.card",
      label: null,
      exists: false,
    },
    {
      ref: "_content/docs/About.doc.card",
      label: "about",
      exists: true,
    },
    {
      ref: "_content/docs/Index.doc.card",
      label: "index",
      exists: true,
    },
    {
      ref: "_content/recipes/Gone.recipe.card",
      label: null,
      exists: false,
    },
    {
      ref: "../../../../etc/hosts",
      label: "escape",
      exists: false,
    },
  ]);
});

// ## Expand: glob with default template
//
// Without a template, `expand` emits one bare link per match, sorted
// alphabetically by default.
void test("Without a template, expand emits one bare link per match, sorted alphabetical...", async (t) => {
  // doctest:L172
  const { links } = await resolveIn({
    files: { "_content/recipes/Carrot.recipe.card": "Carrot", "_content/recipes/Apple.recipe.card": "Apple", "_content/recipes/Bread.recipe.card": "Bread" },
    navigation: { expand: [{ query: "*.recipe.card" }] },
  });
  t.check(links.map((l) => l.ref), [
    "_content/recipes/Apple.recipe.card",
    "_content/recipes/Bread.recipe.card",
    "_content/recipes/Carrot.recipe.card",
  ]);
});

// ## Expand: an escaping query yields no rows
//
// An `expand` `query` glob is evaluated with the landmark's own directory as
// cwd — a pattern that climbs out of the box namespace (e.g. into `src/`,
// outside every underscore area) must never be read or reported, since its
// frontmatter (title, template fields) would otherwise leak into the rendered
// label. The match is silently dropped, not surfaced as a broken link.
void test("An expand query glob is evaluated with the landmark's own directory as cwd —...", async (t) => {
  // doctest:L189
  const { links } = await resolveIn({
    files: { "_content/recipes/Bread.recipe.card": "Bread", "src/private.doc.card": "Secret Doc" },
    navigation: { expand: [{ query: "../../src/private.doc.card", "template-label": "${title}" }] },
  });
  await t.checkText(links.length, "0");
});

// ## Expand: generated refs are box paths
//
// The default (no `template-ref`) emits the match's **box path** — the canonical
// leading-`/` form — instead of the landmark-dir-relative path the glob returns,
// so a generated ref means the same thing wherever it is read. It is resolved as
// a literal path, so a directory literally named `attach/` is itself, not the
// landmark's own attach scope (the `attach/` virtual prefix is for *authored*
// refs). An authored `template-ref` keeps `${path}` dir-relative.
void test("The default (no template-ref) emits the match's box path — the canonical lead...", async (t) => {
  // doctest:L207
  const { links } = await resolveIn({
    files: { "_content/recipes/attach/Filed.recipe.card": "Filed", "_content/recipes/Recipes.attach/Trap.recipe.card": "Trap" },
    navigation: { expand: [{ query: "attach/*.recipe.card" }] },
  });
  t.check(links.map((l) => ({ ref: l.ref, exists: l.exists })), [
    {
      ref: "_content/recipes/attach/Filed.recipe.card",
      exists: true,
    },
  ]);
});

// ## Expand: template with ${path} and a frontmatter field
//
// Template placeholders interpolate per match. `${path}` is the matched
// card's path relative to the landmark's directory; any other `${field}`
// reads that field from the matched card's frontmatter (replacing the old
// XPath-over-XML evaluation).
void test("Template placeholders interpolate per match.", async (t) => {
  // doctest:L223
  const { links } = await resolveIn({
    files: { "_content/recipes/Bread.recipe.card": "Crusty Bread", "_content/recipes/Pasta.recipe.card": "Cacio e Pepe" },
    navigation: { expand: [{ query: "*.recipe.card", "template-ref": "${path}", "template-label": "${title}" }] },
  });
  t.check(links.map((l) => ({ ref: l.ref, label: l.label })), [
    {
      ref: "_content/recipes/Bread.recipe.card",
      label: "Crusty Bread",
    },
    {
      ref: "_content/recipes/Pasta.recipe.card",
      label: "Cacio e Pepe",
    },
  ]);
});

// ## Dedup: hand-listed beats expanded
//
// A card appearing in both a hand-listed link and an `expand` result shows
// once — hand-listed links come first and keep their label.
void test("A card appearing in both a hand-listed link and an expand result shows once —...", async (t) => {
  // doctest:L241
  const { links } = await resolveIn({
    files: { "_content/recipes/Bread.recipe.card": "Bread", "_content/recipes/Pasta.recipe.card": "Pasta" },
    navigation: { links: [{ ref: "Bread.recipe.card", label: "the bread" }], expand: [{ query: "*.recipe.card" }] },
  });
  t.check(links.map((l) => ({ ref: l.ref, label: l.label })), [
    {
      ref: "_content/recipes/Bread.recipe.card",
      label: "the bread",
    },
    {
      ref: "_content/recipes/Pasta.recipe.card",
      label: null,
    },
  ]);
});

// ## Named expand becomes a collapsible group
//
// An `expand` carrying a `group` title stays grouped instead of flattening
// into the flat `links`. The group reports a `count` and resolved
// `children`; the flat list holds only the static link.
void test("An expand carrying a group title stays grouped instead of flattening into the...", async (t) => {
  // doctest:L260
  const resolved = await resolveIn({
    files: {
      "_content/recipes/Bread.recipe.card": "Bread",
      "_content/recipes/images/A.image.card": "A",
      "_content/recipes/images/B.image.card": "B",
    },
    navigation: { links: [{ ref: "Bread.recipe.card", label: "the bread" }], expand: [{ query: "images/*.image.card", group: "Images" }] },
  });
  t.check(
    ({
      links: resolved.links.map((l) => l.ref),
      groups: resolved.groups.map((g) => ({ label: g.label, count: g.count, children: g.children.map((c) => c.ref) })),
    }),
    {
    links: [
      "_content/recipes/Bread.recipe.card",
    ],
    groups: [
      {
        label: "Images",
        count: 2,
        children: [
          "_content/recipes/images/A.image.card",
          "_content/recipes/images/B.image.card",
        ],
      },
    ],
  },
  );
});

// ## Order: modified-desc
//
// `order: modified-desc` sorts matches by mtime, newest first.
void test("order:", async (t) => {
  // doctest:L284
  const { links } = await resolveIn({
    files: { "_content/recipes/A.recipe.card": "A", "_content/recipes/B.recipe.card": "B" },
    navigation: { expand: [{ query: "*.recipe.card", order: "modified-desc" }] },
    backdated: ["_content/recipes/A.recipe.card"], // backdated so B is newer
  });
  t.check(links.map((l) => l.ref), [
    "_content/recipes/B.recipe.card",
    "_content/recipes/A.recipe.card",
  ]);
});

// ## Destinations: `for` kinds
//
// `findDestination` locates the destination advertising a given kind among
// a landmark's `destinations`.
void test("findDestination locates the destination advertising a given kind among a land...", async (t) => {
  // doctest:L299
  const fields = parseLandmarkFields(`---
navigation:
  label: Reading
destinations:
  - for: [triage, commentary]
    rules: Articles saved for close reading and commentary.
---
`);
  assert.ok(fields);
  const dest = findDestination(fields.destinations, "commentary");
  t.check(dest?.for, [
    "triage",
    "commentary",
  ]);

  // doctest:L312
  await t.checkText(findDestination(fields.destinations, "triage") === dest, "true");

  // A landmark without a matching destination returns null:

  // doctest:L319
  const navOnly = parseLandmarkFields("---\nnavigation:\n  label: Just a bookmark\n---\n");
  assert.ok(navOnly);
  t.check(findDestination(navOnly.destinations, "triage"), null);
});
