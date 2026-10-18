# Collisions

Setup declares `t`, and an example declares `tap`, `out`, and `printed`: the
converter's own names must not collide with them.

```ts setup
const t = 1;
```

```ts teardown
import type { Stats } from "node:fs";
const stats: Stats | null = null;
void stats;
```

```ts
const tap = 2;
const out = 3;
const printed = 4;
print("x");
tap + out + printed + t
=> x
10
```

A comma expression in a throws example is one expression:

```ts
(() => { throw new Error("boom"); })(), 1
=> throws Error
```

Setup that declares `test` and `tapTest`, and a block comment holding an import:

```ts setup
const test = 1;
const tapTest = 2;
/*
import "./not-a-real-module.ts";
*/
```

```ts
test + tapTest
=> 3
```

`print` passed along rather than called:

```ts
const p = print;
p("x");
1
=> x
1
```

A `//` inside a string is not a comment that hides a `print` after it:

```ts
const url = "http://example.com"; print("y");
url
=> y
http://example.com
```
