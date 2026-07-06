# Result

`Result<T, E>` (`src/lib/result.ts`) is the one Result convention: a two-arm
discriminated union keyed on `ok`, with `value` on success and `error` on
failure. It's for failures the caller branches on; broken invariants and infra
failures throw instead (see `lib/invariant.ts`).

```ts setup
import { ok, err, okVoid, type Result } from "../src/lib/result.js";

// A tagged error arm — the pattern for a function whose caller acts on the cause.
type LookupError =
  | { cause: "not-found"; key: string }
  | { cause: "parse"; detail: string };

function lookup(store: Record<string, string>, key: string): Result<string, LookupError> {
  if (!(key in store)) return err({ cause: "not-found", key });
  const raw = store[key]!;
  if (raw === "") return err({ cause: "parse", detail: `empty value for ${key}` });
  return ok(raw.toUpperCase());
}

const store = { greeting: "hello", blank: "" };
```

## Constructing and branching

`ok(value)` and `err(error)` build the two arms; branching on `.ok` narrows the
union so `value`/`error` are only reachable on the matching arm.

```ts
lookup(store, "greeting").ok
=> true

const found = lookup(store, "greeting");
found.ok ? found.value : found.error.cause
=> HELLO
```

The failure arm carries the tagged error; the caller dispatches on `cause`.

```ts
const missing = lookup(store, "absent");
missing.ok
=> false

missing.ok ? "n/a" : `${missing.error.cause}:${missing.error.cause === "not-found" ? missing.error.key : ""}`
=> not-found:absent

const bad = lookup(store, "blank");
bad.ok ? "n/a" : bad.error.cause
=> parse
```

## Void success

A function with nothing to return on success uses `Result<void>` and the shared
`okVoid` marker.

```ts
function ensure(flag: boolean): Result<void> {
  return flag ? okVoid : err("flag was false");
}

ensure(true).ok
=> true

const r = ensure(false);
r.ok ? "ok" : r.error
=> flag was false
```
