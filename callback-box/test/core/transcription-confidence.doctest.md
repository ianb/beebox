# Word confidence plumbing

Deepgram is the only transcription backend that reports per-word acoustic
confidence. `mapDeepgramWords` (`src/core/transcription/deepgram.ts`) carries
it into `WordTimestamp.confidence`, guarding at read because Deepgram success
responses are not zod-validated: a word is only attached with `confidence`
when the raw value is genuinely a `number`. The fake transcription service
(`config/fake-transcription.json`) can script `confidence` on words too, so
doctests can exercise the field without a real Deepgram call.

```ts setup
import { mapDeepgramWords } from "../../src/core/transcription/deepgram.js";
import { transcribeAudioFake } from "../../src/core/transcription/fake.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
```

## Deepgram mapping carries confidence through

```ts
JSON.stringify(
  mapDeepgramWords([
    { word: "cloud", start: 0, end: 0.5, punctuated_word: "cloud", confidence: 0.29 },
  ]),
)
=> [{"word":"cloud","start":0,"end":0.5,"confidence":0.29}]
```

`punctuated_word` still wins over `word` when present, independent of
confidence handling.

```ts
JSON.stringify(
  mapDeepgramWords([
    { word: "hello", start: 0, end: 0.4, confidence: 0.99 },
  ]),
)
=> [{"word":"hello","start":0,"end":0.4,"confidence":0.99}]
```

## Missing or mistyped confidence yields no field, no crash

A word with no `confidence` key at all:

```ts
JSON.stringify(mapDeepgramWords([{ word: "the", start: 0, end: 0.2 }]))
=> [{"word":"the","start":0,"end":0.2}]
```

A response is unvalidated JSON — Deepgram could send a string, `null`, or
anything else in that slot. The `typeof` guard treats every non-number the
same as absent, rather than crashing or coercing.

```ts
// Simulating a malformed untrusted Deepgram response (confidence as a
// string instead of a number) — not a shape `mapDeepgramWords` promises to
// accept, but exactly what an unvalidated boundary can hand it.
const malformedWords = [
  { word: "that", start: 0, end: 0.2, confidence: "0.5" },
] as unknown as Parameters<typeof mapDeepgramWords>[0];
JSON.stringify(mapDeepgramWords(malformedWords))
=> [{"word":"that","start":0,"end":0.2}]
```

Multiple words: only the ones with numeric confidence get the field, in
original order.

```ts
JSON.stringify(
  mapDeepgramWords([
    { word: "I", start: 0, end: 0.1, confidence: 0.99 },
    { word: "can", start: 0.1, end: 0.3, punctuated_word: "can" },
    { word: "run", start: 0.3, end: 0.5, confidence: 0.52 },
  ]),
)
=> [{"word":"I","start":0,"end":0.1,"confidence":0.99},{"word":"can","start":0.1,"end":0.3},{"word":"run","start":0.3,"end":0.5,"confidence":0.52}]
```

## Fake service round-trips scripted confidence

`transcribeAudioFake` reads `config/fake-transcription.json` and returns the
scripted `words` array verbatim — so a test can script `confidence` on a word
just like a real Deepgram batch response would carry it.

```ts
const box = await makeTmpBox();
await box.write(
  "config/fake-transcription.json",
  JSON.stringify({
    "*": {
      text: "cloud code",
      words: [
        { word: "cloud", start: 0, end: 0.5, confidence: 0.29 },
        { word: "code", start: 0.5, end: 1.0 },
      ],
    },
  }),
);
const result = await transcribeAudioFake({
  audioBuffer: Buffer.from(""),
  filename: "clip.webm",
  boxRoot: box.root,
});
JSON.stringify(result.words)
=> [{"word":"cloud","start":0,"end":0.5,"confidence":0.29},{"word":"code","start":0.5,"end":1}]
```

```ts cleanup
await box.cleanup();
```
