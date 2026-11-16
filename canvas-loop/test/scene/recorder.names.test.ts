// Names on drawings (plan:canvas-loop-layout-text-hits.subplan, chunk B1):
// `name` on a style, text, at, group, place and flow options is kept on the
// node, not in the resolved style, and survives the resolve walk. A bad name
// throws at the call; scope and placement options refuse unknown keys, and a
// `hit` key is told that every name is a target.
import assert from "node:assert/strict";
import { before, test } from "node:test";
import { SketchUsageError } from "../../src/core/errors.js";
import type { Drawing, View } from "../../src/core/tea.js";
import type { TextMeasurer } from "../../src/core/text/measure.js";
import { openTextMeasurer } from "../../src/device/open.js";
import type { SceneNode } from "../../src/scene/nodes.js";
import { SceneRecorder } from "../../src/scene/recorder/view.js";

let text: TextMeasurer | undefined;
before(async () => {
  text = await openTextMeasurer();
});

function nodes(draw: (v: View) => Drawing): readonly SceneNode[] {
  if (text === undefined) throw new Error("no text measurer");
  return new SceneRecorder({ width: 300, height: 200 }, { text }).record(draw).scene.children;
}

function nameOf(n: SceneNode | undefined): string | undefined {
  return n !== undefined && (n.kind === "shape" || n.kind === "text" || n.kind === "at" || n.kind === "group" || n.kind === "place") ? n.name : undefined;
}

const usage = (re: RegExp) => (e: unknown): boolean => e instanceof SketchUsageError && re.test(e.message);

test("each call keeps its name on the node, and the style keeps none", () => {
  const got = nodes((v) => {
    const pic = v.picture({ key: "p", width: 10, height: 10 }, () => v.rect(0, 0, 10, 10, { fill: "#000" }));
    return [
      v.rect(0, 0, 10, 10, { fill: "#000", name: "box" }),
      v.text("Hi", { x: 10, y: 10 }, { name: "hi" }),
      v.at({ translate: [5, 5], name: "moved" }, []),
      v.group({ name: "tray" }, []),
      v.place(pic, 20, 20, { name: "card" }),
      v.row({ gap: 4, name: "tally" }, [v.rect(0, 0, 4, 4, { fill: "#000" })]),
      v.circle(0, 0, 4, { fill: "#000" }),
    ];
  });
  assert.deepEqual(got.map(nameOf), ["box", "hi", "moved", "tray", "card", "tally", undefined]);
  const shape = got[0];
  assert.ok(shape?.kind === "shape" && !("name" in shape.style), "the resolved style has no name");
});

test("the resolve walk keeps names: a container copied for its children, and keepInside text laid out again", () => {
  const [at] = nodes((v) => v.at({ translate: [290, 10], name: "corner" }, v.text("A long label", { x: 0, y: 0 }, { keepInside: true, name: "label" })));
  assert.ok(at?.kind === "at");
  const inner = at.children[0];
  assert.equal(at.name, "corner");
  assert.ok(inner?.kind === "text");
  assert.ok(inner.box.x < 0, `laid out again inside the canvas: ${inner.box.x}`);
  assert.equal(inner.name, "label");
});

test("a name that is empty or not a string throws at the call, naming it", () => {
  const bad = (draw: (v: View) => unknown, re: RegExp): void => {
    assert.throws(() => nodes((v) => {
      draw(v);
      return null;
    }), usage(re));
  };
  const nameless = { name: "" };
  // Passed through a variable, past the types, as a sketch can.
  const numbered: object = { name: 5 };
  bad((v) => v.rect(0, 0, 1, 1, { fill: "#000", name: "" }), /rect: name must be a non-empty string \(got ""\)/);
  bad((v) => v.text("x", { x: 0, y: 0 }, numbered), /text: name must be a non-empty string \(got number\)/);
  bad((v) => v.at(nameless, []), /at: name must be a non-empty string/);
  bad((v) => v.group(nameless, []), /group: name must be a non-empty string/);
  bad((v) => v.column(numbered, []), /column: name must be a non-empty string/);
  bad((v) => v.place(v.picture({ key: "p", width: 1, height: 1 }, () => null), 0, 0, nameless), /place: name must be a non-empty string/);
});

test("group, at, place and style refuse unknown keys; hit: true is told every name is a target", () => {
  const hit: object = { hit: true };
  const rotation: object = { rotation: 1 };
  const cases: [(v: View) => unknown, RegExp][] = [
    [(v) => v.group(hit, []), /group: unknown option "hit" \(name, opacity, blend, effects, lighting, clip\); there is no hit flag: every name is a target/],
    [(v) => v.at(hit, []), /at: unknown option "hit" \(name, .*\); there is no hit flag/],
    [(v) => v.place(v.picture({ key: "p", width: 1, height: 1 }, () => null), 0, 0, hit), /place: unknown option "hit" \(name, material, opacity, blend, erase\); there is no hit flag/],
    [(v) => v.rect(0, 0, 1, 1, hit), /rect: unknown style key "hit" .*; there is no hit flag/],
    [(v) => v.at(rotation, []), /at: unknown option "rotation"/],
  ];
  for (const [draw, re] of cases) {
    assert.throws(() => nodes((v) => {
      draw(v);
      return null;
    }), usage(re));
  }
});
