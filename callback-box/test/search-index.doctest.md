# search: index lifecycle — build, refresh, move, recover

`openSearchIndex` restores the persisted Orama index, diffs the manifest
against the filesystem, re-extracts only what changed, and persists when
dirty. The index is a disposable cache: corruption or version mismatch
rebuilds silently.

```ts setup
import { search } from "@orama/orama";
import { rename, writeFile, readFile } from "node:fs/promises";
import { openSearchIndex } from "../src/core/search/refresh.js";
import { searchIndexPath, searchLockPath, type SearchIndex } from "../src/core/search/search-store.js";
import { acquireLock, releaseLock } from "../src/lib/file-lock.js";
import { makeTmpBox } from "./helpers/doctest-helpers.js";

async function find(db: SearchIndex, term: string): Promise<string> {
  const result = await search(db, { term, properties: ["title", "contains", "content"] });
  return result.hits.map((h) => h.document.path as string).toSorted().join("\n");
}

const MEMO = (text: string, contains?: string) =>
  `---\ncreated: 2026-05-22T10:00:00Z\n${contains ? `contains: ${contains}\n` : ""}---\n${text}\n`;
```

## Build: searchable cards index, operational kinds don't

```ts
const box = await makeTmpBox();
await box.write("box/inbox/Dentist.memo.card", MEMO("The dentist appointment moved to June 17.", "Dentist moved to June 17."));
await box.write("store/notes/Budget.memo.card", MEMO("Quarterly budget review notes."));
await box.write("box/jobs/job-1.intake-job.card", "---\nstatus: pending\n---\nTriage the dentist email\n");
await box.write("store/trash/Old.memo.card", MEMO("trashed dentist note"));
const opened = await openSearchIndex(box.root);
JSON.stringify(opened.warnings)
=> []

opened.stale
=> false

await find(opened.db, "dentist")
=> box/inbox/Dentist.memo.card

await find(opened.db, "budget")
=> store/notes/Budget.memo.card
```

## Incremental refresh: edits and new cards picked up at next open

```ts continue
await box.write("box/inbox/Dentist.memo.card", MEMO("Now it is an orthodontist appointment on June 19."));
await box.write("store/notes/Garden.memo.card", MEMO("Plant the tomatoes after the last frost."));
const reopened = await openSearchIndex(box.root);
await find(reopened.db, "orthodontist")
=> box/inbox/Dentist.memo.card

await find(reopened.db, "tomatoes")
=> store/notes/Garden.memo.card

await find(reopened.db, "dentist")
=>
```

## A moved card re-indexes under its new path

```ts continue
await rename(box.path("store/notes/Budget.memo.card"), box.path("store/notes/Budget_2026.memo.card"));
const moved = await openSearchIndex(box.root);
await find(moved.db, "budget")
=> store/notes/Budget_2026.memo.card
```

## Persist → restore is stable (pins oramasearch/orama#695 at our version)

```ts continue
const before = await find((await openSearchIndex(box.root)).db, "tomatoes");
const after = await find((await openSearchIndex(box.root)).db, "tomatoes");
before === after
=> true

after
=> store/notes/Garden.memo.card
```

## A corrupted index file rebuilds silently

```ts continue
await writeFile(searchIndexPath(box.root), "not a real index");
const recovered = await openSearchIndex(box.root);
await find(recovered.db, "tomatoes")
=> store/notes/Garden.memo.card
```

## Lock contention serves the last persisted index, flagged stale

```ts continue
await acquireLock(searchLockPath(box.root), { purpose: "doctest" });
const blocked = await openSearchIndex(box.root, { lockRetries: 2, lockRetryMs: 10 });
blocked.stale
=> true

await find(blocked.db, "tomatoes")
=> store/notes/Garden.memo.card

await releaseLock(searchLockPath(box.root));
(await openSearchIndex(box.root)).stale
=> false
```

## An unparseable card is skipped with a warning; everything else still works

```ts continue
await box.write("store/notes/Broken.memo.card", "---\ncreated: not-a-date\n---\nbroken body\n");
const withBad = await openSearchIndex(box.root);
withBad.warnings.length
=> 1

withBad.warnings[0].startsWith("store/notes/Broken.memo.card: skipped")
=> true

await find(withBad.db, "tomatoes")
=> store/notes/Garden.memo.card

// An unchanged broken card warns once, not on every search.
(await openSearchIndex(box.root)).warnings.length
=> 0

await box.write("store/notes/Broken.memo.card", MEMO("fixed broken body"));
const fixedAgain = await openSearchIndex(box.root);
JSON.stringify(fixedAgain.warnings)
=> []

await find(fixedAgain.db, "broken")
=> store/notes/Broken.memo.card
```

## Standalone .md files index as kind "markdown"; attach-scope files don't

```ts continue
await box.write("store/finances/Distribution_Letter.md", "# Ledger Distribution Letter\n\nEach heir receives an apportioned share.\n");
await box.write("store/notes/Note.attach/snippet.md", "apportioned share duplicate inside attach scope");
await box.write("docs/generated/card-memo.md", "apportioned share generated doc noise");
const withMd = await openSearchIndex(box.root);
await find(withMd.db, "apportioned share")
=> store/finances/Distribution_Letter.md

const mdHit = await search(withMd.db, { term: "distribution letter", properties: ["title", "content"] });
mdHit.hits[0].document.kind
=> markdown

mdHit.hits[0].document.title
=> Ledger Distribution Letter
```

## Gdoc snapshots are watched input files: editing only the attachment re-indexes

```ts continue
await box.write(
  "store/drive/Notes.gdoc.card",
  "---\ndrive-id: d1\ntitle: Project Notes\nmodified: 2026-05-01\nlink: https://docs.google.com/document/d/d1/edit\nowner: o@example.com\ncontent:\n  ref: attach/Notes.md\n---\n"
);
await box.write("store/drive/Notes.attach/Notes.md", "Planning the lighthouse migration.");
const withGdoc = await openSearchIndex(box.root);
await find(withGdoc.db, "lighthouse")
=> store/drive/Notes.gdoc.card

await box.write("store/drive/Notes.attach/Notes.md", "Planning the submarine migration instead.");
const inputChanged = await openSearchIndex(box.root);
await find(inputChanged.db, "submarine")
=> store/drive/Notes.gdoc.card

await find(inputChanged.db, "lighthouse")
=>
```

```ts cleanup
await box.cleanup();
```
