# Engine-aware chat models

The model picker and mutation boundary share one engine-indexed registry.

```ts setup
import { isChatModelAllowed, parseChatAgentEngine } from "../../src/shared/chat-models.js";
import { modelTier, resolveProcedureModel, isProcedureModelName, PROCEDURE_MODEL_NAMES } from "../../src/shared/agent-models.js";
import { boxDefaultModel, liveModelState, resolveBoxModelForEngine, resolveEffectiveModel, resolveSmallModelForEngine, loadEffectiveSmallModel } from "../../src/core/model-policy.js";
import { loadBoxModel, loadEnabledEngines, clearBoxConfigCache } from "../../src/core/box/config.js";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chatModelFileForSession, loadCurrentModel, loadCurrentModelForEngine, saveCurrentModel } from "../../src/core/chat/session/state.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

// Ids rotate; tiers do not. Examples name a model by engine and tier and read
// results back through the same labels, so a version bump changes no expectation.
const tierId = (engine: "claude" | "codex", model: "efficient" | "balanced" | "strong" | "strongest") =>
  resolveProcedureModel({ engine, model });
const LABELS: Record<string, string> = {};
for (const engine of ["claude", "codex"] as const) {
  for (const tier of ["efficient", "balanced", "strong", "strongest"] as const) {
    LABELS[tierId(engine, tier)] = `${engine} ${tier}`;
  }
}
const label = (model: string | null) => (model === null ? null : (LABELS[model] ?? model));
const labelled = (r: { model: string | null; source: string }) => ({ model: label(r.model), source: r.source });
```

```ts
isChatModelAllowed("codex", { model: tierId("codex", "strong"), added: [] })
=> true

isChatModelAllowed("codex", { model: tierId("claude", "strong"), added: [] })
=> false

JSON.stringify([parseChatAgentEngine("codex"), parseChatAgentEngine(undefined), parseChatAgentEngine("other")])
=> ["codex",null,null]
```

Web chats persist overrides independently by native session id. The saved
picks below are retired ids (`gpt-5.6-sol`, `claude-opus-5`), which stored
selections may still carry and which load as their current replacement.

```ts
const box = await makeTmpBox();
const firstFile = chatModelFileForSession("first");
const secondFile = chatModelFileForSession("second");
saveCurrentModel(box.root, { modelFile: firstFile, model: "gpt-5.6-sol" });

JSON.stringify([label(loadCurrentModel(box.root, firstFile)), label(loadCurrentModel(box.root, secondFile))])
=> ["codex strong",null]

saveCurrentModel(box.root, { modelFile: secondFile, model: "claude-opus-5" });
JSON.stringify([
  label(loadCurrentModelForEngine(box.root, { modelFile: firstFile, engine: "codex" })),
  label(loadCurrentModelForEngine(box.root, { modelFile: secondFile, engine: "codex" })),
  label(loadCurrentModelForEngine(box.root, { modelFile: secondFile, engine: "claude" })),
])
=> ["codex strong",null,"claude strong"]

liveModelState({
  explicit: loadCurrentModel(box.root, firstFile),
  resolved: tierId("codex", "strong"),
}).source
=> explicit

await box.cleanup();
```

## Tier names are not model ids

A scenario or procedure card names a *tier*; the box model policy holds an *id*.
The guard is what keeps a tier name from being written where an id belongs and
silently resolving to nothing.

```ts
JSON.stringify([isProcedureModelName("opus"), isProcedureModelName("balanced"), isProcedureModelName(tierId("claude", "strong"))])
=> [true,true,false]
```

## The box model policy

Every model id an engine offers belongs to a tier, and a tier round-trips back
to a model that engine can run. The round-trip is by model, not by tier name.

```ts setup
import type { AgentEngine } from "../../src/shared/agent-models.js";

const ENGINES: AgentEngine[] = ["claude", "codex"];

/** Does every model this engine offers reverse to a tier selecting that same model? */
function tiersRoundTrip(engine: AgentEngine): boolean {
  return PROCEDURE_MODEL_NAMES.every((name) => {
    const model = resolveProcedureModel({ engine, model: name });
    const tier = modelTier(model);
    return tier !== null && resolveProcedureModel({ engine, model: tier }) === model;
  });
}
```

```ts
JSON.stringify(ENGINES.map((engine) => (["efficient", "balanced", "strong", "strongest"] as const).map((tier) => modelTier(tierId(engine, tier)))))
=> [["efficient","balanced","strong","strongest"],["efficient","balanced","strong","strongest"]]

modelTier("not-a-model")
=> null

JSON.stringify(ENGINES.map(tiersRoundTrip))
=> [true,true]
```

An engine that offers the pinned model runs it exactly; one that does not gets
the same tier instead of nothing. A retired id is carried forward before the
registry check, so it resolves rather than reading as "no policy".

`null` here means the box pinned nothing — this translates a pin, it does not
invent one.

```ts
const balanced = tierId("claude", "balanced");
JSON.stringify([
  resolveBoxModelForEngine("claude", { pinned: balanced, added: [] }),
  resolveBoxModelForEngine("codex", { pinned: balanced, added: [] }),
  resolveBoxModelForEngine("claude", { pinned: "claude-opus-4-8", added: [] }),
  resolveBoxModelForEngine("claude", { pinned: "not-a-model", added: [] }),
  resolveBoxModelForEngine("claude", { pinned: null, added: [] }),
].map(label))
=> ["claude balanced","codex balanced","claude strong",null,null]
```

What an unpinned box actually RUNS is one level up. `boxDefaultModel` answers
with the `strong` tier — Opus on Claude, Sol on Codex — because deferring to
whatever the harness picks left the box with no default it could name: the chat
UI could not say what a follower would run, and the model dial had nothing to
compare against, so it stayed blank on every unpinned box. A pin that names no
known model still reads as no policy; a box saying something unreadable is not a
box saying nothing.

```ts
JSON.stringify([
  boxDefaultModel("claude", { pinned: null, added: [] }),
  boxDefaultModel("codex", { pinned: null, added: [] }),
  boxDefaultModel("claude", { pinned: tierId("claude", "balanced"), added: [] }),
  boxDefaultModel("claude", { pinned: "not-a-model", added: [] }),
].map(label))
=> ["claude strong","codex strong","claude balanced",null]
```

The small-pass slot is deliberately NOT that default — chat review, retro and
triage stay on the `efficient` tier when their slot is unset, which is why the
policy default lives above the translation rather than inside it.

A chat's own pick wins; a chat that follows takes the box pin; a pick belonging
to the other engine falls through to the pin rather than to nothing.

```ts
const pinned = tierId("claude", "balanced");
JSON.stringify([
  resolveEffectiveModel({ engine: "claude", pinned, added: [] }, { kind: "explicit", model: tierId("claude", "strongest") }),
  resolveEffectiveModel({ engine: "claude", pinned, added: [] }, { kind: "follow" }),
  resolveEffectiveModel({ engine: "claude", pinned: null, added: [] }, { kind: "follow" }),
  resolveEffectiveModel({ engine: "claude", pinned, added: [] }, { kind: "explicit", model: tierId("codex", "strong") }),
].map(labelled))
=> [{"model":"claude strongest","source":"explicit"},{"model":"claude balanced","source":"default"},{"model":"claude strong","source":"default"},{"model":"claude balanced","source":"default"}]
```

What a *running* chat reports is the model its subprocess started with, whatever
the box default has become since. Reporting the pending model instead would tell
the boxholder their conversation had already moved — the state the system
intends, not the one it is in.

```ts
const fable = tierId("claude", "strongest");
const sonnet = tierId("claude", "balanced");
JSON.stringify([
  liveModelState({ explicit: fable, resolved: fable }),
  liveModelState({ explicit: null, resolved: sonnet }),
  liveModelState({ explicit: fable, resolved: sonnet }),
  liveModelState({ explicit: null, resolved: null }),
].map(labelled))
=> [{"model":"claude strongest","source":"explicit"},{"model":"claude balanced","source":"default"},{"model":"claude balanced","source":"default"},{"model":null,"source":"none"}]
```

A hand-edited `agentModel` that no engine offers is rejected at the config
boundary, so it never reaches a spawn.

```ts
const policyBox = await makeTmpBox();
await mkdir(join(policyBox.root, "_config"), { recursive: true });
const writeConfig = async (config: Record<string, unknown>) =>
  writeFile(join(policyBox.root, "_config/box.json"), JSON.stringify(config));

await writeConfig({ agentModel: tierId("claude", "balanced") });
label(await loadBoxModel(policyBox.root))
=> claude balanced

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
  resolveSmallModelForEngine({ engine: "claude", pinned: null, boxDefault: null }),
  resolveSmallModelForEngine({ engine: "codex", pinned: null, boxDefault: null }),
  resolveSmallModelForEngine({ engine: "codex", pinned: tierId("claude", "balanced"), boxDefault: null }),
  resolveSmallModelForEngine({ engine: "claude", pinned: tierId("claude", "strongest"), boxDefault: null }),
].map(label))
=> ["claude efficient","codex efficient","codex balanced","claude strongest"]
```

A codex box never receives a Claude model id, whatever the box config says —
including the nickname the old code hardcoded.

```ts
const smallBox = await makeTmpBox();
await mkdir(join(smallBox.root, "_config"), { recursive: true });
const writeSmall = async (config: Record<string, unknown>) => {
  await writeFile(join(smallBox.root, "_config/box.json"), JSON.stringify(config));
  clearBoxConfigCache(smallBox.root);
};

await writeSmall({ agentEngine: "codex" });
label(await loadEffectiveSmallModel(smallBox.root))
=> codex efficient

await writeSmall({ agentEngine: "codex", smallModel: "haiku" });
label(await loadEffectiveSmallModel(smallBox.root))
=> codex efficient

await writeSmall({ agentEngine: "codex", smallModel: tierId("codex", "balanced") });
label(await loadEffectiveSmallModel(smallBox.root))
=> codex balanced

await smallBox.cleanup();
```

## Which engines a box may offer

A box with no Codex subscription should not be offered Codex chats. Absent
config means **only the default engine** — how every box behaved before the
field existed — rather than both.

```ts
const engineBox = await makeTmpBox();
await mkdir(join(engineBox.root, "_config"), { recursive: true });
const writeEngines = async (config: Record<string, unknown>) => {
  await writeFile(join(engineBox.root, "_config/box.json"), JSON.stringify(config));
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
