# Landmark feature seeds

Landmarks can declare default chat-feature values via a `navigation.chat-app`
mapping. When a chat is started from a landmark, those defaults seed the
session's features; the user can still toggle afterward.

See `src/core/landmark/features.ts` for the readers and
`docs/narration-mode-design.md` for the design.

```ts setup
import {
  readLandmarkFeatures,
  readLandmarkFeaturesForDir,
} from "../../../src/core/landmark/features.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";
```

## readLandmarkFeatures — read from a navigation role

```ts
const navigation = { label: "Daily dump", symbol: "🎙️", "chat-app": { narration: "on", prose: "off" } };
JSON.stringify(readLandmarkFeatures(navigation))
=> {"narration":"on","prose":"off"}
```

A navigation without a `chat-app` mapping returns an empty map.

```ts
JSON.stringify(readLandmarkFeatures({ label: "Plain", symbol: "📁" }))
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
  "store/dump/Daily.landmark.card",
  "---\nnavigation:\n  label: Daily dump\n  symbol: 🎙️\n  chat-app:\n    narration: on\n---\n",
);
JSON.stringify(await readLandmarkFeaturesForDir(box.root, "store/dump"))
=> {"narration":"on"}
```

```ts cleanup
await box.cleanup();
```

A directory with no landmark card returns null.

```ts
const box = await makeTmpBox();
await box.write("store/empty/Notes.md", "no landmark here\n");
await readLandmarkFeaturesForDir(box.root, "store/empty")
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
  "store/plain/Plain.landmark.card",
  "---\nnavigation:\n  label: Plain\n  symbol: 📁\n---\n",
);
await readLandmarkFeaturesForDir(box.root, "store/plain")
=> null
```

```ts cleanup
await box.cleanup();
```
