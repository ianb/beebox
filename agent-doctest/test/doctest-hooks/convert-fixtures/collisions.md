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
