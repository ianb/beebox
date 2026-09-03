# Portable procedure model tiers

Procedure cards express provider-relative policy. The same tier resolves to the
configured engine's native model family; legacy Claude-shaped values remain
aliases so existing box cards keep loading.

```ts setup
import {
  PROCEDURE_MODEL_NAMES,
  resolveProcedureModel,
} from "../../src/shared/agent-models.js";
```

## Native mappings

Claude has four distinct tiers. Codex currently has three, so both high-end
policies select Sol.

```ts
JSON.stringify([
  resolveProcedureModel("claude", "efficient"),
  resolveProcedureModel("claude", "balanced"),
  resolveProcedureModel("claude", "strong"),
  resolveProcedureModel("claude", "strongest"),
  resolveProcedureModel("codex", "efficient"),
  resolveProcedureModel("codex", "balanced"),
  resolveProcedureModel("codex", "strong"),
  resolveProcedureModel("codex", "strongest"),
])
=> ["claude-haiku-4-5-20251001","claude-sonnet-5","claude-opus-5","claude-fable-5-1","gpt-5.6-luna","gpt-5.6-terra","gpt-5.6-sol","gpt-5.6-sol"]
```

## Legacy aliases

```ts
JSON.stringify([
  resolveProcedureModel("claude", "haiku"),
  resolveProcedureModel("claude", "sonnet"),
  resolveProcedureModel("claude", "opus"),
  resolveProcedureModel("claude", "fable"),
  resolveProcedureModel("codex", "haiku"),
  resolveProcedureModel("codex", "sonnet"),
  resolveProcedureModel("codex", "opus"),
  resolveProcedureModel("codex", "fable"),
])
=> ["claude-haiku-4-5-20251001","claude-sonnet-5","claude-opus-5","claude-fable-5-1","gpt-5.6-luna","gpt-5.6-terra","gpt-5.6-sol","gpt-5.6-sol"]
```

The schema vocabulary contains both sets exactly once.

```ts
JSON.stringify(PROCEDURE_MODEL_NAMES)
=> ["efficient","balanced","strong","strongest","haiku","sonnet","opus","fable"]
```
