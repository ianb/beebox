// # Portable procedure model tiers
//
// Procedure cards express provider-relative policy. The same tier resolves to the
// configured engine's native model family; legacy Claude-shaped values remain
// aliases so existing box cards keep loading.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, str } from "@ianbicking/tap-check/check";
import { MODEL_ID } from "../../src/shared/model-ids.js";
import {
  modelTier,
  providerOf,
  resolveProcedureModel,
} from "../../src/shared/agent-models.js";

// ## Native mappings
//
// Each engine has four distinct tiers; Codex's `strongest` is Astra.
void test("Each engine has four distinct tiers; Codex's strongest is Astra.", async (t) => {
  t.check(
    [
      resolveProcedureModel({engine: "claude", model: "efficient"}),
      resolveProcedureModel({engine: "claude", model: "balanced"}),
      resolveProcedureModel({engine: "claude", model: "strong"}),
      resolveProcedureModel({engine: "claude", model: "strongest"}),
      resolveProcedureModel({engine: "codex", model: "efficient"}),
      resolveProcedureModel({engine: "codex", model: "balanced"}),
      resolveProcedureModel({engine: "codex", model: "strong"}),
      resolveProcedureModel({engine: "codex", model: "strongest"}),
    ],
    [
    str`claude-haiku-${any(String)}`,
    str`claude-sonnet-${any(String)}`,
    str`claude-opus-${any(String)}`,
    str`claude-fable-${any(String)}`,
    str`gpt-${any(String)}-luna`,
    str`gpt-${any(String)}-terra`,
    str`gpt-${any(String)}-sol`,
    str`gpt-${any(String)}-astra`,
  ],
  );
});

// ## Legacy aliases
void test("Legacy aliases", async (t) => {
  t.check(
    [
      resolveProcedureModel({engine: "claude", model: "haiku"}),
      resolveProcedureModel({engine: "claude", model: "sonnet"}),
      resolveProcedureModel({engine: "claude", model: "opus"}),
      resolveProcedureModel({engine: "claude", model: "fable"}),
      resolveProcedureModel({engine: "codex", model: "haiku"}),
      resolveProcedureModel({engine: "codex", model: "sonnet"}),
      resolveProcedureModel({engine: "codex", model: "opus"}),
      resolveProcedureModel({engine: "codex", model: "fable"}),
    ],
    [
    str`claude-haiku-${any(String)}`,
    str`claude-sonnet-${any(String)}`,
    str`claude-opus-${any(String)}`,
    str`claude-fable-${any(String)}`,
    str`gpt-${any(String)}-luna`,
    str`gpt-${any(String)}-terra`,
    str`gpt-${any(String)}-sol`,
    str`gpt-${any(String)}-astra`,
  ],
  );
});

// ## Provider columns
//
// GLM rides the claude engine with its own tier column; its two ids overlap
// across the four tiers by design. The default (no provider) stays first-party.
void test("GLM rides the claude engine with its own tier column; its two ids overlap acr...", async (t) => {
  t.check(
    [
      providerOf(MODEL_ID.glm),
      providerOf(MODEL_ID.glmFlash),
      providerOf(MODEL_ID.opus),
      providerOf(MODEL_ID.sol),
    ],
    [
    "glm",
    "glm",
    "anthropic",
    "openai",
  ],
  );
});

void test("Provider columns", async (t) => {
  t.check(
    [
      resolveProcedureModel({engine: "claude", model: "efficient", provider: "glm"}),
      resolveProcedureModel({engine: "claude", model: "balanced", provider: "glm"}),
      resolveProcedureModel({engine: "claude", model: "strong", provider: "glm"}),
      resolveProcedureModel({engine: "claude", model: "strongest", provider: "glm"}),
      resolveProcedureModel({engine: "claude", model: "strong"}),
      // codex has no GLM column — the request falls back to its own provider.
      resolveProcedureModel({engine: "codex", model: "strong", provider: "glm"}),
    ],
    [
    str`glm-${any(String)}-flash`,
    str`glm-${any(String)}-flash`,
    str`glm-${any(String)}`,
    str`glm-${any(String)}`,
    str`claude-opus-${any(String)}`,
    str`gpt-${any(String)}-sol`,
  ],
  );
});

// GLM ids carry tiers, so box-config admission and cross-engine degradation
// work through the existing registry.
void test("GLM ids carry tiers, so box-config admission and cross-engine degradation wor...", async (t) => {
  t.check([modelTier(MODEL_ID.glm), modelTier(MODEL_ID.glmFlash)], [
    "strong",
    "balanced",
  ]);
});
