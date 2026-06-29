# location.capture: store a Geolocation fix from the web frontend

The `location.capture` tRPC mutation validates the posted coordinates, stamps
`capturedAt`/`source`, and writes the box's last-known fix. Out-of-range input
is rejected by Zod and nothing is written.

```ts setup
import { appRouter } from "../../src/webapp/trpc/router.js";
import { loadLocation } from "../../src/core/location-store.js";
import { makeTmpBox } from "../helpers/doctest-helpers.js";

// Minimal tRPC context — capture only reads ctx.boxRoot (cf. ssr/render.tsx).
function caller(boxRoot) {
  const ctx = {
    boxRoot,
    boxSlug: "test",
    eventBus: { emit: () => 0, emitTransient: () => {}, readSince: () => [], subscribe: () => ({ unsubscribe: () => {} }), prune: () => 0, close: () => {} },
    services: {},
  };
  return appRouter.createCaller(ctx);
}
```

## Valid capture stores a readable fix, stamped web + capturedAt

```ts
const box = await makeTmpBox();
await caller(box.root).location.capture({ lat: 45.5, lng: -122.6, accuracy: 15 });
const stored = await loadLocation(box.root);
JSON.stringify({ lat: stored.lat, lng: stored.lng, accuracy: stored.accuracy, source: stored.source })
=> {"lat":45.5,"lng":-122.6,"accuracy":15,"source":"web"}

typeof stored.capturedAt
=> string
```

```ts cleanup
await box.cleanup();
```

## Out-of-range input is rejected; nothing is written

```ts
const box = await makeTmpBox();
const rejected = await caller(box.root).location.capture({ lat: 999, lng: 0, accuracy: 10 }).then(() => false, () => true);
rejected
=> true

await loadLocation(box.root)
=> null
```

```ts cleanup
await box.cleanup();
```
