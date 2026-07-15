# Figure API

The figure API compiles a figure card's `entry` source — a TypeScript file in
the card's attach scope — into a runnable ES module. The frontend resolves the
card's `entry` against the card path and passes the resolved box-relative path
as `?path=`.

```ts setup
import { makeTestServer } from "../../helpers/doctest-server.js";
import { writeFile, utimes, symlink, rm } from "node:fs/promises";
import { join } from "node:path";

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

// A canvas-loop figure entry: TEA named exports + the default figure factory.
// The canvas-loop import is TYPE-ONLY — the package resolves nowhere inside a
// box, and esbuild erases type-only imports without attempting resolution.
const CANVAS_LOOP_SKETCH = `
import type { Msg, View } from "@ianbicking/canvas-loop";

export const params = { speed: { type: "number", min: 0, max: 5, default: 1 } };
export function init() { return { angle: 0 }; }
export function update(model, msg, u) {
  return msg.type === "tick" ? { angle: model.angle + 0.03 * u.params.speed } : model;
}
export function draw(v, model, p) {
  v.background("#0b0e17");
  v.circle(200 + 90 * Math.cos(model.angle), 150 + 90 * Math.sin(model.angle), 24);
}

export default (cl, { mount, figure }) =>
  cl.mountSketch(mount, { module: { params, init, update, draw }, initialParams: figure.params });
`;

// The same import as a VALUE import — the instructive failure case.
const VALUE_IMPORT_SKETCH = `
import { mountSketch } from "@ianbicking/canvas-loop/browser";
export default () => { mountSketch; };
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

## Compiling a canvas-loop sketch (type-only import erased)

A canvas-loop entry type-imports `@ianbicking/canvas-loop`, which is not
resolvable from a box directory. esbuild erases type-only imports at parse
without resolving them, so the compile succeeds and the output carries no bare
canvas-loop specifier:

```ts
const ctx = await makeTestServer();
await ctx.seed("box/inbox/Orbit.figure.attach/sketch.ts", CANVAS_LOOP_SKETCH);

const res = await ctx.rawRequest({
  method: "GET",
  url: "/api/figure/module.js?path=box/inbox/Orbit.figure.attach/sketch.ts",
});
res.statusCode
=> 200
```

```ts continue
res.payload.includes("figureError")
=> false

res.payload.includes("@ianbicking/canvas-loop")
=> false

res.payload.includes("mountSketch")
=> true

res.payload.includes("update")
=> true
```

```ts cleanup
await ctx.cleanup();
```

## A value import of canvas-loop fails with the instructive resolve error

The instructions say `import type` ONLY. A sketch that value-imports the
package instead hits esbuild's resolve error (the package genuinely isn't
resolvable from a box), which arrives through the `figureError` channel and
names the module:

```ts
const ctx = await makeTestServer();
await ctx.seed("box/inbox/Wrong.figure.attach/sketch.ts", VALUE_IMPORT_SKETCH);

const res = await ctx.rawRequest({
  method: "GET",
  url: "/api/figure/module.js?path=box/inbox/Wrong.figure.attach/sketch.ts",
});
res.statusCode
=> 200
```

```ts continue
res.payload.includes("figureError")
=> true

res.payload.includes("Could not resolve")
=> true

res.payload.includes("@ianbicking/canvas-loop/browser")
=> true
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

## A same-tick edit that changes length is not served stale

The compile cache keys on the file's mtime AND size. An editor that rewrites a
file within one clock tick leaves mtime unchanged — so mtime alone would serve
the stale prior output. Here we pin mtime to a fixed instant across both writes
so ONLY the size differs, proving the size half of the key catches the edit:

```ts
const ctx = await makeTestServer();
const rel = "box/inbox/Cache.figure.attach/sketch.ts";
const abs = join(ctx.boxRoot, rel);
const pinned = new Date(1577836800000); // fixed instant: identical mtimeMs on both writes
// The distinguishing marker lives in a string LITERAL, not a comment — esbuild
// strips comments, so a comment marker would never survive into the output.
await ctx.seed(rel, "export default function (p5, mount, figure) { const marker = \"AAA\"; return () => marker; }");
await utimes(abs, pinned, pinned);

const first = await ctx.rawRequest({
  method: "GET",
  url: `/api/figure/module.js?path=${rel}`,
});
first.payload.includes("AAA")
=> true
```

Rewrite to a different length and re-pin the same mtime — the re-request returns
the NEW output, not the cached "AAA" module:

```ts continue
await writeFile(abs, "export default function (p5, mount, figure) { const marker = \"BBBBBBBBBBBBBBBBBBBB\"; return () => marker; }");
await utimes(abs, pinned, pinned);

const second = await ctx.rawRequest({
  method: "GET",
  url: `/api/figure/module.js?path=${rel}`,
});
second.payload.includes("BBBBBBBBBBBBBBBBBBBB")
=> true

second.payload.includes("AAA")
=> false
```

```ts cleanup
await ctx.cleanup();
```

## A symlink escaping the box is refused without leaking the target

A figure source path is contained to the box by string prefix, but stat/read/
compile follow symlinks. A symlink inside an attach dir pointing at a file
outside the box is rejected on the resolved real path — before any read — and the
error body carries none of the target's contents:

```ts
const ctx = await makeTestServer();
const secretPath = join(ctx.boxRoot, "..", "OUTSIDE_SECRET.txt");
await writeFile(secretPath, "TOPSECRET-DO-NOT-LEAK");
// Seed a real sketch to create the attach dir, then plant an escaping symlink in it.
await ctx.seed("box/inbox/Evil.figure.attach/real.ts", "export default () => {};");
await symlink(secretPath, join(ctx.boxRoot, "box/inbox/Evil.figure.attach/escape.ts"));

const res = await ctx.rawRequest({
  method: "GET",
  url: "/api/figure/module.js?path=box/inbox/Evil.figure.attach/escape.ts",
});
res.statusCode
=> 400
```

The response is the containment error, and crucially contains no byte of the
secret file:

```ts continue
res.payload.includes("TOPSECRET")
=> false

res.payload.includes("Path outside box")
=> true
```

```ts cleanup
await rm(secretPath, { force: true });
await ctx.cleanup();
```

A dangling symlink (target absent) is a clean 404, not a 500:

```ts
const ctx = await makeTestServer();
await ctx.seed("box/inbox/Dangle.figure.attach/keep.ts", "export default () => {};");
await symlink(
  join(ctx.boxRoot, "box/inbox/Dangle.figure.attach/nonexistent-target.ts"),
  join(ctx.boxRoot, "box/inbox/Dangle.figure.attach/broken.ts"),
);

const res = await ctx.rawRequest({
  method: "GET",
  url: "/api/figure/module.js?path=box/inbox/Dangle.figure.attach/broken.ts",
});
res.statusCode
=> 404
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
