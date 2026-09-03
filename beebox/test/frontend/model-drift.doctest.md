# Off-default model indicator

The session chip marks a chat that is running something other than the box
default — one mark for stronger, another for weaker
(`docs/implemented-plans/model-engine-policy.md`). The comparison is by *tier*, so it
survives a model-id bump and says something true across engines.

The mark exists to be noticed, which means it must not appear when there is
nothing to notice: a chat on the default, a box with no default, or a sideways
move between two models of the same tier.

```ts setup
import { modelDrift } from "../../src/frontend/src/components/chat/model-drift.js";
```

Stronger and weaker than the default.

```ts
modelDrift({ model: "claude-fable-5-1", boxDefault: "claude-sonnet-5" })
=> above

modelDrift({ model: "claude-haiku-4-5-20251001", boxDefault: "claude-opus-5" })
=> below
```

No mark when there is nothing to say: the chat is on the default, the box has
no default, the chat's model is unknown, or the two are the same tier from
different engines (a box that switched harness mid-conversation).

```ts
JSON.stringify([
  modelDrift({ model: "claude-opus-5", boxDefault: "claude-opus-5" }),
  modelDrift({ model: "claude-opus-5", boxDefault: null }),
  modelDrift({ model: null, boxDefault: "claude-opus-5" }),
  modelDrift({ model: "some-unreleased-model", boxDefault: "claude-opus-5" }),
  modelDrift({ model: "gpt-5.6-terra", boxDefault: "claude-sonnet-5" }),
])
=> [null,null,null,null,null]
```

Codex flattens `strong` and `strongest` onto one model, so its flagship reads
as stronger than Terra and never as weaker than a Claude flagship.

```ts
JSON.stringify([
  modelDrift({ model: "gpt-5.6-sol", boxDefault: "gpt-5.6-terra" }),
  modelDrift({ model: "gpt-5.6-sol", boxDefault: "claude-fable-5-1" }),
])
=> ["above","below"]
```
