// isSimpleRing: the sweep agrees with comparing every pair of non-adjacent edges.
import assert from "node:assert/strict";
import { test } from "node:test";
import { isSimpleRing } from "../../src/gpu/rings.js";
import { SeededRandom } from "../../src/core/prng.js";

const sign = (...[ax, ay, bx, by, cx, cy]: readonly [number, number, number, number, number, number]): number => Math.sign((bx - ax) * (cy - ay) - (by - ay) * (cx - ax));

/** Every pair of non-adjacent edges, after dropping repeated points: the definition the sweep must match. */
function simpleByPairs(ring: readonly number[]): boolean {
  const r: number[] = [];
  for (let i = 0; i + 1 < ring.length; i += 2) if (r.length === 0 || ring[i] !== r.at(-2) || ring[i + 1] !== r.at(-1)) r.push(ring[i] ?? 0, ring[i + 1] ?? 0);
  while (r.length >= 4 && r[0] === r.at(-2) && r[1] === r.at(-1)) r.splice(-2);
  const n = r.length / 2;
  if (n < 3) return false;
  const p = (i: number): [number, number] => [r[2 * (i % n)] ?? 0, r[2 * (i % n) + 1] ?? 0];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j - i === 1 || j - i === n - 1) continue;
      const [a, b, c, d] = [p(i), p(i + 1), p(j), p(j + 1)];
      if (Math.max(a[0], b[0]) < Math.min(c[0], d[0]) || Math.max(c[0], d[0]) < Math.min(a[0], b[0])) continue;
      if (Math.max(a[1], b[1]) < Math.min(c[1], d[1]) || Math.max(c[1], d[1]) < Math.min(a[1], b[1])) continue;
      const o = [sign(...a, ...b, ...c), sign(...a, ...b, ...d), sign(...c, ...d, ...a), sign(...c, ...d, ...b)];
      if ((o[0] !== o[1] && o[2] !== o[3]) || o.includes(0)) return false;
    }
  }
  return true;
}

test("simple and non-simple rings", () => {
  assert.equal(isSimpleRing([0, 0, 10, 0, 10, 10, 0, 10]), true);
  assert.equal(isSimpleRing([0, 0, 10, 0, 10, 10, 0, 10, 0, 0]), true, "a closing point equal to the first is dropped");
  assert.equal(isSimpleRing([0, 0, 10, 10, 10, 0, 0, 10]), false, "a bowtie crosses");
  assert.equal(isSimpleRing([0, 0, 10, 0, 5, 5, 10, 10, 0, 10, 5, 5]), false, "a figure eight touches at a point");
  assert.equal(isSimpleRing([0, 0, 10, 0]), false, "two points");
});

test("the sweep agrees with every pair: smooth, jittered, grid-snapped (equal ys, collinear edges) and wavy rings", () => {
  const rnd = new SeededRandom(7);
  let simple = 0;
  for (let k = 0; k < 800; k++) {
    const n = 3 + Math.floor(rnd.next() * 40);
    const ring: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * i) / n + (k % 3 === 0 ? rnd.next() * 2 : 0);
      const rad = 5 + rnd.next() * (k % 5 === 2 ? 0.5 : 5);
      const wave = k % 7 === 3 ? Math.sin(a * 9) * 4 : 0;
      const grid = k % 4 === 1;
      ring.push(grid ? Math.round(rnd.next() * 4) : Math.cos(a) * rad, grid ? Math.round(rnd.next() * 4) : Math.sin(a) * rad * 3 + wave);
    }
    if (simpleByPairs(ring)) simple++;
    assert.equal(isSimpleRing(ring), simpleByPairs(ring), `ring ${k}: ${ring.join(",")}`);
  }
  assert.ok(simple > 200 && simple < 700, `both outcomes are exercised (${simple} simple)`);
});

test("a ring with a non-finite coordinate is judged as by the comparison sweep", () => {
  assert.equal(isSimpleRing([0, 0, 10, 0, 10, Infinity, 0, 10]), simpleByPairs([0, 0, 10, 0, 10, Infinity, 0, 10]));
});
