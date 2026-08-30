# location-store: load/save last-known user location

`.beebox/location.json` holds one fix per box. `loadLocation`
validates the full on-disk shape and degrades any absent, corrupt, or
invalid file to `null` (reported as "unknown") rather than throwing — so a
hand-edit or partial write can never crash a read or an agent turn.

```ts setup
import { loadLocation, saveLocation } from "../src/core/location-store.js";
import { makeTmpBox } from "./helpers/doctest-helpers.js";

const FIX = { lat: 45.5231, lng: -122.6765, accuracy: 20, capturedAt: "2026-06-29T12:00:00.000Z", source: "web" };
```

## Absent file → null

```ts
const box = await makeTmpBox();
await loadLocation(box.root)
=> null
```

## Round-trip save/load (creates `.beebox/`)

```ts continue
await saveLocation(box.root, FIX);
JSON.stringify(await loadLocation(box.root))
=> {"lat":45.5231,"lng":-122.6765,"accuracy":20,"capturedAt":"2026-06-29T12:00:00.000Z","source":"web"}
```

## Malformed JSON → null

```ts continue
await box.write(".beebox/location.json", "{not json");
await loadLocation(box.root)
=> null
```

## Unparseable `capturedAt` → null (the NaN-age guard)

```ts continue
await box.write(".beebox/location.json", JSON.stringify({ ...FIX, capturedAt: "nope" }));
await loadLocation(box.root)
=> null
```

## Wrong `source` → null

```ts continue
await box.write(".beebox/location.json", JSON.stringify({ ...FIX, source: "ip" }));
await loadLocation(box.root)
=> null
```

## Out-of-range latitude → null

```ts continue
await box.write(".beebox/location.json", JSON.stringify({ ...FIX, lat: 999 }));
await loadLocation(box.root)
=> null
```

```ts cleanup
await box.cleanup();
```
