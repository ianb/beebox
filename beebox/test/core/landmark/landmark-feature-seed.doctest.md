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
import { setLandmarkHqPreference } from "../../../src/core/landmark/hq-preference.js";
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

## Updating the landmark preference

The writer preserves the card body, comments, and unrelated navigation fields.
`inherit` removes only the HQ key.

```ts
const box = await makeTmpBox({ git: true });
await box.write(
  "store/place/Place.landmark.card",
  "---\nnavigation:\n  label: Place # keep this comment\n  links:\n    - ref: ../Elsewhere.md\n---\nBody stays here.\n",
);
await setLandmarkHqPreference({ boxRoot: box.root, contextDir: "store/place", value: "on" });
const enabled = await box.read("store/place/Place.landmark.card");
JSON.stringify([enabled.includes("# keep this comment"), enabled.includes("hq-dictation: on"), enabled.endsWith("Body stays here.\n")])
=> [true,true,true]

await setLandmarkHqPreference({ boxRoot: box.root, contextDir: "store/place", value: "inherit" });
(await box.read("store/place/Place.landmark.card")).includes("hq-dictation")
=> false
```

```ts cleanup
await box.cleanup();
```

## Complete new-chat inheritance

The shared resolver applies box, root-landmark, and explicit chat values in
that order. Root landmarks use the empty context directory rather than being
silently skipped by one creation path.

```ts
const box = await makeTmpBox();
await box.write("config/box.json", JSON.stringify({ hqDictation: "on" }));
await box.write(
  "Home.landmark.card",
  "---\nnavigation:\n  label: Home\n  chat-app:\n    hq-dictation: off\n---\n",
);
JSON.stringify(await seedFeaturesForNewChat({ boxRoot: box.root, contextDir: null }))
=> {"hq-dictation":"on"}

JSON.stringify(await seedFeaturesForNewChat({ boxRoot: box.root, contextDir: "" }))
=> {"hq-dictation":"off"}

JSON.stringify(await seedFeaturesForNewChat({
  boxRoot: box.root,
  contextDir: "",
  request: { "hq-dictation": "on" },
}))
=> {"hq-dictation":"on"}
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
