# serialize

`serialize()` converts any value to a string for comparison in `check()`. It tries registered serializers first, then falls back to sensible defaults.

```ts setup
import { serialize } from "agent-doctest/check";
```

Strings pass through unchanged:

```ts
serialize("hello")
=> hello
```

Numbers and primitives use `String()`:

```ts
serialize(42)
=> 42
```

`null` and `undefined` become their names:

```ts
serialize(null)
=> null
```

```ts
serialize(undefined)
=> undefined
```

Objects get `JSON.stringify` with 2-space indent:

```ts
serialize({ a: 1, b: "two" })
=>
{
  "a": 1,
  "b": "two"
}
```

```ts
serialize([1, 2, 3])
=>
[
  1,
  2,
  3
]
```
