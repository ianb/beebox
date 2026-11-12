import assert from "node:assert/strict";
import { test } from "node:test";
import { assertStyle, resolveStyle, styleProblem } from "../../../src/core/painter/style.js";
import type { Style } from "../../../src/core/paint.js";

test("assertStyle names the call and the key", () => {
  assert.throws(() => assertStyle({ weight: -2 }, "circle"), /circle: style\.weight must be a number ≥ 0 \(got -2\)/u);
  assert.throws(() => assertStyle({ weight: Number.NaN }, "line"), /line: style\.weight/u);
  // eslint-disable-next-line no-restricted-syntax -- test boundary: a style built outside TypeScript's excess-key check
  const misspelt = { color: "red" } as unknown as Style;
  assert.throws(() => assertStyle(misspelt, "rect"), /rect: unknown style key "color"/u);
  // eslint-disable-next-line no-restricted-syntax -- test boundary: a misspelt preset name, as plain JavaScript would pass it
  const typo = { stroke: "#000", brush: "inc" } as unknown as Style;
  assert.throws(() => resolveStyle(typo, "path"), /unknown brush "inc"/u);
});

test("resolveStyle fills defaults: no fill or stroke, weight 1, normal blend", () => {
  const resolved = resolveStyle({ stroke: "#000" }, "line");
  assert.deepEqual(
    [resolved.fill, resolved.stroke, resolved.weight, resolved.brush, resolved.blend, resolved.erase],
    [undefined, "#000", 1, undefined, "normal", false],
  );
  assert.equal(resolveStyle({ stroke: "#000", brush: "ink" }, "line").brush?.kind, "ink");
});

test("styleProblem flags calls that can draw nothing", () => {
  const problem = (style: Style, open: boolean): string | undefined => styleProblem("x", { style: resolveStyle(style, "x"), open });
  assert.match(problem({ fill: "red" }, true) ?? "", /a line has no inside/u);
  assert.match(problem({}, true) ?? "", /no stroke/u);
  assert.match(problem({}, false) ?? "", /neither fill nor stroke/u);
  assert.equal(problem({ fill: "red" }, false), undefined);
  assert.equal(problem({ stroke: "red" }, true), undefined);
});
