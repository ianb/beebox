# Style delivery: where each backend's direction goes

The boxholder writes speaking style once, on the personality card. Every
backend takes it somewhere different, and `deliverStyle`
(`src/core/tts/style.ts`) is the pure decision about where — pure precisely
because getting it wrong is inaudible to us and audible to them.

```ts setup
import { deliverStyle } from "../../src/core/tts/style.js";
```

## OpenAI has a field for it

```ts
const openai = deliverStyle({ backend: "openai", text: "The delivery is late.", instructions: "Speak warmly." });
JSON.stringify(openai)
=> {"kind":"field","instructions":"Speak warmly."}
```

## Gemini takes it inside the input, with a colon

Google's documented form is `<direction>: "<text>"`, and the punctuation is
load-bearing rather than stylistic. Measured 2026-09-06: a direction ending in
a **period** followed by a **short** text makes the model return HTTP 200 with
a zero-length body — 0 of 6 renders on one input and 0 of 10 on another, with
retries and a different voice making no difference, while the colon form
rendered 6 of 6 at every length tried. Building the prefix here, once, is what
stops a caller reintroducing that.

```ts
const gemini = deliverStyle({ backend: "gemini", text: "The delivery is late.", instructions: "Speak warmly." });
JSON.stringify(gemini)
=> {"kind":"prefix","input":"Speak warmly: \"The delivery is late.\""}
```

A direction the boxholder ended with a period — the natural way to write a
sentence — is normalized rather than passed through, because that exact form is
the one that fails.

```ts
const dotted = deliverStyle({ backend: "gemini", text: "Hi.", instructions: "Speak warmly and unhurriedly." });
"input" in dotted ? dotted.input : dotted
=> Speak warmly and unhurriedly: "Hi."
```

Trailing colons and stray whitespace collapse the same way, so two cards that
differ only in punctuation produce the same request.

```ts
const messy = deliverStyle({ backend: "gemini", text: "Hi.", instructions: "  Speak warmly:  " });
"input" in messy ? messy.input : messy
=> Speak warmly: "Hi."
```

## No direction is not the same as a backend that cannot take one

With nothing to place, the text is spoken as written and nothing is reported as
dropped — an empty `instructions` must not be logged as a lost setting.

```ts
const bare = deliverStyle({ backend: "gemini", text: "The delivery is late.", instructions: undefined });
JSON.stringify(bare)
=> {"kind":"prefix","input":"The delivery is late."}

const blank = deliverStyle({ backend: "openai", text: "The delivery is late.", instructions: "   " });
JSON.stringify(blank)
=> {"kind":"prefix","input":"The delivery is late."}
```
