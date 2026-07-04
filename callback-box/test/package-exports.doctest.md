# Package exports — the public library surface

The `exports` map in package.json is the API boundary: box-authored code
(schemas, views, tricks) may import only these specifiers. This doctest
imports each one **the way box code does** — via the bare `callback-box/…`
specifier (package self-reference), not relative paths — so a broken export
target fails here before it fails in a real box.

```ts setup
import { cardSchema, body, splitCardContent } from "callback-box/cards";
import { z, parseYaml, stringifyYaml } from "callback-box/schema";
import * as server from "callback-box/server";
```

## callback-box/cards — card primitives

A box-local schema file's whole toolkit: `cardSchema` + `body` (plus `z` from
`callback-box/schema`, below).

```ts
const demo = cardSchema("demo", {
  fields: { status: z.enum(["new", "done"]), body: body(z.string()) },
});
demo.type
=> demo

Object.keys(demo.fields).sort().join(",")
=> body,status

splitCardContent("---\nstatus: new\n---\nHello.").body.trim()
=> Hello.
```

## callback-box/schema — validator deps, pinned to the engine's versions

```ts
z.string().parse("ok")
=> ok

stringifyYaml({ a: 1 }).trim()
=> a: 1

JSON.stringify(parseYaml("a: 1"))
=> {"a":1}
```

## callback-box/server — programmatic entry, no side effects on import

Importing the module must not start anything; it only exposes the functions
and the port constant.

```ts
typeof server.createServer
=> function

typeof server.startServer
=> function

server.DEFAULT_PORT
=> 3210
```

## callback-box/view-widgets and the box tsconfig base

`view-widgets` is React-flavored, so we import it dynamically and just verify
the exports resolve. The tsconfig base resolves as an exported JSON path.

```ts
const widgets = await import("callback-box/view-widgets");
Object.keys(widgets).includes("CardLink") && Object.keys(widgets).includes("CardRef")
=> true

import.meta.resolve("callback-box/tsconfig.base.json").endsWith("/tsconfig.base.json")
=> true
```
