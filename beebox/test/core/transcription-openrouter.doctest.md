# OpenRouter transcription: shaping the normalized response

The HQ transcription fallback (`src/core/transcription/openrouter.ts`) reaches
the same OpenAI models `whisper.ts` calls directly, and OpenRouter hands back
one normalized shape. These tests cover the translation into the result every
transcription caller already handles — no network, just the shaper.

Voxtral is deliberately absent: measured against the live API, OpenRouter's
`voxtral-mini-transcribe` refuses `verbose_json` and cannot diarize, so that
service stays on Mistral rather than routing here.

```ts setup
import { shapeOpenRouterResult, audioFormatToken } from "../../src/core/transcription/openrouter.js";
import { hqRoutesThroughOpenRouter } from "../../src/core/transcription/index.js";
```

## Which HQ services route here at all

Voxtral stays on Mistral. `whisper.ts`'s three variants are the whole set.

```ts
const routable = (["whisper", "whisper-llm", "whisper-llm-mini", "voxtral", "voxtral-diarized"] as const)
  .filter(hqRoutesThroughOpenRouter);
routable.join(",")
=> whisper,whisper-llm,whisper-llm-mini
```

## The format token comes off the filename

OpenRouter wants a bare format token, not a MIME type, and derives nothing from
a filename it is never sent. An unrecognized or absent extension falls back to
`webm` — the same guess the direct Whisper arm's `getContentType` makes, so one
recording cannot be read as two different formats depending on the route.

```ts
const tokens = ["memo.wav", "memo.MP3", "memo.mpga", "memo"].map(audioFormatToken);
tokens.join(",")
=> wav,mp3,webm,webm
```

## Word timestamps win when they came back

```ts
const wordBody = {
  text: "hello there",
  duration: 1.5,
  language: "english",
  words: [{ word: " hello ", start: 0, end: 0.4 }, { word: "there", start: 0.4, end: 0.9 }],
};
const withWords = shapeOpenRouterResult(wordBody, { wordTimestamps: true });
JSON.stringify(withWords)
=> {"text":"hello there","duration":1.5,"language":"english","words":[{"word":"hello","start":0,"end":0.4},{"word":"there","start":0.4,"end":0.9}]}
```

Asking for word timing and getting none is not an error — the caller falls
through to the plain result rather than being handed an empty `words` array it
would read as "this recording has no words".

```ts
const bare = { text: "hello there", duration: 1.5, language: "english" };
const noWords = shapeOpenRouterResult(bare, { wordTimestamps: true });
JSON.stringify(noWords)
=> {"text":"hello there","duration":1.5,"language":"english"}
```

## Duration falls back rather than reporting a confident zero

Duration lands in a card's frontmatter, where `0s` reads as a fact rather than
as "unknown". The ladder mirrors the direct Voxtral arm's: the top-level field,
then the seconds OpenRouter billed for, then the end of the last timed thing.

```ts
const billed = { text: "hi", usage: { seconds: 9.2 } };
const fromUsage = shapeOpenRouterResult(billed, { wordTimestamps: false });
const timed = { text: "hi", segments: [{ text: "hi", start: 0, end: 3.5 }] };
const fromSegment = shapeOpenRouterResult(timed, { wordTimestamps: false });
`${String(fromUsage.duration)} ${String(fromSegment.duration)}`
=> 9.2 3.5
```

## No segments: the sentence-spacing repair still applies

The `verbose_json` variants usually return segments, but the LLM audio models
answer with `json` and nothing else. Rejoining is then impossible, so the raw
text goes through the same missing-space repair the Voxtral arm uses. The absent
duration and language read as empty, and the empty language matches what
`whisper.ts` fills on the same models — one recording must not describe itself
differently depending on which key the box holds.

```ts
const unsegmented = { text: "have gone.Generic tools" };
const plain = shapeOpenRouterResult(unsegmented, { wordTimestamps: false });
JSON.stringify(plain)
=> {"text":"have gone. Generic tools","duration":0,"language":""}
```

## A response with no transcript fails permanently

A body missing its own required field is a contract change, not a bad day —
retrying the same request would produce the same non-answer.

```ts
const textless = { usage: { seconds: 3 } };
shapeOpenRouterResult(textless, { wordTimestamps: false })
=> throws OpenRouterTranscriptionShapeError: OpenRouter transcription response is unusable: expected text
```
