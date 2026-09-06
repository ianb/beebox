# OpenRouter transcription: shaping the normalized response

The HQ transcription fallback (`src/core/transcription/openrouter.ts`) reaches
the same OpenAI models `whisper.ts` calls directly, and OpenRouter hands back
one normalized shape. These tests cover the translation into the result every
transcription caller already handles — no network, just the shaper.

Two kinds of service arrive here: the Whisper family, for which OpenRouter is a
fallback, and MAI-Transcribe-2 (`mai`, `mai-diarized`), which has no other route
at all. Voxtral is deliberately absent — measured against the live API,
OpenRouter's `voxtral-mini-transcribe` refuses `verbose_json` and cannot
diarize, so that service stays on Mistral.

```ts setup
import { shapeOpenRouterResult, audioFormatToken } from "../../src/core/transcription/openrouter.js";
import {
  HQ_TRANSCRIPTION_SERVICES,
  hqRoutesThroughOpenRouter,
  isMaiHqService,
} from "../../src/core/transcription/index.js";
```

## Which HQ services route here at all

Voxtral stays on Mistral; everything else reaches OpenRouter one way or another.

```ts
const routable = HQ_TRANSCRIPTION_SERVICES.filter(hqRoutesThroughOpenRouter);
routable.join(",")
=> whisper,whisper-llm,whisper-llm-mini,mai,mai-diarized
```

The MAI pair is not a fallback but a requirement — those two have no direct arm,
so `isMaiHqService` is what tells the dispatcher to demand an OpenRouter key
rather than fall back to one.

```ts
const maiOnly = HQ_TRANSCRIPTION_SERVICES.filter(isMaiHqService);
maiOnly.join(",")
=> mai,mai-diarized
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
const withWords = shapeOpenRouterResult(wordBody, { diarization: false, wordTimestamps: true });
JSON.stringify(withWords)
=> {"text":"hello there","duration":1.5,"language":"english","words":[{"word":"hello","start":0,"end":0.4},{"word":"there","start":0.4,"end":0.9}]}
```

Asking for word timing and getting none is not an error — the caller falls
through to the plain result rather than being handed an empty `words` array it
would read as "this recording has no words".

```ts
const bare = { text: "hello there", duration: 1.5, language: "english" };
const noWords = shapeOpenRouterResult(bare, { diarization: false, wordTimestamps: true });
JSON.stringify(noWords)
=> {"text":"hello there","duration":1.5,"language":"english"}
```

## Diarization: a numeric speaker becomes a speaker line

OpenRouter reports the speaker as a number per segment where Voxtral reports a
`speaker_id` string. The number is renamed on the way in so the shared
`buildDiarizedText` produces the same "Speaker N:" transcript from either
backend — a reader downstream cannot tell which service produced it.

```ts
const twoSpeakers = {
  text: "Where did you go?I went home.",
  duration: 4,
  language: "english",
  segments: [{ text: "Where did you go?", start: 0, end: 2, speaker: 0 }, { text: "I went home.", start: 2, end: 4, speaker: 1 }],
};
const diarized = shapeOpenRouterResult(twoSpeakers, { diarization: true, wordTimestamps: false });
diarized.text
=> Speaker 0: Where did you go?
Speaker 1: I went home.

diarized.diarized
=> true
```

Diarization requested but no speaker on any segment is the mono-speaker case, or
a provider that ignored the option. Either way the text is rebuilt from the
segments and `diarized` says plainly that it is not speaker-labeled — which is
the condition the caller warns about.

```ts
const unlabeled = {
  text: "Where did you go?I went home.",
  duration: 4,
  segments: [{ text: "Where did you go?", start: 0, end: 2 }, { text: "I went home.", start: 2, end: 4 }],
};
const mono = shapeOpenRouterResult(unlabeled, { diarization: true, wordTimestamps: false });
`${mono.text} | ${String(mono.diarized)}`
=> Where did you go? I went home. | false
```

Word timing wins when both are asked for, matching `shapeVoxtralResult`: two
diarized services must not disagree about what `--timestamps` returns.

```ts
const both = {
  text: "Where did you go?",
  duration: 2,
  segments: [{ text: "Where did you go?", start: 0, end: 2, speaker: 0 }],
  words: [{ word: "Where", start: 0, end: 0.3 }],
};
const w = shapeOpenRouterResult(both, { diarization: true, wordTimestamps: true });
`words=${String("words" in w ? w.words.length : 0)} diarized=${String(w.diarized)}`
=> words=1 diarized=undefined
```

## Duration falls back rather than reporting a confident zero

Duration lands in a card's frontmatter, where `0s` reads as a fact rather than
as "unknown". The ladder mirrors the direct Voxtral arm's: the top-level field,
then the seconds OpenRouter billed for, then the end of the last timed thing.

```ts
const billed = { text: "hi", usage: { seconds: 9.2 } };
const fromUsage = shapeOpenRouterResult(billed, { diarization: false, wordTimestamps: false });
const timed = { text: "hi", segments: [{ text: "hi", start: 0, end: 3.5 }] };
const fromSegment = shapeOpenRouterResult(timed, { diarization: false, wordTimestamps: false });
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
const plain = shapeOpenRouterResult(unsegmented, { diarization: false, wordTimestamps: false });
JSON.stringify(plain)
=> {"text":"have gone. Generic tools","duration":0,"language":""}
```

## A response with no transcript fails permanently

A body missing its own required field is a contract change, not a bad day —
retrying the same request would produce the same non-answer.

```ts
const textless = { usage: { seconds: 3 } };
shapeOpenRouterResult(textless, { diarization: false, wordTimestamps: false })
=> throws OpenRouterTranscriptionShapeError: OpenRouter transcription response is unusable: expected text
```
