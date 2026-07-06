# Chat Features Registry

The control plane for chat-feature flags lives in `src/core/chat/features.ts`.
It owns the closed registry of recognized feature names, validates values
against each feature's allowed set, composes the `<chat-app>` snapshot
the server prepends to user messages, and parses agent-emitted
`<chat-app>` mutation tags out of assistant responses.

See `docs/plans/narration-mode.md` for the bigger picture; this file
covers the registry primitives.

```ts setup
import {
  composeChatAppSnapshot,
  getDefaults,
  getFeature,
  isKnownFeature,
  isValidValue,
  listFeatures,
  mergeSeedFeatures,
  parseChatAppDeltas,
  resolveFeatures,
} from "../../src/core/chat/features.js";

// Several assertions deliberately pass bogus inputs to exercise the warn-and-
// skip path. The console.warn fires are documented behavior; silence them
// here so they don't pollute test output.
console.warn = () => {};
```

## Registry lookups

The initial registry has two features. Both are toggle-shaped with
`on`/`off` values.

```ts
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

```ts
JSON.stringify(getDefaults())
=> {"narration":"off","prose":"on"}
```

`resolveFeatures()` merges stored values over defaults, dropping
unknown keys and invalid values silently (with a console warning the
caller can ignore).

```ts
JSON.stringify(resolveFeatures())
=> {"narration":"off","prose":"on"}

JSON.stringify(resolveFeatures({ narration: "on" }))
=> {"narration":"on","prose":"on"}

JSON.stringify(resolveFeatures({ narration: "on", bogus: "yes", prose: "wrong" }))
=> {"narration":"on","prose":"on"}
```

Null and undefined both mean "no stored values" — the result is pure
defaults.

```ts
JSON.stringify(resolveFeatures(null))
=> {"narration":"off","prose":"on"}
```

## Seeding a new session

`mergeSeedFeatures` builds the initial feature map for a brand-new chat by
layering the client's pre-session choices (e.g. narration toggled on before
the first message) over any landmark defaults. The explicit client choice
wins on conflict.

```ts
JSON.stringify(mergeSeedFeatures({
  landmark: { narration: "off", prose: "off" },
  request: { narration: "on" },
}))
=> {"narration":"on","prose":"off"}
```

Either source may be absent (no landmark, or no pre-session toggles). Missing
sources contribute nothing; with neither, the map is empty and the session
falls back to registry defaults downstream.

```ts
JSON.stringify(mergeSeedFeatures({ request: { narration: "on" } }))
=> {"narration":"on"}

JSON.stringify(mergeSeedFeatures({ landmark: { prose: "off" } }))
=> {"prose":"off"}

JSON.stringify(mergeSeedFeatures({}))
=> {}
```

Unknown features and invalid values from either source are dropped, so a
hand-edited landmark or a malformed request can't seed an illegal state.

```ts
JSON.stringify(mergeSeedFeatures({
  landmark: { bogus: "yes" },
  request: { narration: "maybe", prose: "off" },
}))
=> {"prose":"off"}
```

## Snapshot composition

The server prepends the `<chat-app>` snapshot to each user message.
Attributes are emitted in registry order.

```ts
composeChatAppSnapshot({
  features: { narration: "on", prose: "off" },
})
=> <chat-app narration="on" prose="off"/>
```

Missing keys fall back to defaults — the snapshot always carries every
registered feature, never a partial map.

```ts
composeChatAppSnapshot({
  features: {},
})
=> <chat-app narration="off" prose="on"/>
```

The optional context attributes (computed by `session-context.ts`)
serialize in a fixed order, and are simply omitted when absent —
`local-time` and `channel` ride on every real send, while
`last-activity` and `health` appear only on the first message of a
brand-new session.

```ts
composeChatAppSnapshot({
  features: {},
  localTime: "Wednesday 2026-05-13 10:00 (morning)",
  channel: "web-mobile",
  lastActivity: "3 days ago",
})
=> <chat-app narration="off" prose="on" local-time="Wednesday 2026-05-13 10:00 (morning)" channel="web-mobile" last-activity="3 days ago"/>
```

The companion-pane `open-card` attribute (box-relative path) rides on every send
when a card is open. It's omitted when `undefined` — the caller passes
`undefined`, never `""`, since the pipeline renders empty strings rather than
dropping them.

```ts
composeChatAppSnapshot({
  features: {},
  openCard: "store/notes/Trip.memo.card",
})
=> <chat-app narration="off" prose="on" open-card="store/notes/Trip.memo.card"/>
```

Companion-pane activity rides as `<card-activity>` child elements (rendered by
`renderActivityChildren`), turning `<chat-app>` into a paired tag. Children
rather than attributes so a detail can be long or multi-line.

```ts
composeChatAppSnapshot({
  features: {},
  openCard: "store/notes/Trip.memo.card",
  activityChildren: '<card-activity kind="scrolled"/>\n<card-activity kind="explored">boat-water+road -> boats</card-activity>',
})
=> <chat-app narration="off" prose="on" open-card="store/notes/Trip.memo.card">
<card-activity kind="scrolled"/>
<card-activity kind="explored">boat-water+road -> boats</card-activity>
</chat-app>
```

## Delta parsing

The agent emits `<chat-app>` tags as state mutations. The parser
returns the deltas and the content with the tags removed.

```ts
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

```ts
const r = parseChatAppDeltas("<chat-app prose=\"off\"></chat-app>");
r.deltas
=> [
  {
    "feature": "prose",
    "value": "off"
  }
]
```

Unknown features and invalid values are dropped. The system-written
context attributes (`time`, `local-time`, `channel`, `last-activity`,
`calendar`, `open-card`) are always ignored on input — they're read-only; the
agent echoing one back is not a mutation.

```ts
const r = parseChatAppDeltas(
  "<chat-app narration=\"on\" bogus=\"yes\" prose=\"maybe\" time=\"now\" local-time=\"x\" channel=\"y\" last-activity=\"z\" calendar=\"w\" open-card=\"a.card\"/>"
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

```ts
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

```ts
parseChatAppDeltas("Hello world").deltas.length
=> 0

parseChatAppDeltas("Hello world").cleaned
=> Hello world
```
