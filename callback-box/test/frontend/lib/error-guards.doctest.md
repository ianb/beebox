# Frontend error guards

Typed access to `unknown` caught/error values — the blessed replacement for the
`(e as Error).message` cast (including XState `onError` `event.error`, which is
typed `unknown`). A minimal local copy of the backend's `error-guards.ts`; see
`src/frontend/src/lib/error-guards.ts` and the `invariant.ts` precedent for why
the frontend keeps its own copy.

```ts setup
import {
  toError,
  errorMessage,
  NonError,
} from "../../../src/frontend/src/lib/error-guards.js";
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

A non-Error throwable is wrapped in a `NonError`, with the original preserved as
`.cause`:

```ts
const wrapped = toError("plain string throw");
wrapped instanceof Error
=> true

wrapped instanceof NonError
=> true

wrapped.name
=> NonError

wrapped.message
=> plain string throw

wrapped.cause
=> plain string throw
```

Non-string throwables render best-effort — an error-shaped object (a plain
object carrying a string `message`) reads like the old `(e as Error).message`
cast did; other objects serialize as JSON; `undefined` stringifies:

```ts
toError({ message: "boom", status: 500 }).message
=> boom

toError({ code: "ENOENT", path: "/x" }).message
=> {"code":"ENOENT","path":"/x"}

toError(undefined).message
=> undefined

toError(42).message
=> 42
```

## errorMessage

The one-liner for message access. An `Error`'s message comes through directly; a
non-Error throwable renders the same way `toError` would:

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
