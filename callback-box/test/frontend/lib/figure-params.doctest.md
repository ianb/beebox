# figure-params helpers

A figure card declares its accepted parameters in frontmatter; the embed link
supplies values as query strings. These helpers parse the declaration and coerce
supplied string values to the declared types.

```ts setup
import {
  parseDeclaredParams,
  coerceFigureParams,
} from "../../../src/frontend/src/lib/figure-params.js";
```

## parseDeclaredParams

Reads a frontmatter `params` array, keeping well-formed entries and dropping
malformed ones:

```ts
JSON.stringify(parseDeclaredParams([
  { name: "molecule", type: "string" },
  { name: "size", type: "number", default: 300 },
  { name: "bad", type: "color" },
  { name: 123, type: "string" },
  "nonsense",
]))
=> [{"name":"molecule","type":"string"},{"name":"size","type":"number","default":300}]
```

A non-array (or absent) declaration yields an empty list:

```ts
JSON.stringify(parseDeclaredParams(undefined))
=> []
```

## coerceFigureParams

Supplied values are coerced to the declared type:

```ts
const declared = [
  { name: "label", type: "string" },
  { name: "size", type: "number" },
  { name: "wireframe", type: "boolean" },
];
JSON.stringify(coerceFigureParams(declared, { label: "H2O2", size: "500", wireframe: "true" }))
=> {"label":"H2O2","size":500,"wireframe":true}
```

Booleans accept `true`/`1` and `false`/`0`:

```ts continue
JSON.stringify(coerceFigureParams(declared, { wireframe: "0" }))
=> {"wireframe":false}
```

A declared default fills in when the embed omits the value:

```ts
const declared = [{ name: "size", type: "number", default: 300 }];
JSON.stringify(coerceFigureParams(declared, {}))
=> {"size":300}
```

A param with neither a supplied value nor a default is omitted entirely, so the
sketch's own fallback runs (`figure.params.x` is `undefined`):

```ts
const declared = [{ name: "size", type: "number" }];
JSON.stringify(coerceFigureParams(declared, {}))
=> {}
```

An uncoercible value (e.g. `?size=abc`) falls back to the declared default, or is
omitted when there is none:

```ts
JSON.stringify(coerceFigureParams([{ name: "size", type: "number", default: 300 }], { size: "abc" }))
=> {"size":300}

JSON.stringify(coerceFigureParams([{ name: "size", type: "number" }], { size: "abc" }))
=> {}
```

Undeclared embed params are ignored — only declared params reach the sketch:

```ts
JSON.stringify(coerceFigureParams([{ name: "size", type: "number" }], { size: "400", rogue: "x" }))
=> {"size":400}
```
