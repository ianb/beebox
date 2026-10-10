# Landmark feature seeds

Landmarks can declare default chat-feature values via a `navigation.chat-app`
mapping. When a chat is started from a landmark, those defaults seed the
session's features; the user can still toggle afterward.

See `src/core/landmark/features.ts` for the readers and
`docs/plans/narration-mode.md` for the design.

```ts setup
import {
  readLandmarkFeatures,
  readLandmarkFeaturesForDir,
  seedFeaturesForNewChat,
} from "../../../src/core/landmark/features.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
```

## readLandmarkFeatures — read from a navigation role

```ts
const navigation = { label: "Daily dump", "chat-app": { narration: "on", prose: "off" } };
JSON.stringify(readLandmarkFeatures(navigation))
=> {"narration":"on","prose":"off"}
```

A navigation without a `chat-app` mapping returns an empty map.

```ts
JSON.stringify(readLandmarkFeatures({ label: "Plain" }))
=> {}
```

Unknown features and invalid values are dropped silently (defense in
depth — the schema rejects them at parse time, but hand-edited cards
might bypass validation).

```ts
const navigation = { label: "x", "chat-app": { narration: "on", bogus: "yes", prose: "maybe" } };
JSON.stringify(readLandmarkFeatures(navigation))
=> {"narration":"on"}
```

## readLandmarkFeaturesForDir — find the landmark in a directory

```ts
const box = await makeTmpBox();
await box.write(
  "_content/store/dump/Daily.landmark.card",
  "---\nsymbol:\n  glyph: 🎙️\nnavigation:\n  label: Daily dump\n  chat-app:\n    narration: on\n---\n",
);
JSON.stringify(await readLandmarkFeaturesForDir(box.root, "_content/store/dump"))
=> {"narration":"on"}
```

```ts cleanup
await box.cleanup();
```

## Complete new-chat inheritance

The shared resolver applies root-landmark values, then explicit chat values.
Root landmarks use the empty context directory rather than being silently
skipped by one creation path. A retired `hq-dictation` key on an older card
(every dictated message gets the HQ pass now, docs/plans/hq-always.md) and a
stale `hqDictation` in `box.json` are ignored.

```ts
const box = await makeTmpBox();
await box.write("_config/box.json", JSON.stringify({ hqDictation: "on" }));
await box.write(
  "_content/Home.landmark.card",
  "---\nnavigation:\n  label: Home\n  chat-app:\n    narration: on\n    hq-dictation: off\n---\n",
);
JSON.stringify(await seedFeaturesForNewChat({ boxRoot: box.root, contextDir: null }))
=> {}

JSON.stringify(await seedFeaturesForNewChat({ boxRoot: box.root, contextDir: "" }))
=> {"narration":"on"}

JSON.stringify(await seedFeaturesForNewChat({
  boxRoot: box.root,
  contextDir: "",
  request: { narration: "off", "hq-dictation": "on" },
}))
=> {"narration":"off"}
```

```ts cleanup
await box.cleanup();
```

A directory with no landmark card returns null.

```ts
const box = await makeTmpBox();
await box.write("_content/store/empty/Notes.md", "no landmark here\n");
await readLandmarkFeaturesForDir(box.root, "_content/store/empty")
=> null
```

```ts cleanup
await box.cleanup();
```

A landmark without `chat-app` returns null too — empty seeds and no
landmark look the same to callers.

```ts
const box = await makeTmpBox();
await box.write(
  "_content/store/plain/Plain.landmark.card",
  "---\nsymbol:\n  glyph: 📁\nnavigation:\n  label: Plain\n---\n",
);
await readLandmarkFeaturesForDir(box.root, "_content/store/plain")
=> null
```

```ts cleanup
await box.cleanup();
```

A `contextDir` that would resolve outside the box fails closed: same `null`
as a missing directory, not a read of whatever the path escapes to. This is
the box-containment floor for a value that arrives from the tRPC layer
already string-shape-checked (`boxRelativePathSchema` in
`core/landmark/nearest.ts`) — this check is the defense-in-depth layer for
any other caller.

```ts
const box = await makeTmpBox();
await box.write(
  "../outside-marker.landmark.card",
  "---\nnavigation:\n  label: Outside\n  chat-app:\n    narration: on\n---\n",
);
await readLandmarkFeaturesForDir(box.root, "../")
=> null
```

```ts cleanup
await box.cleanup();
```
