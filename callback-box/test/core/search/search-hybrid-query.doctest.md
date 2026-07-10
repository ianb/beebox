# search: hybrid query mode — embeddingsReady-gated vector ranking

`searchBox` embeds the query and runs Orama's `mode: "hybrid"` (BM25 + vector
fused) when an embeddings service is configured AND the refresh reports the
corpus fully embedded (`embeddingsReady`). It degrades to text-only — visibly,
with a warning — when the corpus isn't ready or the query embed fails, and
silently when no key is configured (the designed normal state). `--mode text`
forces text ranking offline; `--mode hybrid` fails loudly when it can't run.

The fake embedder is deterministic: identical text → identical unit vector →
cosine similarity 1.0, so querying the exact text of a card's `contains` makes
the vector half rank that card top.

```ts setup
import { searchBox } from "../../../src/core/search/query.js";
import { createFakeEmbeddings } from "../../../src/services/openai-embeddings.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";

// No ambient key: the no-service cases must resolve to null, never a real
// network-backed service, regardless of the runner's environment.
delete process.env["CALLBACK_OPENAI_API_KEY"];

const MEMO = (text: string, contains?: string) =>
  `---\ncreated: 2026-05-22T10:00:00Z\n${contains ? `contains: ${contains}\n` : ""}---\n${text}\n`;

// Run an awaitable and report the thrown error's class name (or "no throw").
async function throwName(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "did not throw";
  } catch (e) {
    return (e as Error).name;
  }
}
```

## auto + service: hybrid ranks the semantically-matched card top

```ts
const box = await makeTmpBox();
await box.write("box/inbox/Dentist.memo.card", MEMO("The dentist appointment moved.", "Dentist moved to June 17."));
await box.write("box/inbox/Bill.memo.card", MEMO("The electric bill is due.", "Electric bill due Friday."));
const fake = createFakeEmbeddings();
const res = await searchBox(box.root, { query: "Dentist moved to June 17.", embeddings: fake });
res.searchMode
=> hybrid

res.embeddingsReady
=> true

res.results[0]?.path
=> box/inbox/Dentist.memo.card

JSON.stringify(res.warnings)
=> []
```

## auto + no service: text mode, no warning (the designed not-configured state)

```ts continue
const res2 = await searchBox(box.root, { query: "dentist" });
res2.searchMode
=> text

res2.embeddingsReady
=> false

JSON.stringify(res2.warnings)
=> []
```

## kind filter composes with hybrid

A `--kind`-restricted hybrid search returns only that kind; the `where` filter
applies to both the text and vector halves.

```ts continue
await box.write("store/notes/Dentist.md", "# Dentist\nA plain markdown note about the dentist appointment.\n");
const fakeK = createFakeEmbeddings();
const resK = await searchBox(box.root, { query: "dentist appointment", embeddings: fakeK, kinds: ["memo"] });
resK.searchMode
=> hybrid

resK.results.every((h) => h.kind === "memo")
=> true

resK.results.map((h) => h.path).includes("store/notes/Dentist.md")
=> false
```

```ts cleanup
await box.cleanup();
```

## mode "text" with a service: no query embed beyond the refresh's

`--mode text` never embeds the query — the only embed call is the refresh's
corpus pass.

```ts
const boxT = await makeTmpBox();
await boxT.write("box/inbox/Dentist.memo.card", MEMO("The dentist appointment moved.", "Dentist moved to June 17."));
const fakeT = createFakeEmbeddings();
const resT = await searchBox(boxT.root, { query: "dentist", embeddings: fakeT, mode: "text" });
resT.searchMode
=> text

// One call: the refresh's corpus embed. No second call for the query.
fakeT.calls.length
=> 1
```

```ts cleanup
await boxT.cleanup();
```

## auto + failing service: not ready → text mode with a warning

`failTimes` large enough that the refresh's embed pass fails, leaving the
corpus not ready. Auto mode falls back to text and the refresh's warning
surfaces (the query stage is never reached, so no duplicate warning is added).

```ts
const boxF = await makeTmpBox();
await boxF.write("box/inbox/Bill.memo.card", MEMO("The electric bill is due.", "Electric bill due Friday."));
const flaky = createFakeEmbeddings({ failTimes: 10 });
const resF = await searchBox(boxF.root, { query: "electric", embeddings: flaky });
resF.searchMode
=> text

resF.embeddingsReady
=> false

resF.warnings.length
=> 1

resF.warnings[0]?.startsWith("embeddings unavailable")
=> true

// Text search still answers.
resF.results[0]?.path
=> box/inbox/Bill.memo.card
```

```ts cleanup
await boxF.cleanup();
```

## mode "hybrid" with no service throws a typed, actionable error

```ts
const boxH = await makeTmpBox();
await boxH.write("box/inbox/Dentist.memo.card", MEMO("The dentist appointment moved.", "Dentist moved to June 17."));
await throwName(() => searchBox(boxH.root, { query: "dentist", mode: "hybrid" }))
=> HybridUnavailableError
```

```ts cleanup
await boxH.cleanup();
```
