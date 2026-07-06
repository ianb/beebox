# Migration: split commentary + converge records onto `.webpage.card`

`scripts/migrate/webpage-card.ts` performs two conversions toward the
`.webpage.card` type. `convertFile(absPath)` is the per-card entry the CLI
harness drives; this doctest exercises it directly on fixture boxes.

```ts setup
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { initBox } from "../../../src/core/box/index.js";
import { buildLoadContext } from "../../../src/core/load-context.js";
import { loadCardFromText } from "../../../src/core/card-io.js";
import { convertFile } from "../../../scripts/migrate/webpage-card.js";

async function makeTmpBox() {
  const box = await fs.mkdtemp(path.join(os.tmpdir(), "cb-webpagemig-"));
  await initBox(box, { skipGit: true });
  return box;
}

// A fused capture commentary: readable + frozen in .attach/, remarks (with an
// anchor pointing at the readable doc) in the body.
const FUSED = "---\ntitle: Foo\ndefaultRef: attach/readable.md\nsource: https://example.com/foo\ncaptured: 2026-06-14\nfrozen: attach/page.frozen\n---\n{% source ref=\"attach/readable.md\" pos=\"body\" version=\"sha256:abc\" %}{% quote %}a distinctive span{% /quote %}{% /source %}\n\nMy remark about it.\n";
```

## A fused capture commentary splits into a webpage card + attach commentary

```ts
const box = await makeTmpBox();
await fs.mkdir(path.join(box, "store/reading/Foo.attach"), { recursive: true });
await fs.writeFile(path.join(box, "store/reading/Foo.commentary.card"), FUSED);
await fs.writeFile(path.join(box, "store/reading/Foo.attach/readable.md"), "# Foo\n\nThe readable body with a distinctive span inside.\n");
await fs.writeFile(path.join(box, "store/reading/Foo.attach/page.frozen"), "<html>frozen</html>");

await convertFile(path.join(box, "store/reading/Foo.commentary.card"));

const top = await fs.readdir(path.join(box, "store/reading"));
[top.includes("Foo.webpage.card"), top.includes("Foo.commentary.card")].join(",")
=> true,false
```

The webpage card carries the provenance and the readable rendering as its body:

```ts continue
const wpText = await fs.readFile(path.join(box, "store/reading/Foo.webpage.card"), "utf8");
[wpText.includes("source: https://example.com/foo"), wpText.includes("frozen:\n  ref: attach/page.frozen"), wpText.includes("The readable body with a distinctive span")].join(",")
=> true,true,true
```

The attach scope now holds the frozen page and the commentary card; the
readable doc is gone (it became the webpage body):

```ts continue
const attach = await fs.readdir(path.join(box, "store/reading/Foo.attach"));
[attach.includes("page.frozen"), attach.includes("Foo.commentary.card"), attach.includes("readable.md")].join(",")
=> true,true,false
```

The migrated commentary keeps the remark but its anchor is now ref-free (it
defaults to the containing page):

```ts continue
const cmText = await fs.readFile(path.join(box, "store/reading/Foo.attach/Foo.commentary.card"), "utf8");
[cmText.includes("My remark about it."), cmText.includes("attach/readable.md")].join(",")
=> true,false
```

Both migrated cards load and validate:

```ts continue
const ctx = await buildLoadContext(box);
const wp = await loadCardFromText({ content: wpText, source: "store/reading/Foo.webpage.card", ctx });
[wp.kind, wp.schema.type, wp.fields.source].join("|")
=> frontmatter|webpage|https://example.com/foo

const cm = await loadCardFromText({ content: cmText, source: "store/reading/Foo.attach/Foo.commentary.card", ctx });
[cm.kind, cm.schema.type].join("|")
=> frontmatter|commentary
```

```ts cleanup
await fs.rm(box, { recursive: true, force: true });
```

## The earliest shape — provenance in the body — also migrates

The first capture template put the source URL + capture date in the body as an
`[Original page](…) · captured …` line rather than in frontmatter. The migrator
recovers them from there and strips that line from the remarks.

```ts
const box = await makeTmpBox();
await fs.mkdir(path.join(box, "store/reading/Old.attach"), { recursive: true });
const BODYPROV = "---\ntitle: Old\ndefaultRef: attach/readable.md\n---\n[Original page](https://old.example.com/x) · captured 2026-06-14T10:36:55.904Z\n\n{% source ref=\"attach/readable.md\" pos=\"body\" version=\"sha256:1\" %}{% quote %}a span{% /quote %}{% /source %}\n\nA remark here.\n";
await fs.writeFile(path.join(box, "store/reading/Old.commentary.card"), BODYPROV);
await fs.writeFile(path.join(box, "store/reading/Old.attach/readable.md"), "# Old\n\nThe page body.\n");

await convertFile(path.join(box, "store/reading/Old.commentary.card"));

const wpText = await fs.readFile(path.join(box, "store/reading/Old.webpage.card"), "utf8");
[wpText.includes("source: https://old.example.com/x"), wpText.includes("captured: 2026-06-14T10:36:55.904Z")].join(",")
=> true,true
```

The remarks keep the comment but drop the provenance line:

```ts continue
const cmText = await fs.readFile(path.join(box, "store/reading/Old.attach/Old.commentary.card"), "utf8");
[cmText.includes("A remark here."), cmText.includes("Original page"), cmText.includes("attach/readable.md")].join(",")
=> true,false,false
```

```ts cleanup
await fs.rm(box, { recursive: true, force: true });
```

## A saved-page record converges onto a webpage card

```ts
const box = await makeTmpBox();
await fs.mkdir(path.join(box, "box/inbox/pages-saved"), { recursive: true });
const REC = "---\nstatus: draft\nname: A Saved Page\ndescription: Short summary.\nsources:\n  - ref: https://example.com/saved\n    note: Example — Author\n---\n# A Saved Page\n\nPage content.\n";
await fs.writeFile(path.join(box, "box/inbox/pages-saved/Bar.record.card"), REC);
await fs.writeFile(path.join(box, "box/inbox/pages-saved/Bar.frozen"), "<html>frozen</html>");

await convertFile(path.join(box, "box/inbox/pages-saved/Bar.record.card"));

const saved = await fs.readdir(path.join(box, "box/inbox/pages-saved"));
[saved.includes("Bar.webpage.card"), saved.includes("Bar.record.card"), saved.includes("Bar.frozen")].join(",")
=> true,false,false
```

The sibling frozen file moves into the new card's attach scope:

```ts continue
const attach = await fs.readdir(path.join(box, "box/inbox/pages-saved/Bar.attach"));
attach.includes("page.frozen")
=> true
```

The webpage card takes the record's name as title, the http source as
`source`, and the description as `excerpt`:

```ts continue
const wpText = await fs.readFile(path.join(box, "box/inbox/pages-saved/Bar.webpage.card"), "utf8");
const ctx = await buildLoadContext(box);
const wp = await loadCardFromText({ content: wpText, source: "box/inbox/pages-saved/Bar.webpage.card", ctx });
[wp.schema.type, wp.fields.title, wp.fields.source, wp.fields.excerpt].join("|")
=> webpage|A Saved Page|https://example.com/saved|Short summary.
```

```ts cleanup
await fs.rm(box, { recursive: true, force: true });
```

## Cards that aren't fused captures are left untouched

A commentary without a `source:` (a hand-made or external-file commentary) and
a record outside the saved-page directories are skipped:

```ts
const box = await makeTmpBox();
await fs.mkdir(path.join(box, "store/notes"), { recursive: true });
await fs.writeFile(path.join(box, "store/notes/Plain.commentary.card"), "---\ntitle: Plain\ndefaultHref: file:/Users/x/doc.md\n---\nremarks\n");
await fs.writeFile(path.join(box, "store/notes/Thing.record.card"), "---\nstatus: draft\nname: A Couch\n---\n");

const a = await convertFile(path.join(box, "store/notes/Plain.commentary.card"));
const b = await convertFile(path.join(box, "store/notes/Thing.record.card"));
const files = await fs.readdir(path.join(box, "store/notes"));
[a, b, files.includes("Plain.commentary.card"), files.includes("Thing.record.card"), files.some((f) => f.endsWith(".webpage.card"))].join(",")
=> already,already,true,true,false
```

```ts cleanup
await fs.rm(box, { recursive: true, force: true });
```
