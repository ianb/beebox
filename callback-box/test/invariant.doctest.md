# Invariant and exhaustiveness helpers

`assertNever`, `invariant`, and `checkInvariant` (`src/lib/invariant.ts`) are the
internal should-never-happen tools: they crash loudly on broken invariants and
make union dispatch fail to compile when a member is added. They are not for
boundary/user-facing validation.

```ts setup
import { assertNever, invariant, checkInvariant, InvariantError } from "../src/lib/invariant.js";

// A dispatch that uses assertNever as its exhaustiveness terminator.
function label(kind: "a" | "b"): string {
  switch (kind) {
    case "a":
      return "first";
    case "b":
      return "second";
    default:
      return assertNever(kind);
  }
}

// An invariant that narrows `string | null` to `string`.
function firstChar(s: string | null): string {
  invariant(s !== null, "s must be present");
  return s[0] ?? "";
}
```

## `assertNever` — exhaustiveness terminator

Used in a `default:` case, it throws if a union member was left unhandled. The
value is stringified into the message so a real drift is debuggable from the log.

```ts
label("a")
=> first

label("b")
=> second
```

Forcing an unhandled value through (as only a boundary bug could) throws:

```ts
// eslint-disable-next-line no-restricted-syntax -- deliberately feeding an off-union value to exercise the runtime guard
assertNever("c" as never)
=> throws InvariantError
```

## `invariant` — always throws, narrows the type

When the condition holds, `invariant` returns nothing and the type is narrowed.

```ts
firstChar("hi")
=> h
```

When it fails, it throws in every environment (no dev/prod split):

```ts
invariant(1 === 2, "one is not two")
=> throws InvariantError: one is not two

invariant(0, "falsy value")
=> throws InvariantError: falsy value
```

## `checkInvariant` — logs loudly, returns the condition, no narrowing

For the deliberate prod-degradation path: it returns a boolean and does not
throw, so the caller decides how to degrade.

```ts
checkInvariant(1 === 1, "always true")
=> true
```

It logs via `console.error` and returns `false` when the condition fails:

```ts
const errors: string[] = [];
const originalError = console.error;
console.error = (...args: unknown[]) => { errors.push(args.join(" ")); };
const result = checkInvariant(false, "manifest ahead of index");
console.error = originalError;
JSON.stringify({ result, logged: errors })
=> {"result":false,"logged":["Invariant violated: manifest ahead of index"]}
```

`InvariantError` is the thrown class for all three.

```ts
new InvariantError("boom").name
=> InvariantError
```
