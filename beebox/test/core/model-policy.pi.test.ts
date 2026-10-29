// # Model policy on pi: added models only, no tier table
//
// pi has no models of its own (docs/plans/pi-box-engine.md, Track 2). Each
// resolver that would otherwise ask the tier table answers from the box's
// added OpenRouter list and its two slots, or answers `null` so the run
// refuses. None of them reaches `resolveProcedureModel`, whose invariant
// would throw.
//
// These call the pure resolvers. The loaders (`loadTierResolver`,
// `loadEffectiveSmallModel`) need a box whose config says `agentEngine: "pi"`,
// which config refuses until pi's chat backend lands (Track 6).

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { resolveProcedureModel } from "../../src/shared/agent-models.js";
import {
  boxDefaultModel,
  resolveBoxModelForEngine,
  resolveEffectiveModel,
  resolveSmallModelForEngine,
  resolveTierModel,
} from "../../src/core/model-policy.js";
import { piModelMissing } from "../../src/core/provider-env/openrouter-chat.js";

const qwen = { id: "qwen/qwen3-coder", label: "Qwen3 Coder" };
const deepseek = { id: "deepseek/deepseek-chat-v3.1", label: "DeepSeek v3.1" };
const added = [qwen, deepseek];
const opus = resolveProcedureModel({ engine: "claude", model: "strong" });
const haiku = resolveProcedureModel({ engine: "claude", model: "efficient" });

// An added pin runs; any other pin is no pin, since pi has no tier to
// translate it by. An unpinned pi box has no default.
void test("the box default on pi is an added pin or nothing", async (t) => {
  t.check([
    resolveBoxModelForEngine("pi", { pinned: qwen.id, added }),
    resolveBoxModelForEngine("pi", { pinned: opus, added }),
    resolveBoxModelForEngine("pi", { pinned: "removed/model", added }),
    boxDefaultModel("pi", { pinned: null, added }),
    boxDefaultModel("pi", { pinned: qwen.id, added }),
  ], [qwen.id, null, null, null, qwen.id]);
});

// A chat's own pick of a removed added model is kept for the spawn to refuse,
// as on claude. A pick of a Claude model falls through to the box default.
void test("a chat on pi keeps a removed added pick and drops a Claude pick", async (t) => {
  t.check([
    resolveEffectiveModel({ engine: "pi", pinned: qwen.id, added }, { kind: "explicit", model: "removed/model" }),
    resolveEffectiveModel({ engine: "pi", pinned: qwen.id, added }, { kind: "explicit", model: opus }),
    resolveEffectiveModel({ engine: "pi", pinned: null, added }, { kind: "explicit", model: opus }),
    resolveEffectiveModel({ engine: "pi", pinned: null, added }, { kind: "follow" }),
  ], [
    { model: "removed/model", source: "explicit" },
    { model: qwen.id, source: "default" },
    { model: null, source: "none" },
    { model: null, source: "none" },
  ]);
});

// A pinned small model runs only if it is added, else the box default. A
// Haiku `smallModel` left from the box's claude days is the case that used to
// reach the tier table and throw.
void test("the small slot on pi is an added pin, else the default, else null", async (t) => {
  t.check([
    resolveSmallModelForEngine({ engine: "pi", pinned: deepseek.id, added, boxDefault: qwen.id }),
    resolveSmallModelForEngine({ engine: "pi", pinned: haiku, added, boxDefault: qwen.id }),
    resolveSmallModelForEngine({ engine: "pi", pinned: null, added, boxDefault: qwen.id }),
    resolveSmallModelForEngine({ engine: "pi", pinned: haiku, added, boxDefault: null }),
    resolveSmallModelForEngine({ engine: "pi", pinned: deepseek.id, added, boxDefault: null }),
  ], [deepseek.id, qwen.id, qwen.id, null, deepseek.id]);
});

// Tiers map to the two slots, as on an OpenRouter-default claude box:
// efficient and balanced take the small model, strong and strongest the
// default. A slot with no model is `null`.
void test("procedure tiers on pi map to the small and default slots", async (t) => {
  const tiers = (boxDefault: string | null, small: string | null) =>
    (["efficient", "balanced", "strong", "strongest", "opus"] as const)
      .map((name) => resolveTierModel({ engine: "pi", name, boxDefault, small }));
  t.check(tiers(qwen.id, deepseek.id), [deepseek.id, deepseek.id, qwen.id, qwen.id, qwen.id]);
  t.check(tiers(null, deepseek.id), [deepseek.id, deepseek.id, null, null, null]);
  t.check(tiers(null, null), [null, null, null, null, null]);
});

// A `null` answer becomes this refusal in the loaders. It names where to fix it.
void test("a pi run with no model refuses with the OpenRouter setup error", async (t) => {
  t.check(piModelMissing(), {
    name: "OpenRouterSetupError",
    provider: "openrouter",
    message: "This box runs the pi engine, which runs only models added in Admin → OpenRouter models, "
      + "and no default model is chosen from them. Choose one as the default model in Admin → Agent engine and model.",
  });
});
