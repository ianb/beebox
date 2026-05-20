# Landmark feature seeds

Landmarks can declare default chat-feature values via a `<chat-app>`
child element. When a chat is started from a landmark, those defaults
seed the session's features; the user can still toggle afterward.

See `src/core/landmark/features.ts` for the readers and
`docs/narration-mode-design.md` for the design.

```ts setup
import { join } from "node:path";
import { parseXml } from "cardworks";
import {
  readLandmarkFeatures,
  readLandmarkFeaturesForDir,
} from "../src/core/landmark/features.js";
import { makeTmpBox } from "./helpers/doctest-helpers.js";
```

## readLandmarkFeatures — parse from a landmark element

```
const el = await parseXml(
  '<landmark><navigation><label>Daily dump</label><symbol>🎙️</symbol><chat-app narration="on" prose="off"/></navigation></landmark>',
  "in-memory.landmark.card",
);
JSON.stringify(readLandmarkFeatures(el))
=> {"narration":"on","prose":"off"}
```

A landmark without a `<chat-app>` child returns an empty map.

```
const el = await parseXml(
  '<landmark><navigation><label>Plain</label><symbol>📁</symbol></navigation></landmark>',
  "in-memory.landmark.card",
);
JSON.stringify(readLandmarkFeatures(el))
=> {}
```

Unknown features and invalid values are dropped silently (defense in
depth — the schema rejects them at parse time, but hand-edited cards
might bypass validation).

```
const el = await parseXml(
  '<landmark><navigation><label>x</label><chat-app narration="on" bogus="yes" prose="maybe"/></navigation></landmark>',
  "in-memory.landmark.card",
);
JSON.stringify(readLandmarkFeatures(el))
=> {"narration":"on"}
```

## readLandmarkFeaturesForDir — find the landmark in a directory

```
const box = await makeTmpBox();
await box.write(
  "store/dump/Daily.landmark.card",
  '<landmark><navigation><label>Daily dump</label><symbol>🎙️</symbol><chat-app narration="on"/></navigation></landmark>\n',
);
JSON.stringify(await readLandmarkFeaturesForDir(box.root, "store/dump"))
=> {"narration":"on"}
```

```cleanup
await box.cleanup();
```

A directory with no landmark card returns null.

```
const box = await makeTmpBox();
await box.write("store/empty/Notes.md", "no landmark here\n");
await readLandmarkFeaturesForDir(box.root, "store/empty")
=> null
```

```cleanup
await box.cleanup();
```

A landmark without `<chat-app>` returns null too — empty seeds and no
landmark look the same to callers.

```
const box = await makeTmpBox();
await box.write(
  "store/plain/Plain.landmark.card",
  '<landmark><navigation><label>Plain</label><symbol>📁</symbol></navigation></landmark>\n',
);
await readLandmarkFeaturesForDir(box.root, "store/plain")
=> null
```

```cleanup
await box.cleanup();
```
