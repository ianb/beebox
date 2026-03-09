# serialize

`serialize()` converts any value to a string for comparison in `check()`. It tries registered serializers first, then falls back to sensible defaults.

```ts setup
import { serialize } from "../src/check.js";
```

Strings pass through unchanged:

```
serialize("hello")
=> hello
```

Numbers and primitives use `String()`:

```
serialize(42)
=> 42
```

`null` and `undefined` become their names:

```
serialize(null)
=> null
```

```
serialize(undefined)
=> undefined
```

Objects get `JSON.stringify` with 2-space indent:

```
serialize({ a: 1, b: "two" })
=>
{
  "a": 1,
  "b": "two"
}
```

```
serialize([1, 2, 3])
=>
[
  1,
  2,
  3
]
```
