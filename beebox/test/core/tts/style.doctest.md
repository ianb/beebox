# Style delivery: where each route's direction goes

The boxholder writes speaking style once, on the personality card. Every
backend takes it somewhere different, and one route cannot take it at all.
`deliverStyle` (`src/core/tts/style.ts`) is the pure decision about where —
pure precisely because getting it wrong is inaudible to us and audible to them.

```ts setup
import { deliverStyle, routeIsStylable } from "../../../src/core/tts/style.js";
```

## OpenAI and direct Gemini each have a field for it

OpenAI's speech request has `instructions`; Google's Interactions API has a
`speech_metadata` annotation. Either way the direction travels beside the
text, never inside it.

```ts
deliverStyle({ backend: "openai", via: "direct", instructions: "Speak warmly." })
=> { kind: "field", instructions: "Speak warmly." }

deliverStyle({ backend: "gemini", via: "direct", instructions: "  Speak warmly.  " })
=> { kind: "field", instructions: "Speak warmly." }
```

## Gemini over OpenRouter drops it, and says what was dropped

Gemini 3.8 reads its input as a verbatim transcript, so a direction prefixed to
the text is spoken aloud, and OpenRouter's speech request has no field that
reaches the model (measured 2026-10-04; `style.ts` has the numbers). The
result carries the lost direction so the caller can name it.

```ts
deliverStyle({ backend: "gemini", via: "openrouter", instructions: "Speak warmly." })
=> { kind: "unsupported", dropped: "Speak warmly." }
```

`routeIsStylable` is the same decision as a yes/no, and it is what
`TtsService.stylable` reports, so the service and the delivery cannot disagree.

```ts
({
  geminiDirect: routeIsStylable("gemini", "direct"),
  geminiOpenRouter: routeIsStylable("gemini", "openrouter"),
  openai: routeIsStylable("openai", "direct"),
})
=> { geminiDirect: true, geminiOpenRouter: false, openai: true }
```

## No direction is not the same as a route that cannot take one

With nothing to place, nothing is reported as dropped — an empty
`instructions` must not be logged as a lost setting, even on the route that
could not have honored it.

```ts
deliverStyle({ backend: "gemini", via: "openrouter", instructions: undefined })
=> { kind: "none" }

deliverStyle({ backend: "openai", via: "direct", instructions: "   " })
=> { kind: "none" }
```
