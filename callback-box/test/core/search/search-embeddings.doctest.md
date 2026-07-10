# search: the refresh embedding pass — vectors, readiness, degradation

`openSearchIndex` takes an optional `embeddings` service. When present, after
the text refresh it batch-embeds every contains-bearing card whose `contains`
changed (or was never embedded) and re-inserts its whole-card doc with a
`vector[512]`. `embeddingsReady` is true only when a service is configured and
no card is left pending — the signal the query layer gates hybrid on.

```ts setup
import { search, getByID } from "@orama/orama";
import { openSearchIndex } from "../../../src/core/search/refresh.js";
import { loadManifest } from "../../../src/core/search/manifest.js";
import { createFakeEmbeddings } from "../../../src/services/openai-embeddings.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";

const MEMO = (text: string, contains?: string) =>
  `---\ncreated: 2026-05-22T10:00:00Z\n${contains ? `contains: ${contains}\n` : ""}---\n${text}\n`;

// The deterministic vector the fake produces for a text — identical text
// always yields the identical vector, so a fresh fake reproduces what the
// build stored.
async function fakeVec(text: string): Promise<number[]> {
  return (await createFakeEmbeddings().embed([text]))[0] ?? [];
}
```

## Cold build with a service: contains-bearing cards get vectors, others don't

```ts
const box = await makeTmpBox();
await box.write("box/inbox/Dentist.memo.card", MEMO("The dentist appointment moved.", "Dentist moved to June 17."));
await box.write("store/notes/Plain.memo.card", MEMO("Just a note with no contains yet."));
const fake = createFakeEmbeddings();
const built = await openSearchIndex(box.root, { embeddings: fake });
built.embeddingsReady
=> true

JSON.stringify(built.warnings)
=> []

// Exactly one batched embed call for the one contains-bearing card.
fake.calls.length
=> 1

JSON.stringify(fake.calls[0])
=> ["Dentist moved to June 17."]

// The whole-card doc holds the fake's deterministic vector for that contains.
const dentist = getByID(built.db, "box/inbox/Dentist.memo.card#");
JSON.stringify(dentist?.embedding) === JSON.stringify(await fakeVec("Dentist moved to June 17."))
=> true

// A card with no contains gets no vector.
const plain = getByID(built.db, "store/notes/Plain.memo.card#");
plain?.embedding === undefined
=> true

// The manifest records the embedded card's hash, and leaves the other's unset.
const m1 = await loadManifest(box.root);
typeof m1.files["box/inbox/Dentist.memo.card"]?.embeddedHash
=> string

m1.files["store/notes/Plain.memo.card"]?.embeddedHash === undefined
=> true
```

## Second refresh, nothing changed: no new embed call, still ready

```ts continue
const again = await openSearchIndex(box.root, { embeddings: fake });
again.embeddingsReady
=> true

// Pending set is empty, so the fake is never called again.
fake.calls.length
=> 1
```

## Editing a card's contains re-embeds exactly that text

```ts continue
await box.write("box/inbox/Dentist.memo.card", MEMO("The dentist appointment moved.", "Dentist moved to July 2 instead."));
const edited = await openSearchIndex(box.root, { embeddings: fake });
edited.embeddingsReady
=> true

fake.calls.length
=> 2

JSON.stringify(fake.calls[1])
=> ["Dentist moved to July 2 instead."]

const reDentist = getByID(edited.db, "box/inbox/Dentist.memo.card#");
JSON.stringify(reDentist?.embedding) === JSON.stringify(await fakeVec("Dentist moved to July 2 instead."))
=> true
```

## Persist → restore → vector search round-trip (pins oramasearch/orama#834)

A fresh `openSearchIndex` restores the index from disk; the persisted vectors
must survive the round-trip and answer a native vector search.

```ts continue
const restored = await openSearchIndex(box.root);
const vec = await fakeVec("Dentist moved to July 2 instead.");
const vhits = await search(restored.db, { mode: "vector", vector: { value: vec, property: "embedding" }, similarity: 0.9, limit: 5 });
vhits.hits.map((h) => h.document.path as string).join("\n")
=> box/inbox/Dentist.memo.card
```

## No service: not ready, no warning (the designed not-configured state)

```ts continue
const noService = await openSearchIndex(box.root);
noService.embeddingsReady
=> false

JSON.stringify(noService.warnings)
=> []
```

## Embed failure degrades visibly, re-pends, and reports not-ready

```ts continue
const box2 = await makeTmpBox();
await box2.write("box/inbox/Bill.memo.card", MEMO("The electric bill is due.", "Electric bill due Friday."));
const flaky = createFakeEmbeddings({ failTimes: 1 });
const failed = await openSearchIndex(box2.root, { embeddings: flaky });
failed.embeddingsReady
=> false

failed.warnings.length
=> 1

failed.warnings[0]?.startsWith("embeddings unavailable")
=> true

// Text search still answers, and the text side persisted.
const textHit = await search(failed.db, { term: "electric", properties: ["contains", "content"] });
textHit.hits.map((h) => h.document.path as string).join("\n")
=> box/inbox/Bill.memo.card

const failedManifest = await loadManifest(box2.root);
failedManifest.files["box/inbox/Bill.memo.card"]?.embeddedHash === undefined
=> true

// Same fake instance, next refresh: the card re-pends and this time succeeds.
const retried = await openSearchIndex(box2.root, { embeddings: flaky });
retried.embeddingsReady
=> true

const bill = getByID(retried.db, "box/inbox/Bill.memo.card#");
JSON.stringify(bill?.embedding) === JSON.stringify(await fakeVec("Electric bill due Friday."))
=> true
```

```ts cleanup
await box.cleanup();
await box2.cleanup();
```
