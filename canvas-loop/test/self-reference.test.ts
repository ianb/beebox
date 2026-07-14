import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
// Self-reference the package by its published name (what a sibling workspace
// package does). That this file typechecks proves the "." export resolves for a
// NodeNext consumer — including the type-only `Sketch` re-export from headless.
import { Painter, SeededRandom, formatArgs } from "@ianbicking/canvas-loop";
import type { Msg, ParamsDecl, Sketch } from "@ianbicking/canvas-loop";

// Name the imported types so the compiler must resolve them (unused-var-safe).
type _Msg = Msg;
type _Params = ParamsDecl;
type _Sketch = Sketch;

test("core values are usable through the package name (self-reference)", () => {
  const a = new SeededRandom(42);
  const b = new SeededRandom(42);
  assert.equal(a.next(), b.next(), "seeded PRNG is deterministic");
  assert.equal(formatArgs(["x", 1, true]), "x 1 true", "formatArgs joins args");
  // The context-generic Painter is a real value export of the core entry.
  assert.equal(typeof Painter, "function", "Painter is exported from the package root");
});

// Probe a subpath in a bare process and report which heavy deps its import
// graph pulled into require.cache. `@napi-rs/canvas` (native, CJS) and `react`
// (CJS) both land in require.cache when loaded, so their absence is observable.
// The child prints "<napi>,<react>" as booleans — no JSON, so no parse-boundary
// cast is needed on this side.
function probeDeps(specifier: string): { napi: boolean; react: boolean } {
  const script = [
    'import { createRequire } from "node:module";',
    'const require = createRequire(process.cwd() + "/x.js");',
    `await import(${JSON.stringify(specifier)});`,
    "const keys = Object.keys(require.cache);",
    'const napi = keys.some((k) => k.includes("@napi-rs") && k.includes("canvas"));',
    "const react = keys.some((k) => /[\\\\/]react[\\\\/]/.test(k));",
    "process.stdout.write(`${napi},${react}`);",
  ].join("\n");
  const out = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    encoding: "utf8",
  });
  const [napi, react] = out.trim().split(",");
  return { napi: napi === "true", react: react === "true" };
}

test('importing "." resolves neither the native @napi-rs/canvas backend nor react', () => {
  const core = probeDeps("@ianbicking/canvas-loop");
  assert.equal(core.napi, false, "core entry is free of the native canvas dep");
  assert.equal(core.react, false, "core entry is free of react");
  // Positive control: the headless entry does pull the native backend in.
  assert.equal(probeDeps("@ianbicking/canvas-loop/headless").napi, true, "headless entry loads the native canvas dep");
});

test('importing "./eslint" resolves neither the native backend nor react', () => {
  const eslintDeps = probeDeps("@ianbicking/canvas-loop/eslint");
  assert.equal(eslintDeps.napi, false, "eslint plugin is free of the native canvas dep");
  assert.equal(eslintDeps.react, false, "eslint plugin is free of react");
});
