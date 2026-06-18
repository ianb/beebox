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
  mergeSeedFeatures,
  parseChatAppDeltas,
  resolveFeatures,
} from "../src/core/chat-features.js";

// Several assertions deliberately pass bogus inputs to exercise the warn-and-
// skip path. The console.warn fires are documented behavior; silence them
// here so they don't pollute test output.
console.warn = () => {};
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

## Seeding a new session

`mergeSeedFeatures` builds the initial feature map for a brand-new chat by
layering the client's pre-session choices (e.g. narration toggled on before
the first message) over any landmark defaults. The explicit client choice
wins on conflict.

```
JSON.stringify(mergeSeedFeatures({
  landmark: { narration: "off", prose: "off" },
  request: { narration: "on" },
}))
=> {"narration":"on","prose":"off"}
```

Either source may be absent (no landmark, or no pre-session toggles). Missing
sources contribute nothing; with neither, the map is empty and the session
falls back to registry defaults downstream.

```
JSON.stringify(mergeSeedFeatures({ request: { narration: "on" } }))
=> {"narration":"on"}

JSON.stringify(mergeSeedFeatures({ landmark: { prose: "off" } }))
=> {"prose":"off"}

JSON.stringify(mergeSeedFeatures({}))
=> {}
```

Unknown features and invalid values from either source are dropped, so a
hand-edited landmark or a malformed request can't seed an illegal state.

```
JSON.stringify(mergeSeedFeatures({
  landmark: { bogus: "yes" },
  request: { narration: "maybe", prose: "off" },
}))
=> {"prose":"off"}
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

The optional context attributes (computed by `session-context.ts`)
serialize after `time`, in a fixed order, and are simply omitted when
absent — `local-time` and `channel` ride on every real send, while
`last-activity` and `calendar` appear only on the first message of a
brand-new session.

```
composeChatAppSnapshot({
  features: {},
  time: "2026-05-13T15:00:00Z",
  localTime: "Wednesday 2026-05-13 10:00 (morning)",
  channel: "web-mobile",
  lastActivity: "3 days ago",
  calendar: "16:00-17:00 Dentist",
})
=> <chat-app narration="off" prose="on" time="2026-05-13T15:00:00Z" local-time="Wednesday 2026-05-13 10:00 (morning)" channel="web-mobile" last-activity="3 days ago" calendar="16:00-17:00 Dentist"/>
```

The companion-pane attributes `open-card` (box-relative path) and
`card-activity` (canonical comma-joined kinds) ride on every send when a card
is open, serializing after the session-start extras.

```
composeChatAppSnapshot({
  features: {},
  time: "2026-05-13T15:00:00Z",
  localTime: "Wednesday 2026-05-13 10:00 (morning)",
  openCard: "store/notes/Trip.memo.card",
  cardActivity: "scrolled,modified",
})
=> <chat-app narration="off" prose="on" time="2026-05-13T15:00:00Z" local-time="Wednesday 2026-05-13 10:00 (morning)" open-card="store/notes/Trip.memo.card" card-activity="scrolled,modified"/>
```

The optional `card-state` attribute carries the view's free-text detail for that
activity, serialized after `card-activity`.

```
composeChatAppSnapshot({
  features: {},
  time: "2026-05-13T15:00:00Z",
  openCard: "store/notes/Trip.memo.card",
  cardActivity: "explored",
  cardState: "explored: boat-water+road → boats",
})
=> <chat-app narration="off" prose="on" time="2026-05-13T15:00:00Z" open-card="store/notes/Trip.memo.card" card-activity="explored" card-state="explored: boat-water+road → boats"/>
```

Both are omitted when `undefined` — the caller passes `undefined`, never
`""`, since the pipeline renders empty strings rather than dropping them.

```
composeChatAppSnapshot({
  features: {},
  time: "2026-05-13T15:00:00Z",
  openCard: "store/notes/Trip.memo.card",
})
=> <chat-app narration="off" prose="on" time="2026-05-13T15:00:00Z" open-card="store/notes/Trip.memo.card"/>
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

Unknown features and invalid values are dropped. The system-written
context attributes (`time`, `local-time`, `channel`, `last-activity`,
`calendar`, `open-card`, `card-activity`, `card-state`) are always ignored on
input — they're read-only; the agent echoing one back is not a mutation.

```
const r = parseChatAppDeltas(
  "<chat-app narration=\"on\" bogus=\"yes\" prose=\"maybe\" time=\"now\" local-time=\"x\" channel=\"y\" last-activity=\"z\" calendar=\"w\" open-card=\"a.card\" card-activity=\"modified\" card-state=\"explored: x\"/>"
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
