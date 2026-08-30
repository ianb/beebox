# location-format: human line + age/staleness for `bbx location get`

Pure presentation given a `now`: the one-line form the CLI prints, and the
`{ ageMs, stale }` it adds to `--json`. A fix older than `LOCATION_STALE_MS`
(1 hour) is flagged `[stale]` but still reported.

```ts setup
import { formatLocationLine, locationAge } from "../src/core/location-format.js";

const FIX = { lat: 45.5231, lng: -122.6765, accuracy: 20.4, capturedAt: "2026-06-29T12:00:00.000Z", source: "web" };
```

## Fresh fix: coarse age + rounded accuracy

```ts
formatLocationLine(FIX, { now: new Date("2026-06-29T12:04:00.000Z") })
=> 45.5231,-122.6765 (±20m, captured 4 minutes ago, web)
```

## A matched place name is prepended

```ts
formatLocationLine(FIX, { now: new Date("2026-06-29T12:04:00.000Z"), place: "Home" })
=> Home — 45.5231,-122.6765 (±20m, captured 4 minutes ago, web)
```

## Stale fix gets a `[stale]` flag

```ts
formatLocationLine(FIX, { now: new Date("2026-06-29T14:00:00.000Z") })
=> 45.5231,-122.6765 (±20m, captured 2 hours ago, web) [stale]
```

## locationAge: ageMs + stale boolean

```ts
JSON.stringify(locationAge(FIX, new Date("2026-06-29T12:30:00.000Z")))
=> {"ageMs":1800000,"stale":false}

locationAge(FIX, new Date("2026-06-29T13:30:00.000Z")).stale
=> true
```

## Future `capturedAt` (clock skew) clamps to "moments ago"

```ts
formatLocationLine(FIX, { now: new Date("2026-06-29T11:59:00.000Z") })
=> 45.5231,-122.6765 (±20m, captured moments ago, web)
```
