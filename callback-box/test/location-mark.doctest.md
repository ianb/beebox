# cb location mark: stamp the current fix into a place card

`markPlace` reads the live fix and writes lat/lng/radius into an existing place
card. A coordless card gets center + default radius; an existing place only
grows with `--expand`. The raw-YAML mutate preserves the body and any other
frontmatter keys.

```ts setup
import { symlink, mkdir } from "node:fs/promises";
import { applyMark, markPlace } from "../src/core/place-mark.js";
import { saveLocation } from "../src/core/location-store.js";
import { loadPlaces } from "../src/core/place-cards.js";
import { matchPlace } from "../src/core/geo.js";
import { makeTmpBox } from "./helpers/doctest-helpers.js";

const FIX = { lat: 45.5231, lng: -122.6765, accuracy: 18 };
const stored = (fix, capturedAt) => ({ ...fix, capturedAt, source: "web" });
const CARD = "---\nstatus: active\nname: Home\nfavorite: true\n---\nMy home — important because it's the default context.\n";
```

## applyMark stamps coords while preserving body + unknown keys

```ts
const out = applyMark(CARD, { fix: FIX, expand: false });
out.outcome
=> set

out.text.includes("favorite: true") && out.text.includes("My home — important because it's the default context.")
=> true

out.text.includes("lat: 45.5231") && out.text.includes("lng: -122.6765") && /radius: \d+/.test(out.text)
=> true
```

## A frontmatter comment on an untouched key survives the mutate

```ts
const commented = "---\nname: Home  # the main house\nstatus: active\n---\nbody\n";
applyMark(commented, { fix: FIX, expand: false }).text.includes("# the main house")
=> true
```

## First mark on a coordless card writes coords (markPlace, fresh fix)

```ts
const box = await makeTmpBox();
await box.write("places/Home.place.card", CARD);
await saveLocation(box.root, stored(FIX, "2026-06-29T12:00:00.000Z"));
const res = await markPlace({ boxRoot: box.root, cardPath: "places/Home.place.card", expand: false, now: new Date("2026-06-29T12:04:00.000Z") });
JSON.stringify({ ok: res.ok, changed: res.changed, marked: res.message.startsWith("Marked Home") })
=> {"ok":true,"changed":true,"marked":true}

const saved = await box.read("places/Home.place.card");
saved.includes("lat: 45.5231") && saved.includes("favorite: true")
=> true
```

```ts cleanup
await box.cleanup();
```

## A fix inside the radius is a no-op

```ts
const box = await makeTmpBox();
await box.write("places/Home.place.card", "---\nname: Home\nlat: 45.5231\nlng: -122.6765\nradius: 200\n---\nbody\n");
await saveLocation(box.root, stored(FIX, "2026-06-29T12:00:00.000Z"));
const res = await markPlace({ boxRoot: box.root, cardPath: "places/Home.place.card", expand: false, now: new Date("2026-06-29T12:01:00.000Z") });
JSON.stringify({ changed: res.changed, covers: res.message.includes("already covers") })
=> {"changed":false,"covers":true}
```

```ts cleanup
await box.cleanup();
```

## A fix outside the radius does not expand without --expand

```ts
const box = await makeTmpBox();
const small = "---\nname: Home\nlat: 45.5231\nlng: -122.6765\nradius: 50\n---\nbody\n";
await box.write("places/Home.place.card", small);
// ~1.5km away
await saveLocation(box.root, stored({ lat: 45.5360, lng: -122.6765, accuracy: 18 }, "2026-06-29T12:00:00.000Z"));
const res = await markPlace({ boxRoot: box.root, cardPath: "places/Home.place.card", expand: false, now: new Date("2026-06-29T12:01:00.000Z") });
JSON.stringify({ changed: res.changed, outside: res.message.includes("--expand") })
=> {"changed":false,"outside":true}

(await box.read("places/Home.place.card")) === small
=> true
```

```ts continue
const res2 = await markPlace({ boxRoot: box.root, cardPath: "places/Home.place.card", expand: true, now: new Date("2026-06-29T12:01:00.000Z") });
JSON.stringify({ changed: res2.changed, expanded: res2.message.startsWith("Expanded Home") })
=> {"changed":true,"expanded":true}
```

The grown radius actually contains the fix (ceil, not round), so `get` now matches it:

```ts continue
const places = await loadPlaces(box.root);
const m = matchPlace({ lat: 45.5360, lng: -122.6765 }, places);
m ? m.name : null
=> Home
```

```ts cleanup
await box.cleanup();
```

## A symlink resolving outside the box is refused (privacy boundary)

```ts
const box = await makeTmpBox();
const external = await makeTmpBox();
await external.write("target.place.card", CARD);
await saveLocation(box.root, stored(FIX, "2026-06-29T12:00:00.000Z"));
await mkdir(box.path("places"), { recursive: true });
await symlink(external.path("target.place.card"), box.path("places/Evil.place.card"));
const res = await markPlace({ boxRoot: box.root, cardPath: "places/Evil.place.card", expand: false, now: new Date() });
JSON.stringify({ ok: res.ok, outside: res.ok ? "" : res.error.includes("outside the box") })
=> {"ok":false,"outside":true}
```

```ts cleanup
await box.cleanup();
await external.cleanup();
```

## No current fix → clear error

```ts
const box = await makeTmpBox();
await box.write("places/Home.place.card", CARD);
const res = await markPlace({ boxRoot: box.root, cardPath: "places/Home.place.card", expand: false, now: new Date() });
JSON.stringify({ ok: res.ok, share: res.ok ? "" : res.error.includes("share location") })
=> {"ok":false,"share":true}
```

```ts cleanup
await box.cleanup();
```

## A path outside the box is refused

```ts
const box = await makeTmpBox();
await saveLocation(box.root, stored(FIX, "2026-06-29T12:00:00.000Z"));
const res = await markPlace({ boxRoot: box.root, cardPath: "/etc/evil.place.card", expand: false, now: new Date() });
JSON.stringify({ ok: res.ok, outside: res.ok ? "" : res.error.includes("outside the box") })
=> {"ok":false,"outside":true}
```

```ts cleanup
await box.cleanup();
```

## A stale fix proceeds and the message flags the age

```ts
const box = await makeTmpBox();
await box.write("places/Home.place.card", CARD);
await saveLocation(box.root, stored(FIX, "2020-01-01T00:00:00.000Z"));
const res = await markPlace({ boxRoot: box.root, cardPath: "places/Home.place.card", expand: false, now: new Date("2026-06-29T12:00:00.000Z") });
JSON.stringify({ ok: res.ok, stale: res.message.includes("[stale]") })
=> {"ok":true,"stale":true}
```

```ts cleanup
await box.cleanup();
```
