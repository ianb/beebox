# Gemini JSON response boundary (Track D.5)

`describe-images-helpers.ts` and `scan-import-gemini.ts` used to describe
their Gemini response shape three times over (a hand-written TS interface, a
hand-written `responseSchema` object for the API, and a bare
`JSON.parse(...) as X[]` cast). `parseGeminiJsonArray` is now the single
validation boundary shared by both: valid elements pass through, an
individual malformed element is dropped and logged (mirroring the existing
out-of-range-index drop in `scan-import-helpers.ts`) rather than failing the
whole batch, and a malformed top-level shape (not JSON, or not an array)
throws a distinct `GeminiResponseShapeError` rather than either crashing
uninformatively or silently producing garbage.

```ts setup
import { z } from "zod";
import {
  parseGeminiJsonArray,
  GeminiResponseShapeError,
} from "../../../src/core/commands/describe-images-helpers.js";

const itemSchema = z.object({ index: z.number(), label: z.string() });
const logged: string[] = [];
const log = function (line: string): void { logged.push(line); };
```

Valid elements pass through unchanged:

```ts
const valid = parseGeminiJsonArray(JSON.stringify([{ index: 0, label: "a" }, { index: 1, label: "b" }]), { itemSchema, log });
JSON.stringify(valid)
=> [{"index":0,"label":"a"},{"index":1,"label":"b"}]
```

An element that fails the schema is dropped and logged; the rest still load:

```ts continue
logged.length = 0;
const mixed = parseGeminiJsonArray(JSON.stringify([{ index: 0, label: "a" }, { index: "not-a-number", label: "b" }]), { itemSchema, log });
JSON.stringify(mixed)
=> [{"index":0,"label":"a"}]

logged.length
=> 1
```

Invalid JSON is a whole-response failure, distinct from a Gemini API failure
(`GeminiEmptyResponseError`, a separate class for when Gemini itself declined
to answer):

```ts continue
parseGeminiJsonArray("not json", { itemSchema })
=> throws GeminiResponseShapeError
```

A validly-parsed but non-array top level is the same distinct failure:

```ts continue
parseGeminiJsonArray(JSON.stringify({ index: 0 }), { itemSchema })
=> throws GeminiResponseShapeError
```
