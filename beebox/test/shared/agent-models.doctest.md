# Portable procedure model tiers

Procedure cards express provider-relative policy. The same tier resolves to the
configured engine's native model family; legacy Claude-shaped values remain
aliases so existing box cards keep loading.

```ts setup
import { MODEL_ID } from "../../src/shared/model-ids.js";
import {
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
=> ["claude-haiku-«*»","claude-sonnet-«*»","claude-opus-«*»","claude-fable-«*»","gpt-«*»-luna","gpt-«*»-terra","gpt-«*»-sol","gpt-«*»-astra"]
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
=> ["claude-haiku-«*»","claude-sonnet-«*»","claude-opus-«*»","claude-fable-«*»","gpt-«*»-luna","gpt-«*»-terra","gpt-«*»-sol","gpt-«*»-astra"]
```

## Provider columns

GLM rides the claude engine with its own tier column; its two ids overlap
across the four tiers by design. The default (no provider) stays first-party.

```ts
JSON.stringify([
  providerOf(MODEL_ID.glm),
  providerOf(MODEL_ID.glmFlash),
  providerOf(MODEL_ID.opus),
  providerOf(MODEL_ID.sol),
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
=> ["glm-«*»-flash","glm-«*»-flash","glm-«*»","glm-«*»","claude-opus-«*»","gpt-«*»-sol"]
```

GLM ids carry tiers, so box-config admission and cross-engine degradation
work through the existing registry.

```ts
JSON.stringify([modelTier(MODEL_ID.glm), modelTier(MODEL_ID.glmFlash)])
=> ["strong","balanced"]
```
