// `v.control` in the scene recorder (draft section 8, decision 9): placements are a
// kept output beside the scene, in call order and canvas coordinates; headless
// stand-ins are separate top-level nodes drawn above the scene.
import assert from "node:assert/strict";
import { test } from "node:test";
import { SketchUsageError } from "../../src/core/errors.js";
import type { Drawing, ParamsDecl } from "../../src/core/tea.js";
import { openTextMeasurer } from "../../src/device/open.js";
import { SceneRecorder } from "../../src/scene/recorder/view.js";

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
    const out: Drawing[] = [];
    out.push(v.at({ translate: [50, 10] }, [
      v.group({ opacity: 0.5 }, ((): Drawing => {
        const drawn: Drawing[] = [];
        drawn.push(v.rect(0, 0, 10, 10, { fill: "#000" }));
        v.control("c1", { x: 20, y: 30, w: 40, h: 24 });
        return drawn;
      })()),
    ]));
    v.control("reaction", { x: 100, y: 0, w: 90 });
    return out;
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
  // Stand-ins: the slider's track, filled part, thumb and value; the select's field, arrow and text.
  assert.deepEqual(rec.standIns.map((n) => n.kind), ["shape", "shape", "shape", "text", "shape", "shape", "text"]);
  assert.deepEqual(rec.debugBoxes.map((b) => [b.label, b.corners[0]]), [["control c1", [20, 30]], ["control reaction", [100, 0]]]);
});

test("a control inside a picture body, or for an undeclared param, is an error", async () => {
  const r = await recorder(() => ({ reaction: "water", c1: 1 }));
  assert.throws(
    () =>
      r.record((v) => {
        v.picture({ key: "p", width: 10, height: 10 }, () => {
          v.control("c1", { x: 0, y: 0, w: 10 });
          return null;
        });
        return null;
      }),
    SketchUsageError,
  );
  assert.throws(() => r.record((v) => v.control("c9", { x: 0, y: 0, w: 10 })), /no param named "c9"/);
  const bare = new SceneRecorder({ width: 10, height: 10 });
  assert.throws(() => bare.record((v) => v.control("c1", { x: 0, y: 0, w: 10 })), /no param named "c1"/);
});

test("a stand-in is the bare input, as the browser shows it: a slider's track, thumb and value, a field's value, a checkbox, no param labels", async () => {
  const sliders = { ...decl, c2: { type: "number", min: 0, max: 10, default: 2.5, label: "length", control: "field" }, on: { type: "boolean", default: true, label: "Show" } } as const satisfies ParamsDecl;
  const r = new SceneRecorder({ width: 400, height: 140 }, { text: await openTextMeasurer(), params: { decl: sliders, values: () => ({ reaction: "water", c1: 4, c2: 2.5, on: true }) } });
  const rec = r.record((v) => {
    v.control("c1", { x: 10, y: 10, w: 300, h: 24 });
    v.control("c2", { x: 10, y: 50, w: 300, h: 24 });
    v.control("on", { x: 10, y: 90, w: 300, h: 24 });
    return null;
  });
  const texts = rec.standIns.flatMap((n) => (n.kind === "text" ? [n.content] : []));
  assert.deepEqual(texts, ["4", "2.5"], "values only: no param label, and none beside the checkbox");
  // The checkbox: its box and its tick, nothing else.
  assert.deepEqual(rec.standIns.slice(-2).map((n) => n.kind), ["shape", "shape"]);
  const [track, , thumb] = rec.standIns;
  assert.ok(track?.kind === "shape" && track.geom.kind === "path" && thumb?.kind === "shape" && thumb.geom.kind === "ellipse");
  // The thumb sits (4 - 1) / (12 - 1) of the way along the track.
  const xs = track.geom.commands.flatMap((c) => (c[0] === "move" || c[0] === "line" ? [c[1]] : []));
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  assert.ok(Math.abs(thumb.geom.x - (x0 + ((4 - 1) / 11) * (x1 - x0))) < 0.01, `thumb at ${thumb.geom.x}, track ${x0}..${x1}`);
});
