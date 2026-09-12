# Voice picker capability reason line

`capabilityReason` (`components/chat/VoiceChip-panels.tsx`) maps a
`voice.capabilities` entry — `{ usable, needs }` — to the reason line shown
under a disabled HQ-transcription or TTS-backend option, or `null` when the
option needs no explanation: it's usable, or the capability is unknown
(loading, or a non-owner viewer whose `voice.capabilities` query is gated
off) — Track 5 of docs/plans/secret-entry-guidance.md, so a picker never
blocks an option on a query that hasn't resolved.

```ts setup
import { capabilityReason } from "../../src/frontend/src/components/chat/VoiceChip-panels.js";
```

## Usable needs no reason

```ts
capabilityReason({ usable: true, needs: ["openrouter"] })
=> null
```

## Unknown capability (undefined) needs no reason either

```ts
capabilityReason(undefined)
=> null
```

## Unusable with one missing secret

```ts
capabilityReason({ usable: false, needs: ["openrouter"] })
=> needs the openrouter secret — Admin → Secrets
```

## Unusable with either of two secrets joined by "or"

```ts
capabilityReason({ usable: false, needs: ["openai-thinking", "openrouter"] })
=> needs the openai-thinking or openrouter secret — Admin → Secrets
```
