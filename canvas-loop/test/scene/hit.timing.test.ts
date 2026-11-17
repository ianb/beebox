// The hit walk's cost on a large scene (plan:canvas-loop-layout-text-hits.subplan,
// chunk B2): a `mousemove` hit-tests every time, so a 2,000-node scene must
// take under 1 ms. The worst case is a point that misses every named node, so
// the walk tests them all. The time is the median of 21 walks, after 5 to warm
// up, so one slow walk (a GC pause, a busy machine) does not fail the test.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Drawing, View } from "../../src/core/tea.js";
import { openTextMeasurer } from "../../src/device/open.js";
import { hitTest } from "../../src/scene/hit.js";
import { SceneRecorder } from "../../src/scene/recorder/view.js";

/** 2,000 named nodes in 40 named rows: circles, rects, labels, stroked open paths and filled bezier paths, each row under its own `at`. */
function big(v: View): Drawing {
  return Array.from({ length: 40 }, (_, row) =>
    v.at({ translate: [0, row * 10], name: `row-${row}` }, Array.from({ length: 49 }, (__, i) => {
      const x = 20 + i * 12;
      const name = `n-${row}-${i}`;
      switch (i % 5) {
        case 0:
          return v.circle(x, 0, 4, { fill: "#888", name });
        case 1:
          return v.rect(x, -4, 8, 8, { fill: "#888", stroke: "#000", weight: 1, name });
        case 2:
          return v.text("ab", { x, y: -4 }, { size: 8, name });
        case 3:
          return v.path([["move", x, -4], ["line", x + 4, 4], ["line", x + 8, -4]], { stroke: "#000", weight: 2, name });
        default:
          return v.path([["move", x, 0], ["bezier", x + 2, -6, x + 6, 6, x + 8, 0]], { fill: "#888", name });
      }
    })),
  );
}

test("a 2,000-node scene: a hit walk that tests every node takes under 1 ms (median of 21)", async (t) => {
  const text = await openTextMeasurer();
  const { scene } = new SceneRecorder({ width: 640, height: 420 }, { text }).record(big);
  const miss: [number, number] = [630, 410];
  assert.deepEqual(hitTest(scene, miss).targets, [], "the point misses every node");
  assert.deepEqual(hitTest(scene, [20, 0]).targets, ["n-0-0", "row-0"]);
  for (let i = 0; i < 5; i++) hitTest(scene, miss);
  const times = Array.from({ length: 21 }, () => {
    const t0 = performance.now();
    hitTest(scene, miss);
    return performance.now() - t0;
  }).toSorted((a, b) => a - b);
  const median = times[10] ?? Infinity;
  t.diagnostic(`median ${median.toFixed(3)} ms`);
  assert.ok(median < 1, `median ${median.toFixed(3)} ms (fastest ${times[0]?.toFixed(3)}, slowest ${times[20]?.toFixed(3)})`);
});
