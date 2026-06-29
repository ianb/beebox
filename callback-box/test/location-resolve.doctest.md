# Place resolution: loadPlaces + matching

`loadPlaces` reads the box's `*.place.card` cards as match circles — active,
with both coordinates — skipping coordless/half-set drafts, archived/inactive
places, and unparseable cards. `cb location get` then names the matched place.

```ts setup
import { loadPlaces } from "../src/core/place-cards.js";
import { matchPlace } from "../src/core/geo.js";
import { makeTmpBox } from "./helpers/doctest-helpers.js";

const place = (name, extra) => `---\nstatus: active\nname: ${name}\n${extra}---\nbody\n`;
```

## Loads active, fully-coordinated places; skips drafts/archived/half-set

```ts
const box = await makeTmpBox();
await box.write("places/Home.place.card", place("Home", "lat: 45.5231\nlng: -122.6765\nradius: 150\n"));
await box.write("places/Draft.place.card", place("Draft", "address: somewhere\n"));        // coordless
await box.write("places/Half.place.card", place("Half", "lat: 45.0\n"));                    // lat without lng
await box.write("places/Old.place.card", "---\nstatus: archived\nname: Old\nlat: 45.5\nlng: -122.6\n---\nb\n");
const places = await loadPlaces(box.root);
JSON.stringify(places.map((p) => p.name).sort())
=> ["Home"]
```

```ts continue
const fix = { lat: 45.5231, lng: -122.6765, accuracy: 12 };
const m = matchPlace(fix, places);
m ? m.name : null
=> Home
```

```ts cleanup
await box.cleanup();
```

## A missing radius falls back to the default

```ts
const box = await makeTmpBox();
await box.write("places/Office.place.card", place("Office", "lat: 40.0\nlng: -74.0\n"));
const places = await loadPlaces(box.root);
places[0].radius
=> 100
```

```ts cleanup
await box.cleanup();
```

## One unparseable place card is skipped; the others still load

```ts
const box = await makeTmpBox();
await box.write("places/Good.place.card", place("Good", "lat: 1\nlng: 2\nradius: 50\n"));
await box.write("places/Bad.place.card", "---\nname: [unterminated\n---\nbody\n");
const places = await loadPlaces(box.root);
JSON.stringify(places.map((p) => p.name))
=> ["Good"]
```

```ts cleanup
await box.cleanup();
```
