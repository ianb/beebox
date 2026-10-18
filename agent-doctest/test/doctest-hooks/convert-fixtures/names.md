# Names

Setup that declares `t` and `after`: the converted file binds tap's under other names.

```ts setup
const t = { label: "mine" };
const after = "later";
```

```ts teardown
void after;
```

```ts timeout=120s
t.label
=> mine
```

An example import becomes a dynamic import in place, and a type-only import moves to module level:

```ts
import { basename } from "node:path";
import type { ParsedPath } from "node:path";
const parsed: ParsedPath | null = null;
basename("/a/b.txt")
=> b.txt
```

A try block's value, which needs the esbuild split:

```ts
try {
  JSON.parse("{")
} catch (e) {
  e instanceof SyntaxError
}
=> true
```
