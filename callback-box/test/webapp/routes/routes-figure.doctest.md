# Figure API

The figure API compiles a figure card's `entry` source — a TypeScript file in
the card's attach scope — into a runnable ES module. The frontend resolves the
card's `entry` against the card path and passes the resolved box-relative path
as `?path=`.

```ts setup
import { makeTestServer } from "../../helpers/doctest-server.js";

// A p5 figure sketch: native-style, imports nothing (the harness provides p5),
// default-exports the (lib, mount, figure) => teardown factory.
const P5_SKETCH = `
export default function (p5, mount, figure) {
  const instance = new p5((p) => {
    p.setup = () => p.createCanvas(figure.params.size ?? 300, 300);
    p.draw = () => p.background(figure.data.bg ?? 200);
  }, mount);
  return () => instance.remove();
}
`;
```

## Compiling a sketch

A valid sketch in an attach scope compiles to a JavaScript module (not JSON),
so we read the raw payload:

```ts
const ctx = await makeTestServer();
await ctx.seed("box/inbox/Demo.figure.attach/sketch.ts", P5_SKETCH);

const res = await ctx.rawRequest({
  method: "GET",
  url: "/api/figure/module.js?path=box/inbox/Demo.figure.attach/sketch.ts",
});
res.statusCode
=> 200
```

The output is real JavaScript — the sketch body survives compilation — and is
served as a module, not an error:

```ts continue
res.headers["content-type"]
=> application/javascript

res.payload.includes("createCanvas")
=> true

res.payload.includes("figureError")
=> false
```

```ts cleanup
await ctx.cleanup();
```

## Compile errors return a figure-shaped error module

A syntax error does not 500 — it returns a module exporting `figureError`, which
the harness checks before treating `default` as the sketch factory:

```ts
const ctx = await makeTestServer();
await ctx.seed("box/inbox/Broken.figure.attach/sketch.ts", "export default function( {");

const res = await ctx.rawRequest({
  method: "GET",
  url: "/api/figure/module.js?path=box/inbox/Broken.figure.attach/sketch.ts",
});
res.statusCode
=> 200
```

```ts continue
res.payload.includes("figureError")
=> true
```

```ts cleanup
await ctx.cleanup();
```

## Guard rails

A missing `?path` is a bad request:

```ts
const ctx = await makeTestServer();
const res = await ctx.request({ method: "GET", url: "/api/figure/module.js" });
res.statusCode
=> 400
```

```ts cleanup
await ctx.cleanup();
```

A path that escapes the box is refused (resolved against `root + sep`, so a
sibling can't satisfy the check):

```ts
const ctx = await makeTestServer();
const res = await ctx.request({
  method: "GET",
  url: "/api/figure/module.js?path=../outside.ts",
});
res.statusCode
=> 400
```

```ts cleanup
await ctx.cleanup();
```

The endpoint only compiles a `.ts`/`.tsx` source inside an attach scope — it is
not a general code server for loose box files:

```ts
const ctx = await makeTestServer();
await ctx.seed("store/notes/loose.ts", "export default () => {};");
const res = await ctx.request({
  method: "GET",
  url: "/api/figure/module.js?path=store/notes/loose.ts",
});
res.statusCode
=> 400
```

```ts cleanup
await ctx.cleanup();
```

A well-formed path to a source that doesn't exist is a 404, distinct from a
compile error:

```ts
const ctx = await makeTestServer();
const res = await ctx.request({
  method: "GET",
  url: "/api/figure/module.js?path=box/inbox/Ghost.figure.attach/missing.ts",
});
res.statusCode
=> 404
```

```ts cleanup
await ctx.cleanup();
```
