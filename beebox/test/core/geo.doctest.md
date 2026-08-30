# geo: haversine distance + place matching

Pure geo math behind location resolution. `haversineMeters` is great-circle
distance; `matchPlace` returns the nearest place whose center is within its
radius (strict — no accuracy inflation), or null.

```ts setup
import { haversineMeters, matchPlace } from "../../src/core/geo.js";

const A = { name: "A", lat: 45.0, lng: -122.0, radius: 200 };
const B = { name: "B", lat: 45.001, lng: -122.0, radius: 5000 };
const BIG_A = { name: "A", lat: 45.0, lng: -122.0, radius: 5000 };
```

## haversine: one degree of latitude is ~111.2 km

```ts
const d = haversineMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
d > 111_000 && d < 111_400
=> true
```

## haversine is zero for identical points

```ts
haversineMeters({ lat: 45, lng: -122 }, { lat: 45, lng: -122 })
=> 0
```

## match: a fix at a place's center matches it

```ts
const m = matchPlace({ lat: 45.0, lng: -122.0 }, [A]);
m ? m.name : null
=> A
```

## match: a far-away fix matches nothing

```ts
matchPlace({ lat: 46.0, lng: -123.0 }, [A])
=> null
```

## match: empty place list → null

```ts
matchPlace({ lat: 45.0, lng: -122.0 }, [])
=> null
```

## match: on overlap, the nearest center wins

`BIG_A` (center exactly at the fix) and `B` (~111 m away) both contain the fix;
the nearer center, A, wins.

```ts
const m = matchPlace({ lat: 45.0, lng: -122.0 }, [B, BIG_A]);
m ? m.name : null
=> A
```

## match: strict radius — a fix just outside the radius does not match

```ts
// ~111 m north of A's center, A's radius is 200 m → inside; shrink radius to 50 m → outside.
matchPlace({ lat: 45.001, lng: -122.0 }, [{ name: "A", lat: 45.0, lng: -122.0, radius: 50 }])
=> null
```
