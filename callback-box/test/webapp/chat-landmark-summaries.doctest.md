# Chat picker landmark summaries

`loadLandmarkSummaries` backs the chat picker (`chat.byLandmark`, the
`/<box>/chats` page): it reads every `*.landmark.card` and returns the
tile-level metadata (dir, label, symbol) the picker groups chats under.

It reads the card's YAML **frontmatter** `navigation` (label + symbol). This
regressed once: the read used the XML `parseCard`, which throws on a
frontmatter card, so every landmark was silently skipped — the picker showed no
landmarks and hid the chats grouped under them, while `/<box>/landmarks` (a
separate frontmatter reader) kept working.

```ts setup
import { loadLandmarkSummaries } from "../../src/core/landmark/summaries.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";
```

## Frontmatter landmark cards yield label + text symbol

```ts
const box = await makeTmpBox();
await box.write(
  "Box.landmark.card",
  "---\nnavigation:\n  label: Home\n  symbol: 🏠\n---\n",
);
await box.write(
  "recipes/Recipes.landmark.card",
  "---\nnavigation:\n  label: Recipes\n  symbol: 🍳\n---\n",
);

const { summaries, problems } = await loadLandmarkSummaries(box.root);
JSON.stringify(summaries)
=> [{"dir":"","label":"Home","symbol":"🏠","symbolSrc":null},{"dir":"recipes","label":"Recipes","symbol":"🍳","symbolSrc":null}]

JSON.stringify(problems)
=> []
```

## An image `symbol: { src }` resolves to a box-relative path

```ts
const box = await makeTmpBox();
await box.write(
  "trips/Trips.landmark.card",
  "---\nnavigation:\n  label: Trips\n  symbol:\n    src: Trips.attach/pin.png\n---\n",
);

const { summaries } = await loadLandmarkSummaries(box.root);
JSON.stringify(summaries)
=> [{"dir":"trips","label":"Trips","symbol":"","symbolSrc":"trips/Trips.attach/pin.png"}]
```

## Missing label falls back to the filename, missing navigation is tolerated

A landmark card with no `navigation` (a pure routing target) still produces a
tile, labeled from its filename — it isn't skipped.

```ts
const box = await makeTmpBox();
await box.write(
  "archive/Old_Mail.landmark.card",
  "---\ndestinations:\n  - for:\n      - triage\n---\n",
);

const { summaries } = await loadLandmarkSummaries(box.root);
JSON.stringify(summaries)
=> [{"dir":"archive","label":"Old_Mail","symbol":"","symbolSrc":null}]
```

## A card whose frontmatter doesn't parse is reported, not silently skipped

One bad card doesn't fail the read — the good landmarks still come back — but it
lands in `problems` so a consumer can say so. Silence was the old behavior, and
once a landmark is the only route to an activity, a hand-edit that breaks the
frontmatter would make that activity disappear without a trace.

```ts
const box = await makeTmpBox();
await box.write("Good.landmark.card", "---\nnavigation:\n  label: Good\n---\n");
await box.write("Bad.landmark.card", "not a frontmatter card at all\n");
await box.write("deep/Broken.landmark.card", "---\nnavigation:\n  label: [unterminated\n---\n");

const { summaries, problems } = await loadLandmarkSummaries(box.root);
JSON.stringify(summaries.map((s) => s.label))
=> ["Good"]

JSON.stringify(problems)
=> [{"path":"Bad.landmark.card"},{"path":"deep/Broken.landmark.card"}]
```
