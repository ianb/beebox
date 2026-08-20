# Transcription reconnect merge — text and words stay in lockstep

`mergeFinalText`/`mergeFinalWords` (`src/frontend/src/machines/transcription-merge.ts`)
are the pure functions `TranscriptionSession` (`transcription-actor.ts`) calls
at every point it folds a dying connection's confirmed text/words into the
segment's committed prefix across a reconnect. They're called at the *same*
call sites with the *same* shape, so the word list can never drift out of
step with the text it describes — the Track 2 reconnect direction detail in
`docs/plans/transcript-confidence.md`.

```ts setup
import { mergeFinalText, mergeFinalWords } from "../../src/frontend/src/machines/transcription-merge.js";
```

## No committed prefix yet (first connection of a segment)

```ts
mergeFinalText("", "hello world")
=> hello world

JSON.stringify(mergeFinalWords([], [{ word: "hello" }, { word: "world", confidence: 0.9 }]))
=> [{"word":"hello"},{"word":"world","confidence":0.9}]
```

## A committed prefix is prepended

```ts
mergeFinalText("hello", "world")
=> hello world

JSON.stringify(mergeFinalWords([{ word: "hello", confidence: 0.99 }], [{ word: "world", confidence: 0.9 }]))
=> [{"word":"hello","confidence":0.99},{"word":"world","confidence":0.9}]
```

## Empty new text/words fall back to just the prefix

```ts
mergeFinalText("hello", "")
=> hello

JSON.stringify(mergeFinalWords([{ word: "hello" }], []))
=> [{"word":"hello"}]
```

## Two reconnects: the fold composes without dropping earlier words

Mirrors `beginReconnect`'s fold sequence: connection 1 emits "hello", drops;
connection 2 emits "there", drops again; connection 3 emits "world".

```ts
let text = mergeFinalText("", "hello");
let words = mergeFinalWords([], [{ word: "hello", confidence: 0.9 }]);

// Reconnect 1: fold connection 1's confirmed output into the prefix.
text = mergeFinalText(text, "");
words = mergeFinalWords(words, []);

// Connection 2 emits its own from-scratch accumulation.
text = mergeFinalText(text, "there");
words = mergeFinalWords(words, [{ word: "there", confidence: 0.4 }]);

// Reconnect 2: fold connection 2's confirmed output into the prefix.
text = mergeFinalText(text, "");
words = mergeFinalWords(words, []);

// Connection 3 emits its own from-scratch accumulation.
text = mergeFinalText(text, "world");
words = mergeFinalWords(words, [{ word: "world", confidence: 0.99 }]);

text
=> hello there world

JSON.stringify(words)
=> [{"word":"hello","confidence":0.9},{"word":"there","confidence":0.4},{"word":"world","confidence":0.99}]
```

## `null` stays `null` across a reconnect (Voxtral/OpenAI — Fix A)

A service that never attaches confidence data reports `null`, not `[]`, at
every connection — `mergeFinalWords` must never manufacture a `[]` that
looks like "captured, empty" out of two "no data" folds (that's exactly
what let a Voxtral send falsely stamp `stt="deepgram"`).

```ts
mergeFinalWords(null, null)
=> null
```

Any side actually holding words wins — a mid-segment service switch isn't
real, but the merge must still not lose data if it were:

```ts
JSON.stringify(mergeFinalWords(null, [{ word: "hi", confidence: 0.9 }]))
=> [{"word":"hi","confidence":0.9}]

JSON.stringify(mergeFinalWords([{ word: "hi", confidence: 0.9 }], null))
=> [{"word":"hi","confidence":0.9}]
```
