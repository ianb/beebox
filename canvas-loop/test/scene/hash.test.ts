// Structural keys: equal data gives equal keys, even when hashing re-enters.
import assert from "node:assert/strict";
import { test } from "node:test";
import { geomKey, keyOf } from "../../src/scene/hash.js";
import type { Geom } from "../../src/scene/nodes.js";

test("a getter that hashes other data does not change the outer key", () => {
  const plain = { x: 2, y: 3 };
  const reentrant = {
    x: 2,
    get y(): number {
      keyOf({ z: 9 });
      return 3;
    },
  };
  assert.equal(keyOf(reentrant), keyOf(plain));
});

test("a geometry's key is structural: equal shapes share it, any change of number, kind or layout does not", () => {
  const path = (y: number): Geom => ({ kind: "path", commands: [["move", 0, 0], ["bezier", 1, 2, 3, 4, 5, y], ["close"]] });
  assert.equal(geomKey(path(6)), geomKey(path(6)));
  assert.notEqual(geomKey(path(6)), geomKey(path(-6)));
  assert.notEqual(geomKey({ kind: "path", commands: [["move", 0, 0]] }), geomKey({ kind: "path", commands: [["line", 0, 0]] }));
  assert.notEqual(geomKey({ kind: "rect", x: 0, y: 0, w: 1, h: 1 }), geomKey({ kind: "ellipse", x: 0, y: 0, rx: 1, ry: 1 }));
  assert.notEqual(geomKey({ kind: "rect", x: 0, y: 0, w: 1, h: 1 }), geomKey({ kind: "rect", x: -0, y: 0, w: 1, h: 1 }));
  const poly = (closed: boolean): Geom => ({ kind: "poly", points: [[0, 0], [1, 0], [0, 1]], closed });
  assert.equal(geomKey(poly(true)), geomKey(poly(true)));
  assert.notEqual(geomKey(poly(true)), geomKey(poly(false)));
});

test("a geometry outside the fixed layout is keyed as plain data, apart from every in-layout one", () => {
  // A point that is not a pair: refused at the call, but a hand-built scene can hold it.
  const tripled = (): Geom => {
    const points: [number, number][] = [[0, 0], [1, 0]];
    Reflect.set(points[0] ?? [], 2, 7);
    return { kind: "poly", points, closed: true };
  };
  const odd = tripled();
  const same = tripled();
  assert.equal(geomKey(odd), geomKey(same));
  assert.notEqual(geomKey(odd), geomKey({ kind: "poly", points: [[0, 0], [1, 0]], closed: true }));
  assert.notEqual(geomKey(odd), keyOf(same));
});
