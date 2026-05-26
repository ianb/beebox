# Chat Features Registry

The control plane for chat-feature flags lives in `src/core/chat-features.ts`.
It owns the closed registry of recognized feature names, validates values
against each feature's allowed set, composes the `<chat-app>` snapshot
the server prepends to user messages, and parses agent-emitted
`<chat-app>` mutation tags out of assistant responses.

See `docs/narration-mode-design.md` for the bigger picture; this file
covers the registry primitives.

```ts setup
import {
  composeChatAppSnapshot,
  getDefaults,
  getFeature,
  isKnownFeature,
  isValidValue,
  listFeatures,
  parseChatAppDeltas,
  resolveFeatures,
} from "../src/core/chat-features.js";
```

## Registry lookups

The initial registry has two features. Both are toggle-shaped with
`on`/`off` values.

```
listFeatures().map((f) => f.name).join(",")
=> narration,prose

getFeature("narration")?.default
=> off

getFeature("prose")?.default
=> on

getFeature("nope")
=> null

isKnownFeature("narration")
=> true

isKnownFeature("nope")
=> false

isValidValue("narration", "on")
=> true

isValidValue("narration", "maybe")
=> false

isValidValue("nope", "on")
=> false
```

## Defaults

`getDefaults()` returns the registry's baseline.

```
JSON.stringify(getDefaults())
=> {"narration":"off","prose":"on"}
```

`resolveFeatures()` merges stored values over defaults, dropping
unknown keys and invalid values silently (with a console warning the
caller can ignore).

```
JSON.stringify(resolveFeatures())
=> {"narration":"off","prose":"on"}

JSON.stringify(resolveFeatures({ narration: "on" }))
=> {"narration":"on","prose":"on"}

JSON.stringify(resolveFeatures({ narration: "on", bogus: "yes", prose: "wrong" }))
=> {"narration":"on","prose":"on"}
```

Null and undefined both mean "no stored values" — the result is pure
defaults.

```
JSON.stringify(resolveFeatures(null))
=> {"narration":"off","prose":"on"}
```

## Snapshot composition

The server prepends the `<chat-app>` snapshot to each user message.
Attributes are emitted in registry order, with `time` last.

```
composeChatAppSnapshot({
  features: { narration: "on", prose: "off" },
  time: "2026-05-13T10:00:00-05:00",
})
=> <chat-app narration="on" prose="off" time="2026-05-13T10:00:00-05:00"/>
```

Missing keys fall back to defaults — the snapshot always carries every
registered feature, never a partial map.

```
composeChatAppSnapshot({
  features: {},
  time: "2026-05-13T10:00:00-05:00",
})
=> <chat-app narration="off" prose="on" time="2026-05-13T10:00:00-05:00"/>
```

## Delta parsing

The agent emits `<chat-app>` tags as state mutations. The parser
returns the deltas and the content with the tags removed.

```
const result = parseChatAppDeltas(
  "Sure, switching to narration. <chat-app narration=\"on\"/> Done."
);
result.deltas
=> [
  {
    "feature": "narration",
    "value": "on"
  }
]

result.cleaned
=> Sure, switching to narration.  Done.
```

The paired form (with empty body) parses the same way.

```
const r = parseChatAppDeltas("<chat-app prose=\"off\"></chat-app>");
r.deltas
=> [
  {
    "feature": "prose",
    "value": "off"
  }
]
```

Unknown features and invalid values are dropped. `time` is always
ignored on input — it's a read-only attribute the agent never sets.

```
const r = parseChatAppDeltas(
  "<chat-app narration=\"on\" bogus=\"yes\" prose=\"maybe\" time=\"now\"/>"
);
r.deltas
=> [
  {
    "feature": "narration",
    "value": "on"
  }
]
```

Multiple tags in one response yield multiple deltas, in document
order.

```
parseChatAppDeltas("<chat-app narration=\"on\"/> body <chat-app prose=\"off\"/>").deltas
=> [
  {
    "feature": "narration",
    "value": "on"
  },
  {
    "feature": "prose",
    "value": "off"
  }
]
```

No tags → no deltas, content unchanged.

```
parseChatAppDeltas("Hello world").deltas.length
=> 0

parseChatAppDeltas("Hello world").cleaned
=> Hello world
```
