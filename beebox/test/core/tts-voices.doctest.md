# Voices, per backend

A personality card names a voice from `VOICE_MODELS` (alloy…verse). **Zero of
those exist on Gemini** — sending one is an HTTP 400 from the provider, not a
graceful default — so `resolveVoice` (`src/core/tts/voices.ts`) decides what a
backend can actually be asked for, and reports when the boxholder's choice was
not it.

```ts setup
import { resolveVoice } from "../../src/core/tts/voices.js";
```

## A voice the backend serves is used as asked

```ts
JSON.stringify(resolveVoice({ backend: "openai", requested: "coral" }))
=> {"kind":"as-requested","voice":"coral"}

JSON.stringify(resolveVoice({ backend: "gemini", requested: "Puck" }))
=> {"kind":"as-requested","voice":"Puck"}
```

## A voice it cannot serve is substituted, and says what was lost

This is the case that matters: every OpenAI voice name reaching Gemini is one
of these, including `marin`, which is what the route sends when a box has set
no voice at all.

```ts
JSON.stringify(resolveVoice({ backend: "gemini", requested: "marin" }))
=> {"kind":"substituted","voice":"Zephyr","requested":"marin"}

JSON.stringify(resolveVoice({ backend: "openai", requested: "Zephyr" }))
=> {"kind":"substituted","voice":"marin","requested":"Zephyr"}
```

The substitution is mechanical, not semantic — `onyx` does not become whichever
Gemini voice sounds most like it. Which voice a box *should* use on a new
backend is the boxholder's call, not a mapping table's.

```ts
const deep = resolveVoice({ backend: "gemini", requested: "onyx" });
deep.kind === "substituted" ? deep.voice : deep.voice
=> Zephyr
```

## Asking for nothing is not a substitution

There is no choice to report as overridden, so the default is returned plainly
and nothing is warned about.

```ts
JSON.stringify(resolveVoice({ backend: "gemini", requested: undefined }))
=> {"kind":"as-requested","voice":"Zephyr"}

JSON.stringify(resolveVoice({ backend: "openai", requested: "  " }))
=> {"kind":"as-requested","voice":"marin"}
```
