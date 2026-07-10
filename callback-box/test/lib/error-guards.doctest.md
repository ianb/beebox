# Error guards

Typed access to `unknown` caught values — the blessed replacement for
`(e as NodeJS.ErrnoException).code` and `(e as Error).message` casts in catch
blocks. See `src/lib/error-guards.ts`.

```ts setup
import {
  errnoCode,
  isErrnoException,
  toError,
  errorMessage,
  NonError,
} from "../../src/lib/error-guards.js";
```

## errnoCode

Returns the string `.code` of an errno-style throwable — a real fs error, or
any object duck-typed with a string `code`:

```ts
const enoent = Object.assign(new Error("no such file"), { code: "ENOENT" });
errnoCode(enoent)
=> ENOENT

errnoCode({ code: "EEXIST" })
=> EEXIST
```

Returns `undefined` for anything without a string `code` — a plain Error, a
non-object throwable, `null`/`undefined`, or a non-string `code`:

```ts
errnoCode(new Error("boom"))
=> undefined

errnoCode("just a string")
=> undefined

errnoCode(undefined)
=> undefined

errnoCode(null)
=> undefined

errnoCode({ code: 42 })
=> undefined
```

This makes the common errno check a plain equality with no cast:

```ts
const enoent = Object.assign(new Error("no such file"), { code: "ENOENT" });
errnoCode(enoent) === "ENOENT"
=> true

errnoCode(new Error("boom")) !== "ENOENT"
=> true
```

## isErrnoException

A type guard for callers that need the fuller `ErrnoException` shape
(`.syscall`, `.path`, `.errno`), not just `.code`. Requires an actual `Error`
with a string `code` — a bare object with a `code` is not one:

```ts
const err = Object.assign(new Error("nope"), { code: "EACCES", syscall: "open" });
isErrnoException(err)
=> true

isErrnoException(new Error("boom"))
=> false

isErrnoException({ code: "ENOENT" })
=> false

isErrnoException("ENOENT")
=> false
```

Inside the guard, the errno fields are typed:

```ts continue
isErrnoException(err) ? err.syscall : "n/a"
=> open
```

## toError

An `Error` passes through unchanged — same identity, so a caller can rethrow it
or branch on `instanceof`:

```ts
const original = new TypeError("bad type");
toError(original) === original
=> true

toError(original) instanceof TypeError
=> true
```

Custom error subclasses survive too (identity + class preserved):

```ts
class CardIOError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "CardIOError";
  }
}
const custom = new CardIOError("disk gone");
toError(custom) === custom
=> true

toError(custom).name
=> CardIOError
```

A non-Error throwable is wrapped in a `NonError`, with the original preserved as
`.cause`:

```ts
const wrapped = toError("plain string throw");
wrapped instanceof Error
=> true

wrapped.name
=> NonError

wrapped.message
=> plain string throw

wrapped.cause
=> plain string throw
```

Non-string throwables render best-effort — an object serializes as JSON,
`undefined` stringifies, and the original is still recoverable via `.cause`:

```ts
toError({ code: "ENOENT", path: "/x" }).message
=> {"code":"ENOENT","path":"/x"}

toError(undefined).message
=> undefined

toError(42).message
=> 42
```

The `.message` is a best-effort string, but `.cause` is the live original
throwable — a rethrow or a downstream `instanceof`/property check still sees the
exact value that was thrown:

```ts
const objThrow = { code: "EEXIST" };
toError(objThrow).cause === objThrow
=> true
```

## errorMessage

The one-liner for message access. An `Error`'s message comes through directly;
a non-Error throwable renders the same way `toError` would:

```ts
errorMessage(new Error("something failed"))
=> something failed

errorMessage("thrown string")
=> thrown string

errorMessage({ reason: "nope" })
=> {"reason":"nope"}

errorMessage(undefined)
=> undefined
```

Unlike the old `(e as Error).message` cast, a thrown string yields the string
itself rather than `undefined` at runtime:

```ts
const s: unknown = "boom";
errorMessage(s)
=> boom
```
