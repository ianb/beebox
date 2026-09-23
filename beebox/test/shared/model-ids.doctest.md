# Canonical model IDs

`normalizeModelId` carries a retired model ID forward to its current
replacement, so a persisted chat selection or a box procedure card that still
names Opus 4.8 (or a `[1m]` context variant Claude Code no longer exposes) keeps
working. Model-policy admission normalizes persisted values, and `agent/run.ts`
provides the final boundary for raw procedure-card IDs.

```ts setup
import { MODEL_ID, normalizeModelId } from "../../src/shared/model-ids.js";
```

## The `opus` flagship is Opus 5.5

```ts
MODEL_ID.opus
=> claude-opus-5-5
```

## Retired IDs translate forward

Opus 5, Opus 4.8, and the old `[1m]` variant fold into Opus 5.5; the Fable
`[1m]` variant folds into Fable 5.1 (1M context is native to the 5-tier).

```ts
normalizeModelId("claude-opus-5")
=> claude-opus-5-5

normalizeModelId("claude-opus-4-8")
=> claude-opus-5-5

normalizeModelId("claude-opus-4-8[1m]")
=> claude-opus-5-5

normalizeModelId("claude-fable-5[1m]")
=> claude-fable-5-1
```

Fable 5 itself is retired the same way: a chat or procedure card that pinned
it keeps working on Fable 5.1.

```ts
normalizeModelId("claude-fable-5")
=> claude-fable-5-1
```

GPT-5.6 Luna and Sol selections move to the corresponding GPT-6 models. Terra
stays on GPT-5.6 because GPT-6 has no Terra tier.

```ts
JSON.stringify([
  normalizeModelId("gpt-5.6-luna"),
  normalizeModelId("gpt-5.6-sol"),
  normalizeModelId("gpt-5.6-terra"),
])
=> ["gpt-6-luna","gpt-6-sol","gpt-5.6-terra"]
```

## Live IDs pass through unchanged

```ts
normalizeModelId(MODEL_ID.sonnet)
=> claude-sonnet-5

normalizeModelId(MODEL_ID.opus)
=> claude-opus-5-5
```
