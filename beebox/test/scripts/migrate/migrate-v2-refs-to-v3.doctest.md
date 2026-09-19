# Migration: v2-layout refs rewritten to their v3 paths

`scripts/migrate/v2-refs-to-v3.ts` rewrites a box-absolute ref still written in
the v2 layout to the path the one-root migration moved its target to, using
the same `mapV2Path` table. It rewrites only when the mapped target exists.
`v3FormOf` is the pure decision.

```ts setup
import { migrateBox, v3FormOf } from "../../../scripts/migrate/v2-refs-to-v3.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";

const onDisk = new Set(["_bookkeeping/archive/briefs/B.news-brief.card", "_content/inbox/Note.memo.card", "_content/store/X.doc.card"]);
const exists = (rel) => onDisk.has(rel);
```

A v2 ref whose target exists maps to its v3 path, with the fragment kept; a
`/content/` prefix is accepted too. A ref that already resolves, a relative
ref, a v2 ref whose target is gone, and a mapping outside the box namespace
are left alone:

```ts
[
  v3FormOf("/store/archive/briefs/B.news-brief.card#risks", exists),
  v3FormOf("/content/box/inbox/Note.memo.card", exists),
  v3FormOf("/_content/store/X.doc.card", exists),
  v3FormOf("store/X.doc.card", exists),
  v3FormOf("/store/archive/briefs/Gone.news-brief.card", exists),
  v3FormOf("/tricks/run.ts", exists),
]
=>
[
  "/_bookkeeping/archive/briefs/B.news-brief.card#risks",
  "/_content/inbox/Note.memo.card",
  null,
  null,
  null,
  null
]
```

On a box, cards and `.md` files are rewritten, a fenced example is not, and
a second run changes nothing:

```ts
const box = await makeTmpBox();
await box.write("_bookkeeping/archive/briefs/B.news-brief.card", "---\ntitle: B\n---\n");
await box.write(
  "_content/notes/Read.doc.card",
  "---\ntitle: Read\nsource:\n  ref: /store/archive/briefs/B.news-brief.card\n---\nSee [B](/store/archive/briefs/B.news-brief.card).\n\n```\n[old](/store/archive/briefs/B.news-brief.card)\n```\n",
);
await box.write("_content/notes/list.md", "- [B](/store/archive/briefs/B.news-brief.card)\n");

const report = await migrateBox(box.root, true);
JSON.stringify(report.files)
=> [{"file":"_content/notes/Read.doc.card","count":2},{"file":"_content/notes/list.md","count":1}]

await box.read("_content/notes/list.md")
=> - [B](/_bookkeeping/archive/briefs/B.news-brief.card)

(await box.read("_content/notes/Read.doc.card")).includes("[old](/store/archive/briefs/B.news-brief.card)")
=> true

(await migrateBox(box.root, true)).files.length
=> 0
```

```ts cleanup
await box.cleanup();
```
