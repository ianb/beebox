# isRecord

Narrows an `unknown` to a plain string-keyed object — the blessed replacement
for the `value as Record<string, unknown>` cast that follows a `typeof` check.
See `src/shared/is-record.ts`.

```ts setup
import { isRecord } from "../../src/shared/is-record.js";
```

A plain object narrows to a record, so string-key access needs no cast:

```ts
const value: unknown = { pid: 42, host: "a" };
isRecord(value) && typeof value["pid"] === "number"
=> true
```

`null`, arrays, and non-objects are rejected — the cases a bare
`as Record<string, unknown>` would wrongly wave through:

```ts
isRecord(null)
=> false

isRecord([1, 2, 3])
=> false

isRecord("string")
=> false
```
