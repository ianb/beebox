# Engine-aware chat models

The model picker and mutation boundary share one engine-indexed registry.

```ts setup
import { chatModelOptions, isChatModelAllowed, parseChatAgentEngine } from "../../src/shared/chat-models.js";
import { modelTier, resolveProcedureModel, isProcedureModelName, PROCEDURE_MODEL_NAMES, TIER_RANK } from "../../src/shared/agent-models.js";
import { liveModelState, resolveBoxModelForEngine, resolveEffectiveModel, resolveSmallModelForEngine, loadEffectiveSmallModel } from "../../src/core/model-policy.js";
import { loadBoxModel, loadEnabledEngines, clearBoxConfigCache } from "../../src/core/box/config.js";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chatModelFileForSession, loadCurrentModel, loadCurrentModelForEngine, saveCurrentModel } from "../../src/core/chat/session/state.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
```

```ts
JSON.stringify(chatModelOptions("claude").map((option) => option.label))
=> ["Default (Opus)","Haiku 4.5","Sonnet 5","Opus 5","Fable 5"]

JSON.stringify(chatModelOptions("codex"))
=> [{"label":"Default (Codex)","model":null},{"label":"Sol","model":"gpt-5.6-sol"},{"label":"Terra","model":"gpt-5.6-terra"},{"label":"Luna","model":"gpt-5.6-luna"}]

isChatModelAllowed("codex", "gpt-5.6-sol")
=> true

isChatModelAllowed("codex", "claude-opus-5")
=> false

JSON.stringify([parseChatAgentEngine("codex"), parseChatAgentEngine(undefined), parseChatAgentEngine("other")])
=> ["codex",null,null]
```

Web chats persist overrides independently by native session id.

```ts
const box = await makeTmpBox();
const firstFile = chatModelFileForSession("first");
const secondFile = chatModelFileForSession("second");
saveCurrentModel(box.root, { modelFile: firstFile, model: "gpt-5.6-sol" });

JSON.stringify([loadCurrentModel(box.root, firstFile), loadCurrentModel(box.root, secondFile)])
=> ["gpt-5.6-sol",null]

saveCurrentModel(box.root, { modelFile: secondFile, model: "claude-opus-5" });
JSON.stringify([
  loadCurrentModelForEngine(box.root, { modelFile: firstFile, engine: "codex" }),
  loadCurrentModelForEngine(box.root, { modelFile: secondFile, engine: "codex" }),
])
=> ["gpt-5.6-sol",null]

await box.cleanup();
```

## Tier names are not model ids

A scenario or procedure card names a *tier*; the box model policy holds an *id*.
The guard is what keeps a tier name from being written where an id belongs and
silently resolving to nothing.

```ts
JSON.stringify([isProcedureModelName("opus"), isProcedureModelName("balanced"), isProcedureModelName("claude-opus-5")])
=> [true,true,false]
```

## The box model policy

Every model id an engine offers belongs to a tier, and a tier round-trips back
to a model that engine can run. Codex flattens `strong`/`strongest` onto Sol, so
the reverse of Sol is the lower of the two — the round-trip is by model, not by
tier name.

```ts setup
import type { AgentEngine } from "../../src/shared/agent-models.js";

const ENGINES: AgentEngine[] = ["claude", "codex"];

/** Does every model this engine offers reverse to a tier selecting that same model? */
function tiersRoundTrip(engine: AgentEngine): boolean {
  return PROCEDURE_MODEL_NAMES.every((name) => {
    const model = resolveProcedureModel(engine, name);
    const tier = modelTier(model);
    return tier !== null && resolveProcedureModel(engine, tier) === model;
  });
}
```

```ts
JSON.stringify([modelTier("claude-fable-5"), modelTier("gpt-5.6-sol"), modelTier("not-a-model")])
=> ["strongest","strong",null]

JSON.stringify(ENGINES.map(tiersRoundTrip))
=> [true,true]

TIER_RANK.efficient < TIER_RANK.balanced && TIER_RANK.balanced < TIER_RANK.strong && TIER_RANK.strong < TIER_RANK.strongest
=> true
```

An engine that offers the pinned model runs it exactly; one that does not gets
the same tier instead of nothing. A retired id is carried forward before the
registry check, so it resolves rather than reading as "no policy".

```ts
JSON.stringify([
  resolveBoxModelForEngine("claude", "claude-sonnet-5"),
  resolveBoxModelForEngine("codex", "claude-sonnet-5"),
  resolveBoxModelForEngine("claude", "claude-opus-4-8"),
  resolveBoxModelForEngine("claude", "not-a-model"),
  resolveBoxModelForEngine("claude", null),
])
=> ["claude-sonnet-5","gpt-5.6-terra","claude-opus-5",null,null]
```

A chat's own pick wins; a chat that follows takes the box pin; a pick belonging
to the other engine falls through to the pin rather than to nothing.

```ts
const pinned = "claude-sonnet-5";
JSON.stringify([
  resolveEffectiveModel({ engine: "claude", pinned }, { kind: "explicit", model: "claude-fable-5" }),
  resolveEffectiveModel({ engine: "claude", pinned }, { kind: "follow" }),
  resolveEffectiveModel({ engine: "claude", pinned: null }, { kind: "follow" }),
  resolveEffectiveModel({ engine: "claude", pinned }, { kind: "explicit", model: "gpt-5.6-sol" }),
])
=> [{"model":"claude-fable-5","source":"explicit"},{"model":"claude-sonnet-5","source":"default"},{"model":null,"source":"none"},{"model":"claude-sonnet-5","source":"default"}]
```

What a *running* chat reports is the model its subprocess started with, whatever
the box default has become since. Reporting the pending model instead would tell
the boxholder their conversation had already moved — the state the system
intends, not the one it is in.

```ts
JSON.stringify([
  liveModelState({ explicit: "claude-fable-5", resolved: "claude-fable-5" }),
  liveModelState({ explicit: null, resolved: "claude-sonnet-5" }),
  liveModelState({ explicit: "claude-fable-5", resolved: "claude-sonnet-5" }),
  liveModelState({ explicit: null, resolved: null }),
])
=> [{"model":"claude-fable-5","source":"explicit"},{"model":"claude-sonnet-5","source":"default"},{"model":"claude-sonnet-5","source":"default"},{"model":null,"source":"none"}]
```

A hand-edited `agentModel` that no engine offers is rejected at the config
boundary, so it never reaches a spawn.

```ts
const policyBox = await makeTmpBox();
await mkdir(join(policyBox.root, "config"), { recursive: true });
const writeConfig = async (config: Record<string, unknown>) =>
  writeFile(join(policyBox.root, "config/box.json"), JSON.stringify(config));

await writeConfig({ agentModel: "claude-sonnet-5" });
await loadBoxModel(policyBox.root)
=> claude-sonnet-5

await writeConfig({ agentModel: "sonnet" });
await loadBoxModel(policyBox.root)
=> null

await writeConfig({});
await loadBoxModel(policyBox.root)
=> null

await policyBox.cleanup();
```

## The small-model slot

Chat review, retro observation and triage are cheap structured passes. They get
a model from the same policy as everything else, and — unlike the main policy —
always get *some* concrete id: an unset slot means the `efficient` tier for
whichever engine is running the pass.

That default is the fix for a real defect. These passes used to name `"haiku"`,
a provider-shaped nickname, which the Codex delegate forwards to the Codex SDK
verbatim. **Nothing here can produce a name an engine does not know.**

```ts
JSON.stringify([
  resolveSmallModelForEngine("claude", null),
  resolveSmallModelForEngine("codex", null),
  resolveSmallModelForEngine("codex", "claude-sonnet-5"),
  resolveSmallModelForEngine("claude", "claude-fable-5"),
])
=> ["claude-haiku-4-5-20251001","gpt-5.6-luna","gpt-5.6-terra","claude-fable-5"]
```

A codex box never receives a Claude model id, whatever the box config says —
including the nickname the old code hardcoded.

```ts
const smallBox = await makeTmpBox();
await mkdir(join(smallBox.root, "config"), { recursive: true });
const writeSmall = async (config: Record<string, unknown>) => {
  await writeFile(join(smallBox.root, "config/box.json"), JSON.stringify(config));
  clearBoxConfigCache(smallBox.root);
};

await writeSmall({ agentEngine: "codex" });
await loadEffectiveSmallModel(smallBox.root)
=> gpt-5.6-luna

await writeSmall({ agentEngine: "codex", smallModel: "haiku" });
await loadEffectiveSmallModel(smallBox.root)
=> gpt-5.6-luna

await writeSmall({ agentEngine: "codex", smallModel: "gpt-5.6-terra" });
await loadEffectiveSmallModel(smallBox.root)
=> gpt-5.6-terra

await smallBox.cleanup();
```

## Which engines a box may offer

A box with no Codex subscription should not be offered Codex chats. Absent
config means **only the default engine** — how every box behaved before the
field existed — rather than both.

```ts
const engineBox = await makeTmpBox();
await mkdir(join(engineBox.root, "config"), { recursive: true });
const writeEngines = async (config: Record<string, unknown>) => {
  await writeFile(join(engineBox.root, "config/box.json"), JSON.stringify(config));
  clearBoxConfigCache(engineBox.root);
};

await writeEngines({});
JSON.stringify(await loadEnabledEngines(engineBox.root))
=> ["claude"]

await writeEngines({ engines: { claude: true, codex: true } });
JSON.stringify(await loadEnabledEngines(engineBox.root))
=> ["claude","codex"]

await writeEngines({ agentEngine: "codex", engines: { codex: true } });
JSON.stringify(await loadEnabledEngines(engineBox.root))
=> ["codex"]
```

A config that disables the box's own default engine is a mistake, not a state to
honor: nothing could run. The default comes back enabled, loudly.

```ts continue
await writeEngines({ agentEngine: "codex", engines: { claude: true, codex: false } });
JSON.stringify(await loadEnabledEngines(engineBox.root))
=> ["claude","codex"]

await engineBox.cleanup();
```
