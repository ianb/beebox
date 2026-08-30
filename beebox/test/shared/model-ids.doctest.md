# Canonical model IDs

`normalizeModelId` carries a retired model ID forward to its current
replacement, so a persisted chat selection or a box procedure card that still
names Opus 4.8 (or a `[1m]` context variant Claude Code no longer exposes) keeps
working. It's applied once at the agent spawn boundary (`agent/run.ts`).

```ts setup
import { MODEL_ID, normalizeModelId } from "../../src/shared/model-ids.js";
```

## The `opus` flagship is Opus 5

```ts
MODEL_ID.opus
=> claude-opus-5
```

## Retired IDs translate forward

Opus 4.8 and its `[1m]` variant fold into Opus 5; the Fable `[1m]` variant folds
into plain Fable 5 (1M context is native to the 5-tier).

```ts
normalizeModelId("claude-opus-4-8")
=> claude-opus-5

normalizeModelId("claude-opus-4-8[1m]")
=> claude-opus-5

normalizeModelId("claude-fable-5[1m]")
=> claude-fable-5
```

## Live IDs pass through unchanged

```ts
normalizeModelId(MODEL_ID.sonnet)
=> claude-sonnet-5

normalizeModelId("claude-opus-5")
=> claude-opus-5
```
