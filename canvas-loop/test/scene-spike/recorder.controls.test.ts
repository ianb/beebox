// `v.control` in the spike (draft section 8, decision 9): placements are a
// kept output beside the scene, in call order and canvas coordinates; headless
// stand-ins are separate top-level nodes drawn above the scene.
import assert from "node:assert/strict";
import { test } from "node:test";
import { SketchUsageError } from "../../src/core/errors.js";
import type { ParamsDecl } from "../../src/core/tea.js";
import { openTextMeasurer } from "../../src/scene-spike/device.js";
import { SceneRecorder } from "../../src/scene-spike/recorder/view.js";

const decl = {
  reaction: { type: "select", options: ["water", "rust"], default: "water" },
  c1: { type: "number", min: 1, max: 12, default: 1 },
} as const satisfies ParamsDecl;

async function recorder(values: () => Record<string, number | string>): Promise<SceneRecorder> {
  return new SceneRecorder({ width: 200, height: 100 }, { text: await openTextMeasurer(), params: { decl, values } });
}

test("controls are kept in call order with their values, and stand-ins sit above the scene, outside any group", async () => {
  let c1 = 3;
  const rec = (await recorder(() => ({ reaction: "rust", c1 }))).record((v) => {
    v.at({ translate: [50, 10] }, () => {
      v.group({ opacity: 0.5 }, () => {
        v.rect(0, 0, 10, 10, { fill: "#000" });
        v.control("c1", { x: 20, y: 30, w: 40, h: 24 });
      });
    });
    v.control("reaction", { x: 100, y: 0, w: 90 });
  });
  c1 = 7;
  assert.deepEqual(rec.controls.map((c) => [c.name, c.box.x, c.box.y]), [["c1", 20, 30], ["reaction", 100, 0]]);
  const [first, second] = rec.controls;
  assert.ok(first?.model.kind === "number" && second?.model.kind === "select");
  assert.equal(first.model.value, 3, "the value as it was at the call");
  assert.equal(second.model.value, "rust");
  // The scene holds only the sketch's drawing; the group has its rect and nothing else.
  const at = rec.scene.children[0];
  assert.ok(at?.kind === "at" && at.children[0]?.kind === "group");
  assert.equal(at.children[0].children.length, 1);
  // Stand-ins: per control a field, then (for a select) its arrow, then its text, at the canvas boxes.
  assert.deepEqual(rec.standIns.map((n) => n.kind), ["shape", "text", "shape", "shape", "text"]);
  assert.deepEqual(rec.debugBoxes.map((b) => [b.label, b.corners[0]]), [["control c1", [20, 30]], ["control reaction", [100, 0]]]);
});

test("a control inside a picture body, or for an undeclared param, is an error", async () => {
  const r = await recorder(() => ({ reaction: "water", c1: 1 }));
  assert.throws(() => r.record((v) => v.picture({ key: "p", width: 10, height: 10 }, () => v.control("c1", { x: 0, y: 0, w: 10 }))), SketchUsageError);
  assert.throws(() => r.record((v) => v.control("c9", { x: 0, y: 0, w: 10 })), /no param named "c9"/);
  const bare = new SceneRecorder({ width: 10, height: 10 });
  assert.throws(() => bare.record((v) => v.control("c1", { x: 0, y: 0, w: 10 })), /no param named "c1"/);
});
