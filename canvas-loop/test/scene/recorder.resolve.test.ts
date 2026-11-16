// The resolve walk (returned-scene plan, chunk R1): the checks that need a
// node's ancestors run after `draw` returns, or after a picture body records.
// Warnings still name the line of the call that made the node (testing mode
// keeps each node's stack), an effects-scale error names the node path, a
// `draw` that throws gives no walk warnings, and `keepInside` text is laid
// out under its transform and inside its box.
import assert from "node:assert/strict";
import { before, test } from "node:test";
import type { TextBounds } from "../../src/core/paint.js";
import type { View } from "../../src/core/tea.js";
import type { TextMeasurer } from "../../src/core/text/measure.js";
import { openTextMeasurer } from "../../src/device/open.js";
import { sketchFrames } from "../../src/scene/call-site.js";
import { UnsupportedCallError } from "../../src/scene/errors.js";
import type { SceneNode, TextNode } from "../../src/scene/nodes.js";
import { SceneRecorder } from "../../src/scene/recorder/view.js";

let text: TextMeasurer | undefined;
before(async () => {
  text = await openTextMeasurer();
});

/** The line of this file the caller is on. */
function here(): number {
  const m = /recorder\.resolve\.test\.ts:(\d+):\d+/.exec(new Error("here").stack?.split("\n")[2] ?? "");
  return Number(m?.[1]);
}
/** The line of this file a message ends by naming. */
const lineIn = (message: string | undefined): number => Number(/\(at test\/scene\/recorder\.resolve\.test\.ts:(\d+):\d+\)$/.exec(message ?? "")?.[1]);

function testing(size?: { width: number; height: number }): SceneRecorder {
  return new SceneRecorder(size ?? { width: 100, height: 80 }, { audit: true, ...(text === undefined ? {} : { text }) });
}

test("light warnings found after draw name the line of the call that made the node", () => {
  let light = 0;
  let group = 0;
  let place = 0;
  const { warnings } = testing().record((v) => {
    v.light({ kind: "point", at: [1, 2] }); light = here();
    v.group({ name: "room", lighting: {} }, () => v.rect(0, 0, 10, 10, { fill: "#888" })); group = here();
    const lamp = v.picture({ key: "lamp", width: 10, height: 10 }, () => v.light({ kind: "point", at: [5, 5] }));
    v.place(lamp, 0, 0); place = here();
  });
  assert.equal(warnings.length, 3, warnings.join("\n"));
  const [l, g, p] = warnings;
  assert.match(l ?? "", /^light point at \(1,2\) is outside any lit group and does nothing/);
  assert.equal(lineIn(l), light);
  assert.match(g ?? "", /^lit group "room" has no light inside it/);
  assert.equal(lineIn(g), group);
  assert.match(p ?? "", /^place picture "lamp": its light is outside any lit group/);
  assert.equal(lineIn(p), place);
});

test("effects under a skew are refused after draw, naming the node path; in testing mode its stack is the call's", () => {
  let line = 0;
  const draw = (v: View): void => {
    v.rect(0, 0, 1, 1, { fill: "#000" });
    v.at({ skew: [0.4, 0] }, () => {
      v.clip([[0, 0], [5, 0], [5, 5]], () => {
        v.circle(0, 0, 1, { fill: "#000" });
        v.group({ name: "g", effects: { blur: 2 } }, () => v.rect(0, 0, 1, 1, { fill: "#000" })); line = here();
      });
    });
  };
  const refused = (sited: boolean) => (e: unknown): boolean => {
    assert.ok(e instanceof UnsupportedCallError, String(e));
    assert.equal(e.call, "group effects under a rotated non-uniform scale or a skew");
    const path = '(effects follow axis-aligned scales and rotations with a uniform scale only) in at #2 > clip #1 > group "g"';
    assert.ok(e.message.endsWith(path), e.message);
    const first = sketchFrames(e.stack)[0];
    if (sited) assert.equal(Number(/recorder\.resolve\.test\.ts:(\d+):\d+$/.exec(first ?? "")?.[1]), line, String(e.stack));
    else assert.ok(first === undefined || !first.includes("recorder.resolve.test.ts"), String(e.stack));
    return true;
  };
  assert.throws(() => testing().record(draw), refused(true));
  assert.throws(() => new SceneRecorder({ width: 100, height: 80 }).record(draw), refused(false), "no line outside testing mode");
  assert.throws(
    () => testing().record((v) => v.at({ skew: [0.4, 0] }, () => v.rect(0, 0, 1, 1, { fill: "#000", effects: { blur: 1 } }))),
    (e: unknown) => e instanceof UnsupportedCallError && e.call === "rect effects under a rotated non-uniform scale or a skew" && e.message.endsWith(" in at #1 > rect #1"),
  );
});

test("a draw that throws gives its error and none of the walk's warnings", () => {
  const notes: string[] = [];
  const rec = new SceneRecorder({ width: 100, height: 80 }, { audit: true, onNote: (n) => notes.push(`${n.kind}: ${n.message}`) });
  assert.throws(() => rec.record((v) => {
    v.light({ kind: "point", at: [1, 2] });
    throw new Error("the sketch's own bug");
  }), /the sketch's own bug/);
  assert.deepEqual(notes, []);
  // The next frame that returns warns.
  assert.equal(rec.record((v) => v.light({ kind: "point", at: [1, 2] })).warnings.length, 1);
});

/** The scene's text nodes, in draw order, through `at` and `clip` scopes. */
function textsOf(nodes: readonly SceneNode[]): TextNode[] {
  return nodes.flatMap((n) => (n.kind === "text" ? [n] : n.kind === "at" || n.kind === "clip" || n.kind === "group" ? textsOf(n.children) : []));
}

test("keepInside text is laid out by the walk under its transform; v.text returns where it lands", () => {
  const options = { size: 16, keepInside: true } as const;
  let returned: TextBounds | undefined;
  let measured: TextBounds | undefined;
  const { scene } = testing({ width: 200, height: 100 }).record((v) => {
    v.at({ translate: [150, 0], scale: 2 }, () => {
      measured = v.textBounds("Label", { x: 20, y: 25 }, options);
      returned = v.text("Label", { x: 20, y: 25 }, options);
    });
  });
  assert.ok(returned !== undefined && measured !== undefined);
  assert.deepEqual(returned, measured);
  // In local units the right edge sits at (200 - 4 - 150) / 2.
  assert.ok(Math.abs(returned.x + returned.w - 23) < 0.01, `right edge: ${returned.x + returned.w}`);
  const [node] = textsOf(scene.children);
  assert.ok(node !== undefined);
  assert.ok(Math.abs((node.lines[0]?.xs[0] ?? Number.NaN) - returned.x) < 0.01, `the drawn label starts where v.text said: ${node.lines[0]?.xs[0]} vs ${returned.x}`);
});

test("keepInside text in a picture body keeps inside the picture's box; changing the options after the call moves nothing", () => {
  const options: { size: number; keepInside: true } = { size: 12, keepInside: true };
  const { scene } = testing({ width: 200, height: 100 }).record((v) => {
    const card = v.picture({ key: "card", width: 60, height: 30 }, () => {
      v.text("Off the edge", { x: 55, y: 0 }, options);
      options.size = 40;
    });
    v.place(card, 0, 0);
  });
  const placed = scene.children[0];
  assert.ok(placed?.kind === "place" && placed.picture.kind === "picture");
  const [node] = textsOf(placed.picture.children);
  assert.ok(node !== undefined);
  assert.equal(node.size, 12, "laid out with the options as they were at the call");
  assert.ok((node.lines[0]?.xs[0] ?? Number.NaN) < 55 - 20, `slid back inside the 60 px box: ${node.lines[0]?.xs[0]}`);
});
