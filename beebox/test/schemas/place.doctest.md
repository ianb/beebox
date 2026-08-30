# Place card schema

Place cards (`places/<Name>.place.card`) name a location the box recognizes.
Coordinates are optional (authored card-first, then stamped by `bbx location
mark`); the `validate` hook flags a half-set coordinate.

```ts setup
import { PlaceSchema, createPlaceTemplate } from "../../src/schemas/place.js";
import { parseCardText } from "../../src/core/card-io.js";
import { createCardSchemaMap } from "../../src/schemas/registry.js";

const schemas = await createCardSchemaMap();
const v = PlaceSchema.validate;
```

## Registered as `place`

```ts
PlaceSchema.type
=> place
```

## A coordless draft (name + address + body) validates

```ts
const draft = "---\nstatus: active\nname: Home\naddress: 123 Main St\n---\nWhere the boxholder works.\n";
const parsed = parseCardText(draft, { source: "places/Home.place.card", schemas });
parsed.fields.name
=> Home

parsed.fields.address
=> 123 Main St
```

## A full card with coordinates validates

```ts
const full = "---\nstatus: active\nname: Home\nlat: 45.5231\nlng: -122.6765\nradius: 120\n---\nbody\n";
const parsed = parseCardText(full, { source: "places/Home.place.card", schemas });
JSON.stringify([parsed.fields.lat, parsed.fields.lng, parsed.fields.radius])
=> [45.5231,-122.6765,120]
```

## Out-of-range latitude fails the per-field Zod check

```ts
PlaceSchema.frontmatterSchema.safeParse({ type: "place", status: "active", name: "X", lat: 999, lng: 0 }).success
=> false
```

## The `validate` hook flags a half-set coordinate (lat without lng)

```ts
(v ? v({ fields: { name: "Home", lat: 45.5 } }) : []).length
=> 1

(v ? v({ fields: { name: "Home", lat: 45.5 } }) : [])[0].severity
=> warning
```

## Both-or-neither: full coords and no coords both pass clean

```ts
(v ? v({ fields: { name: "Home", lat: 45.5, lng: -122.6 } }) : []).length
=> 0

(v ? v({ fields: { name: "Home" } }) : []).length
=> 0
```

## Template scaffolds a coordless card (coords come from `bbx location mark`)

```ts
const text = createPlaceTemplate({ name: "Office", address: "1 Market St" });
text.includes("name: Office") && text.includes("address: 1 Market St") && !text.includes("lat:")
=> true
```
