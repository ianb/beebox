# Chat picker landmark summaries

`loadLandmarkSummaries` backs the chat picker (`chat.byLandmark` — the
Landmarks page and the `view: chat-picker` cards): it reads every
`*.landmark.card` and returns the tile-level metadata (path, dir, label,
symbol) the picker groups chats under.

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
=> [{"path":"Box.landmark.card","dir":"","label":"Home","symbol":{"glyph":"🏠"}},{"path":"recipes/Recipes.landmark.card","dir":"recipes","label":"Recipes","symbol":{"glyph":"🍳"}}]

JSON.stringify(problems)
=> []
```

## An image `symbol: { src }` resolves to a box-relative path

```ts
const box = await makeTmpBox();
await box.write(
  "trips/Trips.landmark.card",
  "---\nnavigation:\n  label: Trips\n  symbol:\n    src: /_content/trips/Trips.attach/pin.png\n---\n",
);

const { summaries } = await loadLandmarkSummaries(box.root);
JSON.stringify(summaries)
=> [{"path":"trips/Trips.landmark.card","dir":"trips","label":"Trips","symbol":{"src":"_content/trips/Trips.attach/pin.png"}}]
```

## A box-root `symbol.src` (leading `/`) resolves against the box, not the card

The regression that shipped broken icons to the app bar's place menu while the
landmarks page rendered them fine. The two surfaces resolved symbols through
different code: the page used the shared ref algebra, the menu hand-rolled
`path.resolve(landmarkDir, src)`. For a *document-relative* src the two agree,
which is why the case above never caught it — but `path.resolve` lets an
absolute path win, so a leading-`/` src silently escaped the box
(`../../../archive/…`) and 404'd. Both now call `readLandmarkSymbol`.

```ts
const box = await makeTmpBox();
await box.write(
  "archive/people/marlowe/Marlowe.landmark.card",
  "---\nnavigation:\n  label: Marlowe\n  symbol:\n    src: /_content/archive/people/marlowe/images/priya-portrait.webp\n---\n",
);

const { summaries } = await loadLandmarkSummaries(box.root);
summaries[0].symbol?.src
=> _content/archive/people/marlowe/images/priya-portrait.webp
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
=> [{"path":"archive/Old_Mail.landmark.card","dir":"archive","label":"Old_Mail","symbol":null}]
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
