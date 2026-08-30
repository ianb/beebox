# OpenAI embeddings service — fake determinism, call recording, key resolution

`EmbeddingsService` wraps OpenAI's `/v1/embeddings` endpoint. The fake
derives deterministic unit vectors from each text so tests never need a
real key. `getOpenAiEmbeddingsKey` resolves the API key the same way
`mistral-key.ts` does, but stricter: an absent secret file falls through to
the env var; a present-but-malformed one throws.

```ts setup
import {
  EMBEDDING_DIMENSIONS,
  EMBEDDER_ID,
  createFakeEmbeddings,
  parseEmbeddingsResponse,
  chunkTexts,
} from "../src/services/openai-embeddings.js";
import { getOpenAiEmbeddingsKey } from "../src/core/search/embeddings-key.js";
import { makeTmpBox } from "./helpers/doctest-helpers.js";

function magnitude(vector: number[]): number {
  return Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
}
```

## Deterministic unit vectors: identical text → identical vector

```ts
const fake = createFakeEmbeddings();
const [a, b, c] = await fake.embed(["the dentist moved to June 17", "the dentist moved to June 17", "plant the tomatoes"]);
a?.length
=> 512

EMBEDDING_DIMENSIONS
=> 512

JSON.stringify(a) === JSON.stringify(b)
=> true

JSON.stringify(a) === JSON.stringify(c)
=> false

Math.abs(magnitude(a ?? []) - 1) < 1e-9
=> true
```

## Call recording and describe()

```ts continue
fake.calls.length
=> 1

fake.describe()
=> calls: 1
[0] the dentist moved to June 17 | the dentist moved to June 17 | plant the tomatoes
```

## Empty input returns an empty result

```ts continue
const emptyFake = createFakeEmbeddings();
await emptyFake.embed([])
=> []
```

## `failTimes` scripts N failures before succeeding

```ts continue
async function embedErrorName(svc: { embed(texts: string[]): Promise<number[][]> }, texts: string[]): Promise<string> {
  try {
    await svc.embed(texts);
    return "(no error thrown)";
  } catch (e) {
    return (e as Error).name;
  }
}

const flaky = createFakeEmbeddings({ failTimes: 2 });
await embedErrorName(flaky, ["a"])
=> EmbeddingsError

await embedErrorName(flaky, ["a"])
=> EmbeddingsError

const recovered = await flaky.embed(["a"]);
recovered.length
=> 1

flaky.calls.length
=> 3
```

## Response validation: every malformed shape is a typed EmbeddingsError

The real service parses untrusted API responses through
`parseEmbeddingsResponse`; nothing malformed may escape as a raw
`TypeError` — the refresh and query layers degrade on `EmbeddingsError`
specifically.

```ts continue
function okVector(): number[] {
  return Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.1);
}

parseEmbeddingsResponse({ data: [{ index: 0, embedding: okVector() }] }, 1).length
=> 1

parseEmbeddingsResponse(null, 1)
=> throws EmbeddingsError

parseEmbeddingsResponse({}, 1)
=> throws EmbeddingsError

parseEmbeddingsResponse({ data: [] }, 1)
=> throws EmbeddingsError

parseEmbeddingsResponse({ data: [null] }, 1)
=> throws EmbeddingsError

parseEmbeddingsResponse({ data: [{ index: 1, embedding: okVector() }] }, 1)
=> throws EmbeddingsError

parseEmbeddingsResponse({ data: [{ index: 0 }] }, 1)
=> throws EmbeddingsError

parseEmbeddingsResponse({ data: [{ index: 0, embedding: [0.1, 0.2] }] }, 1)
=> throws EmbeddingsError

parseEmbeddingsResponse({ data: [{ index: 0, embedding: okVector().map(() => "x") }] }, 1)
=> throws EmbeddingsError

parseEmbeddingsResponse({ data: [{ index: 0, embedding: okVector().map(() => NaN) }] }, 1)
=> throws EmbeddingsError
```

## Request chunking respects input-count and character budgets

```ts continue
chunkTexts([]).length
=> 0

chunkTexts(["a", "b"]).length
=> 1

const manyTexts = Array.from({ length: 2049 }, (_, i) => `t${i}`);
const byCount = chunkTexts(manyTexts);
JSON.stringify(byCount.map((c) => c.length))
=> [2048,1]

const bigTexts = ["x".repeat(250_000), "y".repeat(250_000), "z"];
const byChars = chunkTexts(bigTexts);
JSON.stringify(byChars.map((c) => c.length))
=> [1,2]

byChars.flat().join("").length === bigTexts.join("").length
=> true
```

## EMBEDDER_ID names provider, model, and dims

```ts continue
EMBEDDER_ID
=> openai:text-embedding-3-small@512
```

## Key resolution: absent secret file + no env falls through to null

```ts continue
const box = await makeTmpBox();
await getOpenAiEmbeddingsKey(box.root)
=> null
```

## Key resolution: absent secret file falls through to the env var

```ts continue
process.env["BBX_OPENAI_API_KEY"] = "env-key-123";
const fromEnv = await getOpenAiEmbeddingsKey(box.root);
delete process.env["BBX_OPENAI_API_KEY"];
fromEnv
=> env-key-123
```

## Key resolution: a valid secret file wins over the env var

```ts continue
await box.write("config/connectors/openai.secret.json", JSON.stringify({ apiKey: "file-key-456" }));
process.env["BBX_OPENAI_API_KEY"] = "env-key-123";
const fromFile = await getOpenAiEmbeddingsKey(box.root);
delete process.env["BBX_OPENAI_API_KEY"];
fromFile
=> file-key-456
```

## Key resolution: a malformed secret file throws loudly, never falls back

```ts continue
async function keyErrorName(): Promise<string> {
  try {
    await getOpenAiEmbeddingsKey(box.root);
    return "(no error thrown)";
  } catch (e) {
    return (e as Error).name;
  }
}

await box.write("config/connectors/openai.secret.json", "not valid json");
await keyErrorName()
=> EmbeddingsKeyError

await box.write("config/connectors/openai.secret.json", JSON.stringify({ notAnApiKey: "x" }));
await keyErrorName()
=> EmbeddingsKeyError

await box.write("config/connectors/openai.secret.json", JSON.stringify({ apiKey: "" }));
await keyErrorName()
=> EmbeddingsKeyError
```

```ts cleanup
await box.cleanup();
```
