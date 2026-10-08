# Off-default model indicator

The session chip shows where a chat sits against the box default — a dial whose
needle reads left, centre or right (`docs/implemented-plans/model-engine-policy.md`).
The comparison is by *tier*, so it survives a model-id bump and says something
true across engines.

The mark is shown for `"same"` as well as for stronger and weaker, which is the
point. When it appeared only for a difference, its absence meant "at the
default", "status not loaded yet" and "model I do not recognize" all at once,
and read as an indicator that came and went — *"that up/down model indicator is
good too, but doesn't seem to display consistently"* (boxholder, 2026-09-14).
Now the absence means exactly one thing: the comparison could not be made.

```ts setup
import { modelDrift, engineDrift } from "../../../../../src/components/chat/everywhere/InteractiveChat/model-drift.js";
import { resolveProcedureModel } from "../../../../../../shared/agent-models.js";

type Tier = "efficient" | "balanced" | "strong" | "strongest";
const claude = (tier: Tier) => resolveProcedureModel({ engine: "claude", model: tier });
const codex = (tier: Tier) => resolveProcedureModel({ engine: "codex", model: tier });
```

Model ids come from the tier tables, so the examples survive a model-id bump.

Stronger and weaker than the default.

```ts
modelDrift({ model: claude("strongest"), boxDefault: claude("balanced") })
=> above

modelDrift({ model: claude("efficient"), boxDefault: claude("strong") })
=> below
```

`"same"` covers both ways a chat can be level: literally the box's model, or a
different model of the same tier — including one from another engine, since the
tier comparison is what makes cross-engine talk meaningful at all.

```ts
JSON.stringify([
  modelDrift({ model: claude("strong"), boxDefault: claude("strong") }),
  modelDrift({ model: codex("balanced"), boxDefault: claude("balanced") }),
  modelDrift({ model: codex("strongest"), boxDefault: claude("strongest") }),
])
=> ["same","same","same"]
```

Still `null` where the answer is genuinely unknown — nothing pinned, status not
loaded, or a model id no engine claims. These must not borrow `"same"`: a chat
running an unrecognized model is not known to be at the default, and saying so
would be the confidently wrong answer.

```ts
JSON.stringify([
  modelDrift({ model: claude("strong"), boxDefault: null }),
  modelDrift({ model: null, boxDefault: claude("strong") }),
  modelDrift({ model: "some-unreleased-model", boxDefault: claude("strong") }),
])
=> [null,null,null]
```

Sol is Codex's `strong` tier, so it reads as stronger than Terra and weaker than
a Claude flagship.

```ts
JSON.stringify([
  modelDrift({ model: codex("strong"), boxDefault: codex("balanced") }),
  modelDrift({ model: codex("strong"), boxDefault: claude("strongest") }),
])
=> ["above","below"]
```

## A different harness is its own mark, not a gauge position

Being on Codex when the box is Claude is not stronger or weaker — it is
somewhere else, and the tier comparison deliberately flattens it. The chip marks
that separately.

```ts
JSON.stringify([
  engineDrift({ engine: "codex", boxEngine: "claude" }),
  engineDrift({ engine: "claude", boxEngine: "claude" }),
  engineDrift({ engine: null, boxEngine: "claude" }),
  engineDrift({ engine: "codex", boxEngine: null }),
])
=> [true,false,false,false]
```
