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
import { createFakeEmbeddings, EmbeddingsError, type EmbeddingsService } from "../../../src/services/openai-embeddings.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";

// No ambient key: the no-service cases must resolve to null, never a real
// network-backed service, regardless of the runner's environment.
delete process.env["BBX_OPENAI_API_KEY"];

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

async function throwMessage(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "did not throw";
  } catch (e) {
    return (e as Error).message;
  }
}
```

## auto + service: hybrid ranks the semantically-matched card top

```ts
const box = await makeTmpBox();
await box.write("_content/inbox/Dentist.memo.card", MEMO("The dentist appointment moved.", "Dentist moved to June 17."));
await box.write("_content/inbox/Bill.memo.card", MEMO("The electric bill is due.", "Electric bill due Friday."));
const fake = createFakeEmbeddings();
const res = await searchBox(box.root, { query: "Dentist moved to June 17.", embeddings: fake });
res.searchMode
=> hybrid

res.embeddingsReady
=> true

res.results[0]?.path
=> _content/inbox/Dentist.memo.card

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
await box.write("_content/notes/Dentist.md", "# Dentist\nA plain markdown note about the dentist appointment.\n");
const fakeK = createFakeEmbeddings();
const resK = await searchBox(box.root, { query: "dentist appointment", embeddings: fakeK, kinds: ["memo"] });
resK.searchMode
=> hybrid

resK.results.every((h) => h.kind === "memo")
=> true

resK.results.map((h) => h.path).includes("_content/notes/Dentist.md")
=> false
```

```ts cleanup
await box.cleanup();
```

## mode "text" is fully offline: zero embed calls, works with a broken secret

`--mode text` skips key resolution entirely and passes no service into the
refresh — never a paid call, and never dependent on a key being configured.

```ts
const boxT = await makeTmpBox();
await boxT.write("_content/inbox/Dentist.memo.card", MEMO("The dentist appointment moved.", "Dentist moved to June 17."));
const fakeT = createFakeEmbeddings();
const resT = await searchBox(boxT.root, { query: "dentist", embeddings: fakeT, mode: "text" });
resT.searchMode
=> text

// Zero calls: no corpus embed, no query embed.
fakeT.calls.length
=> 0

// With no `openai` grant, auto mode has no service and ranks as text too --
// unconfigured is a normal state, not an error.
const resTAuto = await searchBox(boxT.root, { query: "dentist" });
resTAuto.searchMode
=> text
```

```ts cleanup
await boxT.cleanup();
```

## ready corpus + query-embed failure: auto degrades with a warning

The corpus embeds fine at refresh (call 1); the query-stage embed (call 2)
fails. Auto mode falls back to text-ranked results and says so.

```ts
const boxQ = await makeTmpBox();
await boxQ.write("_content/inbox/Bill.memo.card", MEMO("The electric bill is due.", "Electric bill due Friday."));
const innerQ = createFakeEmbeddings();
let embedCalls = 0;
const queryStageFails: EmbeddingsService = {
  async embed(texts: string[]): Promise<number[][]> {
    embedCalls += 1;
    if (embedCalls > 1) throw new EmbeddingsError("scripted query-stage failure");
    return innerQ.embed(texts);
  },
};
const resQ = await searchBox(boxQ.root, { query: "electric", embeddings: queryStageFails });
resQ.searchMode
=> text

resQ.embeddingsReady
=> true

resQ.warnings.length
=> 1

resQ.warnings[0]?.startsWith("query embedding failed")
=> true

resQ.results[0]?.path
=> _content/inbox/Bill.memo.card
```

```ts cleanup
await boxQ.cleanup();
```

## auto + failing service: not ready → text mode with a warning

`failTimes` large enough that the refresh's embed pass fails, leaving the
corpus not ready. Auto mode falls back to text and the refresh's warning
surfaces (the query stage is never reached, so no duplicate warning is added).

```ts
const boxF = await makeTmpBox();
await boxF.write("_content/inbox/Bill.memo.card", MEMO("The electric bill is due.", "Electric bill due Friday."));
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
=> _content/inbox/Bill.memo.card
```

```ts cleanup
await boxF.cleanup();
```

## mode "hybrid" with no service throws a typed, actionable error

```ts
const boxH = await makeTmpBox();
await boxH.write("_content/inbox/Dentist.memo.card", MEMO("The dentist appointment moved.", "Dentist moved to June 17."));
await throwName(() => searchBox(boxH.root, { query: "dentist", mode: "hybrid" }))
=> HybridUnavailableError
```

## mode "hybrid" + not-ready carries the refresh-side cause

The forced-hybrid error must not swallow the actionable warning (401,
timeout, …) the refresh pushed when corpus embedding failed.

```ts continue
const flakyH = createFakeEmbeddings({ failTimes: 10 });
const msg = await throwMessage(() => searchBox(boxH.root, { query: "dentist", mode: "hybrid", embeddings: flakyH }));
msg.includes("semantic index not ready")
=> true

msg.includes("embeddings unavailable")
=> true
```

```ts cleanup
await boxH.cleanup();
```
