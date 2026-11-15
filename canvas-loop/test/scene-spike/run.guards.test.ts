// The spike runner's testing-mode guards: params a sketch does not declare.
import assert from "node:assert/strict";
import { test } from "node:test";
import { SketchUsageError } from "../../src/core/errors.js";
import { guardParams } from "../../src/scene-spike/run/guards.js";

test("reading an undeclared param is an error, including names an object inherits", () => {
  const p = guardParams({ size: { type: "number", min: 1, max: 10, default: 4 } }, { size: 4 });
  assert.equal(p["size"], 4);
  for (const name of ["speed", "toString", "valueOf", "constructor"]) {
    assert.throws(() => p[name], (e: unknown) => e instanceof SketchUsageError && e.message.includes(`params.${name}: the sketch declares no param`), name);
  }
  assert.deepEqual({ ...p }, { size: 4 }, "spreading reads only the declared values");
  assert.equal(JSON.stringify(p), '{"size":4}');
});
