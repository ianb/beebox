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

// Seed a figure card with one sketch in its attach scope (a card's attach scope
// drops the type: `Demo.figure.card` owns `Demo.attach/`).
async function seedSketch(ctx, name, source) {
  await ctx.seed(`_content/inbox/${name}.figure.card`, "");
  await ctx.seed(`_content/inbox/${name}.attach/sketch.ts`, source);
}

// GET the compiled module for a box-relative source path (the raw payload).
function moduleFor(ctx, rel) {
  return ctx.rawRequest({ method: "GET", url: `/api/figure/module.js?path=${rel}` });
}

async function compile(ctx, name, source) {
  await seedSketch(ctx, name, source);
  return moduleFor(ctx, `_content/inbox/${name}.attach/sketch.ts`);
}
```

## Compiling a sketch

A valid sketch in an attach scope compiles to a JavaScript module (not JSON),
so we read the raw payload. The output is real JavaScript — the sketch body
survives compilation — and is served as a module, not an error:

```ts
const ctx = await makeTestServer();
const res = await compile(ctx, "Demo", P5_SKETCH);
[res.statusCode, res.headers["content-type"], res.payload.includes("createCanvas"), res.payload.includes("figureError")]
=> [200, "application/javascript", true, false]
```

A canvas-loop entry type-imports `@ianbicking/canvas-loop`, which is not
resolvable from a box directory. esbuild erases type-only imports at parse
without resolving them, so the compile succeeds and the output carries no bare
canvas-loop specifier:

```ts continue
const orbit = await compile(ctx, "Orbit", CANVAS_LOOP_SKETCH);
({
  status: orbit.statusCode,
  figureError: orbit.payload.includes("figureError"),
  canvasLoopSpecifier: orbit.payload.includes("@ianbicking/canvas-loop"),
  mountSketch: orbit.payload.includes("mountSketch"),
  update: orbit.payload.includes("update"),
})
=> { status: 200, figureError: false, canvasLoopSpecifier: false, mountSketch: true, update: true }
```

The instructions say `import type` ONLY. A sketch that value-imports the
package instead hits esbuild's resolve error (the package genuinely isn't
resolvable from a box), which arrives through the `figureError` channel and
names the module:

```ts continue
const wrong = await compile(ctx, "Wrong", VALUE_IMPORT_SKETCH);
({
  status: wrong.statusCode,
  figureError: wrong.payload.includes("figureError"),
  couldNotResolve: wrong.payload.includes("Could not resolve"),
  names: wrong.payload.includes("@ianbicking/canvas-loop/browser"),
})
=> { status: 200, figureError: true, couldNotResolve: true, names: true }
```

A syntax error does not 500 — it returns a module exporting `figureError`, which
the harness checks before treating `default` as the sketch factory:

```ts continue
const broken = await compile(ctx, "Broken", "export default function( {");
[broken.statusCode, broken.payload.includes("figureError")]
=> [200, true]
```

```ts cleanup
await ctx.cleanup();
```

## An edit is never served stale — even same length, same mtime

The figure route compiles with `cache: false`, so it always reflects current
disk state. This is stronger than the compiler's mtime+size heuristic: here we
pin mtime to a fixed instant AND keep the byte length identical across both
writes, so mtime *and* size match — a state where the cache heuristic would
serve the stale prior output — and prove the route still returns the new module.

```ts
const ctx = await makeTestServer();
const rel = "_content/inbox/Cache.attach/sketch.ts";
const abs = join(ctx.boxRoot, rel);
const pinned = new Date(1577836800000); // fixed instant: identical mtimeMs on both writes
// The distinguishing marker lives in a string LITERAL, not a comment — esbuild
// strips comments, so a comment marker would never survive into the output.
await ctx.seed("_content/inbox/Cache.figure.card", "");
await ctx.seed(rel, "export default function (p5, mount, figure) { const marker = \"AAA\"; return () => marker; }");
await utimes(abs, pinned, pinned);

const first = await moduleFor(ctx, rel);
first.payload.includes("AAA")
=> true
```

Rewrite to a SAME-LENGTH marker and re-pin the same mtime (mtime and size both
unchanged) — the re-request still returns the NEW output, not the cached "AAA":

```ts continue
await writeFile(abs, "export default function (p5, mount, figure) { const marker = \"BBB\"; return () => marker; }");
await utimes(abs, pinned, pinned);

const second = await moduleFor(ctx, rel);
[second.payload.includes("BBB"), second.payload.includes("AAA")]
=> [true, false]
```

```ts cleanup
await ctx.cleanup();
```

## A symlink escaping the box is refused without leaking the target

A figure source path is contained to the box by string prefix, but stat/read/
compile follow symlinks. A symlink inside an attach dir pointing at a file
outside the box is rejected on the resolved real path — before any read — and the
error body is the containment error and carries none of the target's contents:

```ts
const ctx = await makeTestServer();
const secretPath = join(ctx.boxRoot, "..", "OUTSIDE_SECRET.txt");
await writeFile(secretPath, "TOPSECRET-DO-NOT-LEAK");
// Seed a real sketch to create the attach dir, then plant an escaping symlink in it.
await ctx.seed("_content/inbox/Evil.attach/real.ts", "export default () => {};");
await symlink(secretPath, join(ctx.boxRoot, "_content/inbox/Evil.attach/escape.ts"));

const res = await moduleFor(ctx, "_content/inbox/Evil.attach/escape.ts");
[res.statusCode, res.payload.includes("TOPSECRET"), res.payload.includes("Path outside box")]
=> [400, false, true]
```

A dangling symlink (target absent) is a clean 404, not a 500:

```ts continue
await symlink(
  join(ctx.boxRoot, "_content/inbox/Evil.attach/nonexistent-target.ts"),
  join(ctx.boxRoot, "_content/inbox/Evil.attach/broken.ts"),
);
(await moduleFor(ctx, "_content/inbox/Evil.attach/broken.ts")).statusCode
=> 404
```

```ts cleanup
await rm(secretPath, { force: true });
await ctx.cleanup();
```

## Guard rails

Each bad request is refused before any compile. A missing `?path` is a bad
request; a path that escapes the box is refused (resolved against `root + sep`,
so a sibling can't satisfy the check); the endpoint only compiles a `.ts`/`.tsx`
source inside an attach scope — it is not a general code server for loose box
files. A well-formed path to a source that doesn't exist is a 404, distinct
from a compile error:

```ts
const ctx = await makeTestServer();
await ctx.seed("_content/notes/loose.ts", "export default () => {};");
const status = async (query) => (await ctx.request({ method: "GET", url: `/api/figure/module.js${query}` })).statusCode;

await status("")
=> 400

await status("?path=../outside.ts")
=> 400

await status("?path=_content/notes/loose.ts")
=> 400

await status("?path=_content/inbox/Ghost.attach/missing.ts")
=> 404
```

```ts cleanup
await ctx.cleanup();
```

## The owning card is found by basename, not by filename

A card filename carries its type — `Cube.figure.card` — while its attach scope
drops it: `Cube.attach/`. So the owner of an attach scope is the card whose
*basename* matches, and looking for a literal `Cube.card` finds nothing. That
was the bug: every figure in every box was refused with "Attach scope has no
owning card" while its card sat right beside the directory
(`issues/closed/bugs/2026-09-05-figure-module-attach-scope-has-no-owning-card.md`).

```ts
const ctx = await makeTestServer();
await ctx.seed("_content/figures/Cube.figure.card", "");
await ctx.seed("_content/figures/Cube.attach/sketch.ts", "export default () => () => {};");
(await moduleFor(ctx, "_content/figures/Cube.attach/sketch.ts")).statusCode
=> 200
```

A positional card — a bare `<type>.card`, "the ‹type› of this directory" — owns
`<type>.attach/` by the same rule.

```ts continue
await ctx.seed("_content/figures/gallery.card", "");
await ctx.seed("_content/figures/gallery.attach/sketch.ts", "export default () => () => {};");
(await moduleFor(ctx, "_content/figures/gallery.attach/sketch.ts")).statusCode
=> 200
```

An attach-named directory is not enough: it must be the sibling attach scope of
an existing card. This prevents arbitrary box files from becoming compilable
modules merely by being placed under a `*.attach` directory:

```ts continue
await ctx.seed("_content/inbox/Loose.attach/sketch.ts", "export default () => {};");
const loose = await moduleFor(ctx, "_content/inbox/Loose.attach/sketch.ts");
[loose.statusCode, JSON.parse(loose.payload).error]
=> [400, "Attach scope has no owning card"]
```

```ts cleanup
await ctx.cleanup();
```
