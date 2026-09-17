# Portable procedure model tiers

Procedure cards express provider-relative policy. The same tier resolves to the
configured engine's native model family; legacy Claude-shaped values remain
aliases so existing box cards keep loading.

```ts setup
import {
  PROCEDURE_MODEL_NAMES,
  modelTier,
  providerOf,
  resolveProcedureModel,
} from "../../src/shared/agent-models.js";
```

## Native mappings

Each engine has four distinct tiers; Codex's `strongest` is Astra.

```ts
JSON.stringify([
  resolveProcedureModel({engine: "claude", model: "efficient"}),
  resolveProcedureModel({engine: "claude", model: "balanced"}),
  resolveProcedureModel({engine: "claude", model: "strong"}),
  resolveProcedureModel({engine: "claude", model: "strongest"}),
  resolveProcedureModel({engine: "codex", model: "efficient"}),
  resolveProcedureModel({engine: "codex", model: "balanced"}),
  resolveProcedureModel({engine: "codex", model: "strong"}),
  resolveProcedureModel({engine: "codex", model: "strongest"}),
])
=> ["claude-haiku-4-5-20251001","claude-sonnet-5","claude-opus-5","claude-fable-5-1","gpt-5.6-luna","gpt-5.6-terra","gpt-5.6-sol","gpt-6-astra"]
```

## Legacy aliases

```ts
JSON.stringify([
  resolveProcedureModel({engine: "claude", model: "haiku"}),
  resolveProcedureModel({engine: "claude", model: "sonnet"}),
  resolveProcedureModel({engine: "claude", model: "opus"}),
  resolveProcedureModel({engine: "claude", model: "fable"}),
  resolveProcedureModel({engine: "codex", model: "haiku"}),
  resolveProcedureModel({engine: "codex", model: "sonnet"}),
  resolveProcedureModel({engine: "codex", model: "opus"}),
  resolveProcedureModel({engine: "codex", model: "fable"}),
])
=> ["claude-haiku-4-5-20251001","claude-sonnet-5","claude-opus-5","claude-fable-5-1","gpt-5.6-luna","gpt-5.6-terra","gpt-5.6-sol","gpt-6-astra"]
```

The schema vocabulary contains both sets exactly once.

```ts
JSON.stringify(PROCEDURE_MODEL_NAMES)
=> ["efficient","balanced","strong","strongest","haiku","sonnet","opus","fable"]
```

## Provider columns

GLM rides the claude engine with its own tier column; its two ids overlap
across the four tiers by design. The default (no provider) stays first-party.

```ts
JSON.stringify([
  providerOf("glm-5.3"),
  providerOf("glm-5.3-flash"),
  providerOf("claude-opus-5"),
  providerOf("gpt-5.6-sol"),
])
=> ["glm","glm","anthropic","openai"]
```

```ts
JSON.stringify([
  resolveProcedureModel({engine: "claude", model: "efficient", provider: "glm"}),
  resolveProcedureModel({engine: "claude", model: "balanced", provider: "glm"}),
  resolveProcedureModel({engine: "claude", model: "strong", provider: "glm"}),
  resolveProcedureModel({engine: "claude", model: "strongest", provider: "glm"}),
  resolveProcedureModel({engine: "claude", model: "strong"}),
  // codex has no GLM column — the request falls back to its own provider.
  resolveProcedureModel({engine: "codex", model: "strong", provider: "glm"}),
])
=> ["glm-5.3-flash","glm-5.3-flash","glm-5.3","glm-5.3","claude-opus-5","gpt-5.6-sol"]
```

GLM ids carry tiers, so box-config admission and cross-engine degradation
work through the existing registry.

```ts
JSON.stringify([modelTier("glm-5.3"), modelTier("glm-5.3-flash")])
=> ["strong","balanced"]
```
