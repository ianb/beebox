// What new picture versions cost, by key (picture-costs.ts), and the
// recorder's list of the versions each frame recorded.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { View } from "../../src/core/tea.js";
import { PictureCosts, costLine } from "../../src/scene/picture-costs.js";
import { SceneRecorder } from "../../src/scene/recorder/view.js";

test("costs add up by key, costliest first, and start again after each take", () => {
  const costs = new PictureCosts();
  costs.recorded([{ key: "leaf", ms: 4 }, { key: "wood", ms: 1 }, { key: "leaf", ms: 2 }]);
  costs.lowered([{ key: "wood", tiles: 3, ms: 9 }]);
  const taken = costs.take();
  assert.deepEqual(taken, [
    { key: "wood", versions: 1, recordMs: 1, tiles: 3, rasterMs: 9 },
    { key: "leaf", versions: 2, recordMs: 6, tiles: 0, rasterMs: 0 },
  ]);
  assert.equal(costLine(taken, 1), "wood: 1 version (1.0 ms), 3 tiles (9.0 ms); 1 more keys");
  assert.deepEqual(costs.take(), []);
  assert.equal(costLine([]), undefined);
});

test("a frame's record lists the new versions it recorded, not the kept ones or testing-mode re-records", () => {
  const rec = new SceneRecorder({ width: 50, height: 50 }, { audit: true });
  const draw = (level: number) => (v: View) => [1, 2].map((k) => v.place(v.picture({ key: `tree-${k}`, width: 10, height: 10, deps: [level] }, () => v.rect(0, 0, level, level, { fill: "#2a9d8f" })), 0, 0));
  assert.deepEqual(rec.record(draw(1)).pictures.map((p) => p.key), ["tree-1", "tree-2"]);
  assert.deepEqual(rec.record(draw(1)).pictures, [], "kept versions (compared again in testing mode) are not new");
  assert.deepEqual(rec.record(draw(2)).pictures.map((p) => p.key), ["tree-1", "tree-2"]);
});
