// Over-canvas inputs: `v.control` in draw places a param's native input on
// the figure's stage, and the panel leaves it out.
import assert from "node:assert/strict";
import { test } from "node:test";
import { mountSketch } from "@ianbicking/canvas-loop/browser";
import type { View } from "@ianbicking/canvas-loop";
import { FakeElement, asHTMLElement, runFrames } from "./fake-dom.js";

function placingModule(place: { on: boolean }): Record<string, unknown> {
  return {
    params: {
      count: { type: "number", min: 1, max: 9, default: 3, control: "field" },
      hidden: { type: "number", min: 0, max: 1, default: 0, panel: false },
      speed: { type: "number", min: 0, max: 5, default: 1 },
    },
    canvas: { width: 200, height: 100 },
    init: () => ({}),
    // A new model each tick, so each frame draws: this draw reads `place`, outside the model.
    update: (model: object) => ({ ...model }),
    draw: (v: View) => {
      if (place.on) v.control("count", { x: 50, y: 25, w: 40, h: 20, size: 18 });
    },
  };
}

test("a placed param's input sits on the stage at its box and leaves the panel", () => {
  const mount = new FakeElement("div");
  const place = { on: true };
  const teardown = mountSketch(asHTMLElement(mount), { module: placingModule(place) });
  const stage = mount.find((el) => el.className === "cl-stage");
  assert.ok(stage !== null);
  const input = stage.find((el) => el.className.includes("cl-overlay-input"));
  assert.ok(input !== null, "the input is on the stage");
  assert.deepEqual([input.type, input.value], ["number", "3"]);
  assert.deepEqual([input.style["left"], input.style["top"], input.style["width"], input.style["height"]], ["25%", "25%", "20%", "20%"]);
  assert.equal(input.style["fontSize"], "18px");
  assert.equal(input.attributes.get("aria-label"), "count");
  const panel = mount.find((el) => el.className === "cl-params");
  assert.ok(panel !== null);
  assert.equal(panel.find((el) => el.type === "number"), null, "the placed field left the panel");
  assert.equal(panel.children.length, 1, "only speed stays: hidden is panel:false");

  place.on = false;
  runFrames(2);
  assert.equal(input.style["display"], "none", "an input not placed this frame hides");
  const rebuilt = mount.find((el) => el.className === "cl-params");
  assert.ok(rebuilt?.find((el) => el.type === "number") !== null, "the unplaced field is back in the panel");
  teardown();
  assert.equal(stage.find((el) => el.className.includes("cl-overlay-input")), null, "teardown removes it");
});

test("showing the param's value clears a stale invalid mark", () => {
  const mount = new FakeElement("div");
  const teardown = mountSketch(asHTMLElement(mount), { module: placingModule({ on: true }) });
  const input = mount.find((el) => el.className.includes("cl-overlay-input"));
  assert.ok(input !== null);
  input.value = "99";
  for (const fn of input.listeners.get("input") ?? []) fn({});
  assert.equal(input.attributes.get("aria-invalid"), "true");
  runFrames(3);
  assert.equal(input.value, "3", "the model's value is shown again");
  assert.equal(input.attributes.has("aria-invalid"), false);
  teardown();
});
