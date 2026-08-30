# location-share: storage key, parse boundary, refresh policy

Pure helpers behind the composer's "Share location" opt-in. The
browser-API functions (`captureCurrentPosition`, `isGeolocationAvailable`)
aren't exercised here — they need a DOM; these are the DOM-free parts.

```ts setup
import {
  locationShareKey,
  parseLocationShareState,
  serializeLocationShareState,
  shouldRefresh,
  LOCATION_REFRESH_INTERVAL_MS,
} from "../../../src/frontend/src/lib/location-share.ts";
```

## Key is scoped by box; missing slug falls back to a default

```ts
locationShareKey("test1")
=> bbx-location-share:test1

locationShareKey(undefined)
=> bbx-location-share:default
```

## Parse defaults to disabled for absent / malformed / invalid

```ts
JSON.stringify(parseLocationShareState(null))
=> {"enabled":false,"lastCapturedAt":null}

JSON.stringify(parseLocationShareState("{not json"))
=> {"enabled":false,"lastCapturedAt":null}

JSON.stringify(parseLocationShareState(JSON.stringify({ enabled: "yes" })))
=> {"enabled":false,"lastCapturedAt":null}
```

## Parse round-trips a valid state

```ts
const state = { enabled: true, lastCapturedAt: 1_700_000_000_000 };
JSON.stringify(parseLocationShareState(serializeLocationShareState(state)))
=> {"enabled":true,"lastCapturedAt":1700000000000}
```

## shouldRefresh: only when opted in, and stale (or never captured)

```ts
shouldRefresh({ enabled: false, lastCapturedAt: null }, 1_000_000)
=> false

shouldRefresh({ enabled: true, lastCapturedAt: null }, 1_000_000)
=> true

shouldRefresh({ enabled: true, lastCapturedAt: 1_000_000 }, 1_000_000 + LOCATION_REFRESH_INTERVAL_MS - 1)
=> false

shouldRefresh({ enabled: true, lastCapturedAt: 1_000_000 }, 1_000_000 + LOCATION_REFRESH_INTERVAL_MS + 1)
=> true
```
