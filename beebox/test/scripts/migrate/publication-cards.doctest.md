# Migration: publications move onto their cards

`src/scripts/migrate/publication-cards/` moves each old
`src/publications/<name>/` publication (a `publication.json` plus `site/` or
`project/` source) onto its card. The card `<dir>/<name>.publication.card`
becomes the publication, and the source moves to `<name>.attach/static/` or
`<name>.attach/project/`. Pointer cards that cannot become publications are
deleted when empty or kept as `.md` notes. The stock guidance files are
deleted; edited copies are parked or moved.

```ts setup
import { createHash } from "node:crypto";
import { access, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { migratePublicationCards } from "../../../src/scripts/migrate/publication-cards/run.js";
import { SHIPPED_GUIDE_HASHES, SHIPPED_NOTES_HASHES } from "../../../src/scripts/migrate/publication-cards/cleanup.js";
import { parseFrontmatterObject } from "../../../src/cards/frontmatter.js";
import { loadCardFile } from "../../../src/core/card-io.js";
import { createCardSchemaMap } from "../../../src/schemas.js";
import { preparePublication } from "../../../src/publish/prepare/core/prepare-publication.js";
import { publicationCardsByPubId } from "../../../src/core/card-lint/publication-duplicates.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";

const FIXTURES = join(import.meta.dirname, "publication-cards-fixtures");
const STOCK_GUIDE = await readFile(join(FIXTURES, "stock-CLAUDE.md.txt"), "utf8");
const STOCK_NOTES = await readFile(join(FIXTURES, "stock-NOTES.md.txt"), "utf8");
const sha = (text) => createHash("sha256").update(text).digest("hex");

const P = {
  guide: "abcdefghijklmnop2345672345",
  app: "bbcdefghijklmnop2345672345",
  nocard: "cbcdefghijklmnop2345672345",
  moved: "dbcdefghijklmnop2345672345",
  alias: "ebcdefghijklmnop2345672345",
  empty: "fbcdefghijklmnop2345672345",
  notes: "gbcdefghijklmnop2345672345",
  broken: "hbcdefghijklmnop2345672345",
};

async function exists(box, rel) {
  return access(join(box.root, rel)).then(() => true, () => false);
}

/** Files under `dir`, box-relative and sorted; `.gitkeep` scaffolding omitted. */
async function files(box, dir) {
  const out = [];
  async function walk(rel) {
    for (const e of await readdir(join(box.root, rel), { withFileTypes: true }).catch(() => [])) {
      const child = `${rel}/${e.name}`;
      if (e.isDirectory()) await walk(child);
      else if (e.name !== ".gitkeep") out.push(child);
    }
  }
  await walk(dir);
  return out.toSorted();
}

const pointer = (title, pubId, body = "") => `---\ntitle: ${title}\npubId: ${pubId}\n---\n${body}`;
const json = (pubId, content, title, extra = {}) =>
  JSON.stringify({ pubId, connection: "personal", content, title, tier: "secret", ...extra });

/** Frontmatter of a card as parsed by the new publication schema. */
async function publication(box, rel) {
  return parseFrontmatterObject(await box.read(rel));
}
```

## The stock guidance texts

The fixtures hold the exact text that `publications-guide-v1` and the
`NOTES.md` seed wrote to disk. The script deletes a file only when its sha256
is one of these shipped hashes.

```ts
SHIPPED_GUIDE_HASHES.includes(sha(STOCK_GUIDE))
=> true

SHIPPED_NOTES_HASHES.includes(sha(STOCK_NOTES))
=> true
```

## One box with every shape

`field-guide` is static with a pointer card at the default path. `app` is a
project with build output and installed dependencies and a stray `site/`.
`nocard` has no card. `moved`'s card was moved and renamed by the boxholder.
`alias` has two cards for one pubId. Two pointer cards have no
`publication.json` at all, and `broken`'s JSON does not validate. The guide is
stock, and `NOTES.md` was edited.

```ts continue
const box = await makeTmpBox();
const pubs = "_content/publications";
await box.write(`src/publications/field-guide/publication.json`, json(P.guide, "static", "Field Guide"));
await box.write(`src/publications/field-guide/site/index.html`, "<h1>Guide</h1>");
await box.write(`${pubs}/${P.guide}.publication.card`, pointer("Field Guide", P.guide, "Guide notes.\n"));

await box.write(`src/publications/app/publication.json`, json(P.app, "project", "App"));
await box.write(`src/publications/app/project/package.json`, "{}");
await box.write(`src/publications/app/project/src/main.ts`, "export {};");
await box.write(`src/publications/app/project/dist/index.html`, "built");
await box.write(`src/publications/app/project/node_modules/dep/index.js`, "dep");
await box.write(`src/publications/app/site/old.html`, "stray");
await box.write(`${pubs}/${P.app}.publication.card`, pointer("App", P.app));

await box.write(`src/publications/nocard/publication.json`, json(P.nocard, "static", "No Card"));
await box.write(`src/publications/nocard/site/index.html`, "nocard");

await box.write(`src/publications/moved/publication.json`, json(P.moved, "static", "Moved"));
await box.write(`src/publications/moved/site/index.html`, "moved");
await box.write(`_content/web/My Site.publication.card`, pointer("My Site", P.moved));

await box.write(`src/publications/alias/publication.json`, json(P.alias, "static", "Alias"));
await box.write(`src/publications/alias/site/index.html`, "alias");
await box.write(`${pubs}/${P.alias}.publication.card`, pointer("Alias", P.alias, "Main body.\n"));
await box.write(`_content/other/alias copy.publication.card`, pointer("Alias", P.alias, "Copy body.\n"));

await box.write(`${pubs}/orphan-empty.publication.card`, pointer("Orphan", P.empty, "\n"));
await box.write(`${pubs}/orphan-notes.publication.card`, pointer("Old Notes", P.notes, "Keep me.\n"));

await box.write(`src/publications/broken/publication.json`, json(P.broken, "static", "Broken", { tier: "everyone" }));
await box.write(`src/publications/broken/site/index.html`, "broken");
await box.write(`${pubs}/${P.broken}.publication.card`, pointer("Broken", P.broken, "Broken notes.\n"));

await box.write("src/publications/CLAUDE.md", STOCK_GUIDE);
await box.write("src/publications/NOTES.md", `${STOCK_NOTES}\nUse serif fonts.\n`);
```

A dry run reports and writes nothing.

```ts continue
const dry = await migratePublicationCards({ boxRoot: box.root, apply: false });
dry.actions.length > 0
=> true

await exists(box, "src/publications/field-guide/publication.json")
=> true
```

Applying it gives this layout. The `app` build output and dependencies are
deleted, its stray `site/` stays, and `broken`'s JSON stays.

```ts continue
const report = await migratePublicationCards({ boxRoot: box.root, apply: true });
report.warnings.length
=> 6

const after = [...await files(box, "_content"), ...await files(box, "src/publications")];
["_content/publications/app.attach/project/package.json", "_content/web/moved.attach/static/index.html", "_content/publications/nocard.attach/static/index.html", "_content/publications/orphan-notes.md", "src/publications/app/site/old.html", "src/publications/broken/publication.json"].filter((f) => !after.includes(f))
=> []

after.filter((f) => /dist|node_modules|alias copy|orphan-empty|My Site|CLAUDE|publication\.json$/.test(f) && !f.includes("broken"))
=> []
```

Each migrated card is a valid publication. Bodies are kept; the alias copy's
body is appended to the kept card. Every migrated card links the moved notes
with a link relative to its own directory.

```ts continue
await publication(box, `${pubs}/field-guide.publication.card`)
=> { title: "Field Guide", pubId: "abcdefghijklmnop2345672345", connection: "personal", tier: "secret" }

await box.read(`${pubs}/alias.publication.card`)
=> ---
title: Alias
pubId: ebcdefghijklmnop2345672345
connection: personal
tier: secret
---
«blankline»
Main body.
«blankline»
Copy body.
«blankline»
Publication notes: [NOTES](NOTES.md)

await box.read(`_content/web/moved.publication.card`)
=> ---
title: Moved
pubId: dbcdefghijklmnop2345672345
connection: personal
tier: secret
---
«blankline»
Publication notes: [NOTES](../publications/NOTES.md)

await box.read(`${pubs}/orphan-notes.md`)
=> This publication has no source in the box. Its notes are kept here.
«blankline»
# Old Notes
«blankline»
Keep me.

(await box.read(".gitignore")).split("\n").filter((l) => l.includes(".attach/project/"))
=> ["**/*.attach/project/dist/"]
```

Every remaining `.publication.card` loads through the box's card registry,
the same validation the box hooks apply, and the migrated static card prepares.

```ts continue
const cards = [...await files(box, "_content")].filter((f) => f.endsWith(".publication.card"));
cards
=> ["_content/publications/alias.publication.card", "_content/publications/app.publication.card", "_content/publications/field-guide.publication.card", "_content/publications/nocard.publication.card", "_content/web/moved.publication.card"]

const cardSchemas = await createCardSchemaMap(box.root);
const loaded = await Promise.allSettled(cards.map((c) => loadCardFile(join(box.root, c), { cardSchemas })));
loaded.map((r) => r.status === "fulfilled" ? r.value.schema.type : String(r.reason))
=> ["publication", "publication", "publication", "publication", "publication"]

const prepared = await preparePublication({ boxRoot: box.root, card: `${pubs}/field-guide.publication.card` }, { ownerEmail: null });
prepared.ok && prepared.prepared.files.map((f) => f.path)
=> ["index.html"]

if (prepared.ok) await prepared.prepared.cleanup();
```

A second run takes no action. Its warnings only re-report what the first run
left on purpose: the unselected `site/` beside the moved project, and the
invalid `publication.json`.

```ts continue
await migratePublicationCards({ boxRoot: box.root, apply: true })
=> { actions: [], warnings: ["src/publications/app/ has no publication.json; left in place", "src/publications/broken/publication.json is invalid; left in place: tier: Invalid discriminator value. Expected 'public' | 'secret' | 'accounts' | 'any-account'"] }
```

## Stock guidance only

A box that never published has only the stock guide, the stock notes, and the
template tracker entry. All three go, and so does `src/publications/`.

```ts continue
const plain = await makeTmpBox();
await plain.write("src/publications/CLAUDE.md", STOCK_GUIDE);
await plain.write("src/publications/NOTES.md", STOCK_NOTES);
await plain.write("_config/template-versions.json", JSON.stringify({ "src/publications/CLAUDE.md": "x", "other.md": "y" }));
await migratePublicationCards({ boxRoot: plain.root, apply: true });
await exists(plain, "src/publications")
=> false

JSON.parse(await plain.read("_config/template-versions.json"))
=> { "other.md": "y" }

await exists(plain, "_content/publications/NOTES.md")
=> false
```

## Two old definitions with one publication id

Only the first becomes a card. The second `publication.json` stays in place and
is reported, on the first run and on every rerun, so the box never holds two
cards with one `pubId`.

```ts
const twins = await makeTmpBox();
const twinId = "bbbbbbbbbbbbbbbbbbbbbbbb22";
const twinJson = JSON.stringify({ pubId: twinId, connection: "cf", content: "static", title: "Twin", tier: "secret" });
for (const name of ["alpha", "beta"]) {
  await twins.write(`src/publications/${name}/publication.json`, twinJson);
  await twins.write(`src/publications/${name}/site/index.html`, `<h1>${name}</h1>`);
}
const twinFirst = await migratePublicationCards({ boxRoot: twins.root, apply: true });
const twinSecond = await migratePublicationCards({ boxRoot: twins.root, apply: true });

twinFirst.warnings
=> ["src/publications/beta/publication.json repeats the pubId of the publication card _content/publications/alpha.publication.card; left in place"]

twinSecond
=> { actions: [], warnings: ["src/publications/beta/publication.json repeats the pubId of the publication card _content/publications/alpha.publication.card; left in place"] }

(await publicationCardsByPubId(twins.root)).get(twinId)
=> ["_content/publications/alpha.publication.card"]

await twins.cleanup();
```
