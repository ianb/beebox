# search: index-before-manifest crash safety

The refresh persists the index first and the manifest last, so a crash between
the two writes leaves an *older* manifest — never a manifest describing docs the
index doesn't hold. The next refresh re-diffs the stale manifest against the
filesystem and re-extracts the affected files, self-healing. The ordering is
enforced by the type system: `saveManifest` requires the `IndexPersisted`
receipt that only `persistSearchIndex` (or `indexUnchanged`) mints.

```ts setup
import { search } from "@orama/orama";
import { readFile, writeFile } from "node:fs/promises";
import { openSearchIndex } from "../../../src/core/search/refresh.js";
import { saveManifest, emptyManifest } from "../../../src/core/search/manifest.js";
import {
  searchManifestPath,
  persistSearchIndex,
  indexUnchanged,
  createSearchIndex,
  type SearchIndex,
} from "../../../src/core/search/search-store.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";

async function find(db: SearchIndex, term: string): Promise<string> {
  const result = await search(db, { term, properties: ["title", "content"] });
  return result.hits.map((h) => h.document.path as string).toSorted().join("\n");
}

const MEMO = (text: string) => `---\ncreated: 2026-05-22T10:00:00Z\n---\n${text}\n`;

async function throwName(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "did not throw";
  } catch (e) {
    return (e as Error).name;
  }
}
```

## A crash that leaves an older manifest self-heals on next refresh

Build an index over one card and snapshot the manifest that describes it.

```ts
const box = await makeTmpBox();
await box.write("box/inbox/Dentist.memo.card", MEMO("The dentist appointment is on June 17."));
await openSearchIndex(box.root);
const staleManifest = await readFile(searchManifestPath(box.root), "utf8");
staleManifest.includes("Dentist.memo.card")
=> true
```

Edit that card and add another, then refresh so both the index and the manifest
now reflect the new state.

```ts continue
await box.write("box/inbox/Dentist.memo.card", MEMO("Rescheduled to an orthodontist on June 19."));
await box.write("store/notes/Garden.memo.card", MEMO("Plant the tomatoes after the frost."));
const fresh = await openSearchIndex(box.root);
await find(fresh.db, "orthodontist")
=> box/inbox/Dentist.memo.card

await find(fresh.db, "tomatoes")
=> store/notes/Garden.memo.card
```

Now simulate a crash *between* the index write and the manifest write: the index
on disk is the new one, but the manifest was rolled back to the pre-edit
snapshot (the write never landed). The next open re-diffs the stale manifest and
re-extracts — the healed index reflects the true filesystem, with no warnings.

```ts continue
await writeFile(searchManifestPath(box.root), staleManifest);
const healed = await openSearchIndex(box.root);
JSON.stringify(healed.warnings)
=> []

await find(healed.db, "orthodontist")
=> box/inbox/Dentist.memo.card

await find(healed.db, "tomatoes")
=> store/notes/Garden.memo.card

// The pre-edit content is gone — the stale manifest didn't resurrect it.
// ("appointment" appears only in the old body, not the rescheduled one.)
await find(healed.db, "appointment")
=>
```

```ts cleanup
await box.cleanup();
```

## A first refresh whose only change is a skipped card doesn't throw

The very first refresh over a box whose sole indexable file fails to parse hits
the manifest-only branch (a skip record, no docs) with no persisted index yet.
That must complete and warn about the skip — not crash asserting a missing index.

```ts
const box = await makeTmpBox();
await box.write("store/notes/Broken.memo.card", "---\ncreated: not-a-date\n---\nbroken body\n");
const opened = await openSearchIndex(box.root);
opened.warnings.length
=> 1

opened.warnings[0].startsWith("store/notes/Broken.memo.card: skipped")
=> true

// A valid card added later indexes fine on top of the recorded skip.
await box.write("store/notes/Good.memo.card", MEMO("the garden tomatoes are ripe"));
const withGood = await openSearchIndex(box.root);
await find(withGood.db, "tomatoes")
=> store/notes/Good.memo.card
```

```ts cleanup
await box.cleanup();
```

## The receipt makes writing the manifest ahead of the index unrepresentable

`saveManifest` cannot be called without an `IndexPersisted` receipt, and the
receipt is checked against the box it's used for — a receipt minted for another
box is rejected loudly rather than persisting a mismatched manifest.

```ts
const boxA = await makeTmpBox();
const boxB = await makeTmpBox();
const proofB = await persistSearchIndex(await createSearchIndex(), boxB.root);
await throwName(() => saveManifest(boxA.root, { manifest: emptyManifest(), indexProof: proofB }))
=> InvariantError
```

`indexUnchanged` mints the receipt for a no-document-change refresh (only
stat/mtime or skip records moved) — including a first refresh whose only
"change" is a skipped card, where no index file exists yet. It is accepted by
`saveManifest` for its own box.

```ts continue
await saveManifest(boxA.root, { manifest: emptyManifest(), indexProof: indexUnchanged(boxA.root) })
=> undefined
```

```ts cleanup
await boxA.cleanup();
await boxB.cleanup();
```
