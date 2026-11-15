// Structural keys: equal data gives equal keys, even when hashing re-enters.
import assert from "node:assert/strict";
import { test } from "node:test";
import { geomKey, gestureKey, keyOf } from "../../src/scene/hash.js";
import type { Geom } from "../../src/scene/nodes.js";
import type { Gesture } from "../../src/core/brush/types.js";

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

test("a gesture's key: equal fields share it in any order; each field, and the envelope's form, changes it", () => {
  const frames = [[0, 0.6], [0.3, 1], [1, 0.6]] as const;
  assert.equal(gestureKey({ wobble: 0.8, seed: 3, pressure: frames }), gestureKey({ pressure: [[0, 0.6], [0.3, 1], [1, 0.6]], seed: 3, wobble: 0.8 }));
  // A call's `wobble: undefined` is copied as written; the expansion reads it as absent.
  const undefinedWobble: Gesture = {};
  Reflect.set(undefinedWobble, "wobble", undefined);
  assert.equal(gestureKey({}), gestureKey(undefinedWobble));
  const gestures: Gesture[] = [{}, { seed: 3 }, { seed: 4 }, { wobble: 3 }, { faint: true }, { faint: false }, { pressure: 0.5 }, { pressure: "taper" }, { pressure: "swell" }, { pressure: [[0, 0.5]] }, { pressure: [[0, 0.5], [1, 0.5]] }];
  const keys = gestures.map((g) => gestureKey(g));
  assert.equal(new Set(keys).size, keys.length);
});

test("a getter that asks for another geometry's or gesture's key does not change the outer key", () => {
  // Two polygons that differ only in their first point; a later coordinate's getter keys a fresh rectangle.
  const poly = (x: number): Geom => {
    const last: [number, number] = [0, 0];
    Object.defineProperty(last, 1, { get: () => (geomKey({ kind: "rect", x: 0, y: 0, w: 1, h: 1 }), 2) });
    return { kind: "poly", points: [[x, 0], [5, 5], last], closed: true };
  };
  const plain = (x: number): Geom => ({ kind: "poly", points: [[x, 0], [5, 5], [0, 2]], closed: true });
  assert.notEqual(geomKey(poly(10)), geomKey(poly(20)));
  assert.equal(geomKey(poly(10)), geomKey(plain(10)));
  const gesture = (pressure: number): Gesture => {
    const g: Gesture = { pressure };
    Object.defineProperty(g, "seed", { enumerable: true, get: () => (gestureKey({ pressure: [[0, 1]] }), 3) });
    return g;
  };
  assert.notEqual(gestureKey(gesture(0.25)), gestureKey(gesture(0.75)));
  assert.equal(gestureKey(gesture(0.25)), gestureKey({ pressure: 0.25, seed: 3 }));
});
