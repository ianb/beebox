# contains-state: staleness tracking without touching cards

The `.callback-box/contains-state.json` sidecar records, per searchable
card, the `contains` text and the content basis it was written against.
The index refresh maintains it; cards stay byte-clean. Stale = the content
moved while `contains` didn't.

```ts setup
import { openSearchIndex } from "../src/core/search/refresh.js";
import {
  loadContainsState,
  listStale,
  listMissing,
  staleContainsWarning,
  computeBasisForCardPath,
  rebaseContains,
  saveContainsState,
} from "../src/core/search/contains-state.js";
import { createCardSchemaMap } from "../src/schemas/registry.js";
import type { LoadCardContext } from "../src/core/card-io.js";
import { makeTmpBox } from "./helpers/doctest-helpers.js";

const ctx: LoadCardContext = {
  cardSchemas: await createCardSchemaMap(),
};

const MEMO = (text: string, contains?: string) =>
  "---\ncreated: 2026-05-22T10:00:00Z\n" + (contains ? "contains: " + contains + "\n" : "") + "---\n" + text + "\n";
```

## The refresh records contains text and basis; fresh cards aren't stale

```ts
const box = await makeTmpBox();
await box.write("store/notes/Dentist.memo.card", MEMO("Appointment moved to June 17.", "Dentist moved to June 17."));
await box.write("store/notes/Bare.memo.card", MEMO("No contains here yet."));
await openSearchIndex(box.root);
const state = await loadContainsState(box.root);
state.cards["store/notes/Dentist.memo.card"].containsText
=> Dentist moved to June 17.

JSON.stringify(listStale(state))
=> []

JSON.stringify(listMissing(state))
=> ["store/notes/Bare.memo.card"]
```

## Editing the body while keeping contains flags the card stale

```ts continue
await box.write("store/notes/Dentist.memo.card", MEMO("Appointment moved AGAIN, now July 2.", "Dentist moved to June 17."));
await openSearchIndex(box.root);
JSON.stringify(listStale(await loadContainsState(box.root)))
=> ["store/notes/Dentist.memo.card"]
```

## The hook-time warning fires live, even before any refresh

```ts continue
const warning = await staleContainsWarning(box.root, { relPath: "store/notes/Dentist.memo.card", ctx });
warning !== null && warning.startsWith("store/notes/Dentist.memo.card: card content changed but contains: didn't")
=> true

await staleContainsWarning(box.root, { relPath: "store/notes/Bare.memo.card", ctx })
=> null
```

## Updating the contains text re-bases; the flag clears

```ts continue
await box.write("store/notes/Dentist.memo.card", MEMO("Appointment moved AGAIN, now July 2.", "Dentist moved to July 2."));
await openSearchIndex(box.root);
JSON.stringify(listStale(await loadContainsState(box.root)))
=> []
```

## Confirming unchanged text re-bases too (the cb contains update path)

```ts continue
await box.write("store/notes/Dentist.memo.card", MEMO("Tweaked wording, July 2 still right.", "Dentist moved to July 2."));
await openSearchIndex(box.root);
JSON.stringify(listStale(await loadContainsState(box.root)))
=> ["store/notes/Dentist.memo.card"]

// What `cb contains update` does with identical text: re-base at the live basis.
const confirm = await computeBasisForCardPath(box.root, { relPath: "store/notes/Dentist.memo.card", ctx });
const state2 = await loadContainsState(box.root);
rebaseContains(state2, { cardPath: "store/notes/Dentist.memo.card", contains: confirm.contains, basis: confirm.basis ?? "" });
await saveContainsState(box.root, state2);
JSON.stringify(listStale(await loadContainsState(box.root)))
=> []

await staleContainsWarning(box.root, { relPath: "store/notes/Dentist.memo.card", ctx })
=> null
```

## Operational field flips (status) don't stale a body-less card's contains

```ts continue
await box.write(
  "box/inbox/email/t.email-thread.card",
  "---\nthread-id: t1\nstatus: new\nsubject: Pricing\nparticipants:\n  - a@x.example\ncontains: Metricly demo offer; no action needed.\ndate-range:\n  start: 2026-05-14T19:00:00Z\n  end: 2026-05-14T19:00:00Z\nmessages: []\n---\n"
);
await openSearchIndex(box.root);
await box.write(
  "box/inbox/email/t.email-thread.card",
  "---\nthread-id: t1\nstatus: read\nsubject: Pricing\nparticipants:\n  - a@x.example\ncontains: Metricly demo offer; no action needed.\ndate-range:\n  start: 2026-05-14T19:00:00Z\n  end: 2026-05-14T19:00:00Z\nmessages: []\n---\n"
);
await openSearchIndex(box.root);
JSON.stringify(listStale(await loadContainsState(box.root)).filter((p) => p.includes("email")))
=> []
```

## A described image satisfies contains (role separation, no duplication)

`description` is the visual field; it doubles as the effective `contains`
until an explicit one exists — so described images never enter the
backfill worklist, and a description change re-bases rather than flagging
stale (the retrieval field moved with the content).

```ts continue
const IMG = (desc: string) =>
  "---\nstatus: analyzed\nfilename:\n  ref: attach/boiler.jpg\n  captured: 2026-05-01T10:00:00Z\n  source: camera-user\ndescription: " + desc + "\n---\n";
await box.write("store/archive/boiler.image.card", IMG("The boiler's serial-number plate (K-44210)"));
await openSearchIndex(box.root);
JSON.stringify(listMissing(await loadContainsState(box.root)).filter((p) => p.includes("image")))
=> []

await box.write("store/archive/boiler.image.card", IMG("A different plate entirely (Z-99)"));
await openSearchIndex(box.root);
JSON.stringify(listStale(await loadContainsState(box.root)).filter((p) => p.includes("image")))
=> []

await staleContainsWarning(box.root, { relPath: "store/archive/boiler.image.card", ctx })
=> null
```

```ts cleanup
await box.cleanup();
```
