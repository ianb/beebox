# Deepgram word extraction — boundary guard

`extractFinalWords` (`src/frontend/src/machines/transcription-connections.ts`)
reads `msg.channel.alternatives[0].words[]` off a raw-`JSON.parse`'d Deepgram
message — not zod-validated, per the plan's Track 2 spec
(`docs/plans/transcript-confidence.md`). It prefers `punctuated_word` (to
match how `accumulatedFinal` is built from the smart-formatted transcript),
attaches `confidence` only when it's a real number, and skips a malformed
entry rather than failing the whole message.

```ts setup
import { extractFinalWords } from "../../src/frontend/src/machines/transcription-connections.js";
```

## Well-formed words: punctuated_word preferred, confidence carried

```ts
const msg = {
  type: "Results",
  is_final: true,
  channel: {
    alternatives: [{
      transcript: "Hello, world.",
      words: [
        { word: "hello", punctuated_word: "Hello,", confidence: 0.98 },
        { word: "world", punctuated_word: "world.", confidence: 0.42 },
      ],
    }],
  },
};
JSON.stringify(extractFinalWords(msg))
=> [{"word":"Hello,","confidence":0.98},{"word":"world.","confidence":0.42}]
```

## Missing confidence: word carried with no confidence field

```ts
const msg = {
  channel: { alternatives: [{ words: [{ word: "hi", punctuated_word: "hi" }] }] },
};
JSON.stringify(extractFinalWords(msg))
=> [{"word":"hi"}]
```

## Non-numeric confidence is dropped, not coerced

```ts
const msg = {
  channel: { alternatives: [{ words: [{ word: "hi", confidence: "0.9" }] }] },
};
JSON.stringify(extractFinalWords(msg))
=> [{"word":"hi"}]
```

## No punctuated_word: falls back to word

```ts
const msg = {
  channel: { alternatives: [{ words: [{ word: "hi", confidence: 0.5 }] }] },
};
JSON.stringify(extractFinalWords(msg))
=> [{"word":"hi","confidence":0.5}]
```

## An entry with no usable string word is skipped, not fatal

```ts
const msg = {
  channel: {
    alternatives: [{
      words: [
        { confidence: 0.9 },
        { word: 42, confidence: 0.9 },
        { word: "ok", confidence: 0.9 },
      ],
    }],
  },
};
JSON.stringify(extractFinalWords(msg))
=> [{"word":"ok","confidence":0.9}]
```

## Malformed shape at any level returns an empty list

```ts
extractFinalWords(null).length
=> 0

extractFinalWords({}).length
=> 0

extractFinalWords({ channel: {} }).length
=> 0

extractFinalWords({ channel: { alternatives: [] } }).length
=> 0

extractFinalWords({ channel: { alternatives: [{ words: "not-an-array" }] } }).length
=> 0
```
