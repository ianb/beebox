// # Figure API
//
// The figure API compiles a figure card's `entry` source — a TypeScript file in
// the card's attach scope — into a runnable ES module. The frontend resolves the
// card's `entry` against the card path and passes the resolved box-relative path
// as `?path=`.

import { test } from "tap";
import "agent-doctest/tap";
import { makeTestServer, type TestServer } from "../../helpers/test-route-server.js";
import { writeFile, utimes, symlink, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { realpathSync } from "node:fs";

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
interface Sketch {
  name: string;
  source: string;
}

async function seedSketch(ctx: TestServer, { name, source }: Sketch) {
  await ctx.seed(`_content/inbox/${name}.figure.card`, "");
  await ctx.seed(`_content/inbox/${name}.attach/sketch.ts`, source);
}

// GET the compiled module for a box-relative source path (the raw payload).
function moduleFor(ctx: TestServer, rel: string) {
  return ctx.rawRequest({ method: "GET", url: `/api/figure/module.js?path=${rel}` });
}

// The status, type and body of a raw response.
function page(res: { statusCode: number; headers: Record<string, unknown>; payload: string }) {
  return { statusCode: res.statusCode, contentType: res.headers["content-type"], payload: res.payload };
}

// esbuild heads its output with the source path relative to the working directory,
// resolved through symlinks (the temp box lives under `/var`, really `/private/var`).
function sourcePath(ctx: TestServer, rel: string) {
  return relative(process.cwd(), join(realpathSync(ctx.boxRoot), rel));
}

async function compile(ctx: TestServer, sketch: Sketch) {
  const { name } = sketch;
  await seedSketch(ctx, sketch);
  return moduleFor(ctx, `_content/inbox/${name}.attach/sketch.ts`);
}

// ## Compiling a sketch
//
// A valid sketch in an attach scope compiles to a JavaScript module (not JSON),
// so we read the raw payload. The output is real JavaScript — the sketch body
// survives compilation — and is served as a module, not an error:
void test("A valid sketch in an attach scope compiles to a JavaScript module (not JSON),...", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L76
  const ctx = await makeTestServer();
  const res = await compile(ctx, { name: "Demo", source: P5_SKETCH });
  t.check(page(res), {
    statusCode: 200,
    contentType: "application/javascript",
    payload: `// ${sourcePath(ctx, "_content/inbox/Demo.attach/sketch.ts")}
function sketch_default(p5, mount, figure) {
  const instance = new p5((p) => {
    p.setup = () => p.createCanvas(figure.params.size ?? 300, 300);
    p.draw = () => p.background(figure.data.bg ?? 200);
  }, mount);
  return () => instance.remove();
}
export {
  sketch_default as default
};
`,
  });

  // A canvas-loop entry type-imports `@ianbicking/canvas-loop`, which is not
  // resolvable from a box directory. esbuild erases type-only imports at parse
  // without resolving them, so the compile succeeds and the output carries no bare
  // canvas-loop specifier:

  // doctest:L88
  const orbit = await compile(ctx, { name: "Orbit", source: CANVAS_LOOP_SKETCH });
  t.check(page(orbit), {
    statusCode: 200,
    contentType: "application/javascript",
    payload: `// ${sourcePath(ctx, "_content/inbox/Orbit.attach/sketch.ts")}
var params = { speed: { type: "number", min: 0, max: 5, default: 1 } };
function init() {
  return { angle: 0 };
}
function update(model, msg, u) {
  return msg.type === "tick" ? { angle: model.angle + 0.03 * u.params.speed } : model;
}
function draw(v, model, p) {
  v.background("#0b0e17");
  v.circle(200 + 90 * Math.cos(model.angle), 150 + 90 * Math.sin(model.angle), 24);
}
var sketch_default = (cl, { mount, figure }) => cl.mountSketch(mount, { module: { params, init, update, draw }, initialParams: figure.params });
export {
  sketch_default as default,
  draw,
  init,
  params,
  update
};
`,
  });

  // The instructions say `import type` ONLY. A sketch that value-imports the
  // package instead hits esbuild's resolve error (the package genuinely isn't
  // resolvable from a box), which arrives through the `figureError` channel and
  // names the module:

  // doctest:L105
  const wrong = await compile(ctx, { name: "Wrong", source: VALUE_IMPORT_SKETCH });
  t.check(page(wrong), {
    statusCode: 200,
    contentType: "application/javascript",
    payload: `export const figureError = "Build failed with 1 error:\\n${sourcePath(ctx, "_content/inbox/Wrong.attach/sketch.ts")}:2:28: ERROR: Could not resolve \\"@ianbicking/canvas-loop/browser\\"";
`,
  });

  // A syntax error does not 500 — it returns a module exporting `figureError`, which
  // the harness checks before treating `default` as the sketch factory:

  // doctest:L119
  const broken = await compile(ctx, { name: "Broken", source: "export default function( {" });
  t.check(page(broken), {
    statusCode: 200,
    contentType: "application/javascript",
    payload: `export const figureError = "Build failed with 1 error:\\n${sourcePath(ctx, "_content/inbox/Broken.attach/sketch.ts")}:1:26: ERROR: Expected identifier but found end of file";
`,
  });
});

// ## An edit is never served stale — even same length, same mtime
//
// The figure route compiles with `cache: false`, so it always reflects current
// disk state. This is stronger than the compiler's mtime+size heuristic: here we
// pin mtime to a fixed instant AND keep the byte length identical across both
// writes, so mtime *and* size match — a state where the cache heuristic would
// serve the stale prior output — and prove the route still returns the new module.
void test("The figure route compiles with cache:", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L137
  const ctx = await makeTestServer();
  const rel = "_content/inbox/Cache.attach/sketch.ts";
  const abs = join(ctx.boxRoot, rel);
  const pinned = new Date(1577836800000); // fixed instant: identical mtimeMs on both writes
  // The distinguishing marker lives in a string LITERAL, not a comment — esbuild
  // strips comments, so a comment marker would never survive into the output.
  await ctx.seed("_content/inbox/Cache.figure.card", "");
  await ctx.seed(rel, "export default function (p5, mount, figure) { const marker = \"AAA\"; return () => marker; }");
  await utimes(abs, pinned, pinned);

  // doctest:L147
  const first = await moduleFor(ctx, rel);
  const cacheModule = (marker: string) => ({
    statusCode: 200,
    contentType: "application/javascript",
    payload: `// ${sourcePath(ctx, rel)}
function sketch_default(p5, mount, figure) {
  const marker = "${marker}";
  return () => marker;
}
export {
  sketch_default as default
};
`,
  });
  t.check(page(first), cacheModule("AAA"));

  // Rewrite to a SAME-LENGTH marker and re-pin the same mtime (mtime and size both
  // unchanged) — the re-request still returns the NEW output, not the cached "AAA":

  // doctest:L156
  await writeFile(abs, "export default function (p5, mount, figure) { const marker = \"BBB\"; return () => marker; }");
  await utimes(abs, pinned, pinned);

  // doctest:L159
  const second = await moduleFor(ctx, rel);
  t.check(page(second), cacheModule("BBB"));
});

// ## A symlink escaping the box is refused without leaking the target
//
// A figure source path is contained to the box by string prefix, but stat/read/
// compile follow symlinks. A symlink inside an attach dir pointing at a file
// outside the box is rejected on the resolved real path — before any read — and the
// error body is the containment error and carries none of the target's contents:
void test("A figure source path is contained to the box by string prefix, but stat/read/...", async (t) => {
  t.teardown(async () => {
    try {
      await rm(secretPath, { force: true });
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L176
  const ctx = await makeTestServer();
  const secretPath = join(ctx.boxRoot, "..", "OUTSIDE_SECRET.txt");
  await writeFile(secretPath, "TOPSECRET-DO-NOT-LEAK");
  // Seed a real sketch to create the attach dir, then plant an escaping symlink in it.
  await ctx.seed("_content/inbox/Evil.attach/real.ts", "export default () => {};");
  await symlink(secretPath, join(ctx.boxRoot, "_content/inbox/Evil.attach/escape.ts"));

  // doctest:L183
  const res = await moduleFor(ctx, "_content/inbox/Evil.attach/escape.ts");
  t.check(page(res), {
    statusCode: 400,
    contentType: "application/json; charset=utf-8",
    payload: "{\"error\":\"Path outside box\"}",
  });

  // A dangling symlink (target absent) is a clean 404, not a 500:

  // doctest:L191
  await symlink(
    join(ctx.boxRoot, "_content/inbox/Evil.attach/nonexistent-target.ts"),
    join(ctx.boxRoot, "_content/inbox/Evil.attach/broken.ts"),
  );
  t.check(page(await moduleFor(ctx, "_content/inbox/Evil.attach/broken.ts")), {
    statusCode: 404,
    contentType: "application/json; charset=utf-8",
    payload: "{\"error\":\"Source not found\"}",
  });
});

// ## Guard rails
//
// Each bad request is refused before any compile. A missing `?path` is a bad
// request; a path that escapes the box is refused (resolved against `root + sep`,
// so a sibling can't satisfy the check); the endpoint only compiles a `.ts`/`.tsx`
// source inside an attach scope — it is not a general code server for loose box
// files. A well-formed path to a source that doesn't exist is a 404, distinct
// from a compile error:
void test("Each bad request is refused before any compile.", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L214
  const ctx = await makeTestServer();
  await ctx.seed("_content/notes/loose.ts", "export default () => {};");
  const status = async (query: string) => (await ctx.request({ method: "GET", url: `/api/figure/module.js${query}` })).statusCode;

  // doctest:L218
  t.check(await status(""), 400);

  // doctest:L221
  t.check(await status("?path=../outside.ts"), 400);

  // doctest:L224
  t.check(await status("?path=_content/notes/loose.ts"), 400);

  // doctest:L227
  t.check(await status("?path=_content/inbox/Ghost.attach/missing.ts"), 404);
});

// ## The owning card is found by basename, not by filename
//
// A card filename carries its type — `Cube.figure.card` — while its attach scope
// drops it: `Cube.attach/`. So the owner of an attach scope is the card whose
// *basename* matches, and looking for a literal `Cube.card` finds nothing. That
// was the bug: every figure in every box was refused with "Attach scope has no
// owning card" while its card sat right beside the directory
// (`issues/closed/bugs/2026-09-05-figure-module-attach-scope-has-no-owning-card.md`).
void test("A card filename carries its type — Cube.figure.card — while its attach scope...", async (t) => {
  t.teardown(async () => {
    try {
      await ctx.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L245
  const ctx = await makeTestServer();
  await ctx.seed("_content/figures/Cube.figure.card", "");
  await ctx.seed("_content/figures/Cube.attach/sketch.ts", "export default () => () => {};");
  t.check(page(await moduleFor(ctx, "_content/figures/Cube.attach/sketch.ts")), {
    statusCode: 200,
    contentType: "application/javascript",
    payload: `// ${sourcePath(ctx, "_content/figures/Cube.attach/sketch.ts")}
var sketch_default = () => () => {
};
export {
  sketch_default as default
};
`,
  });

  // A positional card — a bare `<type>.card`, "the ‹type› of this directory" — owns
  // `<type>.attach/` by the same rule.

  // doctest:L256
  await ctx.seed("_content/figures/gallery.card", "");
  await ctx.seed("_content/figures/gallery.attach/sketch.ts", "export default () => () => {};");
  t.check(page(await moduleFor(ctx, "_content/figures/gallery.attach/sketch.ts")), {
    statusCode: 200,
    contentType: "application/javascript",
    payload: `// ${sourcePath(ctx, "_content/figures/gallery.attach/sketch.ts")}
var sketch_default = () => () => {
};
export {
  sketch_default as default
};
`,
  });

  // An attach-named directory is not enough: it must be the sibling attach scope of
  // an existing card. This prevents arbitrary box files from becoming compilable
  // modules merely by being placed under a `*.attach` directory:

  // doctest:L267
  await ctx.seed("_content/inbox/Loose.attach/sketch.ts", "export default () => {};");
  const loose = await moduleFor(ctx, "_content/inbox/Loose.attach/sketch.ts");
  t.check(page(loose), {
    statusCode: 400,
    contentType: "application/json; charset=utf-8",
    payload: "{\"error\":\"Attach scope has no owning card\"}",
  });
});
