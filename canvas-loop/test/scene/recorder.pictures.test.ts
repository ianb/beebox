// Picture versions in the recorder (draft section 5): keyed by key, size and
// deep-equal plain-data deps; the testing-mode audit; eviction; `pixels`;
// what a picture body may not do (section 8).
import assert from "node:assert/strict";
import { test } from "node:test";
import { SketchUsageError } from "../../src/core/errors.js";
import type { View } from "../../src/scene/api.js";
import { sceneOutline } from "../../src/scene/outline.js";
import { SceneRecorder } from "../../src/scene/recorder/view.js";

const usage = (message: RegExp) => (e: unknown): boolean => e instanceof SketchUsageError && message.test(e.message);

test("a version is recorded once per key, size and deps; deps compare by value", () => {
  const rec = new SceneRecorder({ width: 100, height: 80 });
  let runs = 0;
  const pic = (v: View, at: { deps: readonly unknown[]; width?: number }): void => {
    v.place(v.picture({ key: "card", width: at.width ?? 20, height: 10, deps: at.deps }, () => {
      runs++;
      v.rect(0, 0, 5, 5, { fill: "#000" });
    }), 0, 0);
  };
  rec.record((v) => pic(v, { deps: [1, { look: "a" }] }));
  rec.record((v) => pic(v, { deps: [1, { look: "a" }] }));
  assert.equal(runs, 1, "equal deps (a new but equal object) reuse the version");
  rec.record((v) => {
    pic(v, { deps: [1, { look: "b" }] });
    pic(v, { deps: [1, { look: "a" }] });
    pic(v, { deps: [1, { look: "a" }], width: 30 });
  });
  assert.equal(runs, 3, "other deps and another size are new versions; two versions of one key live at once");
});

test("deps must be plain data: a function, a class instance or a cycle is an error naming it", () => {
  const rec = new SceneRecorder({ width: 10, height: 10 });
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  for (const [deps, message] of [[[{ f: () => 1 }], /deps\[0]\.f is a function/], [[new Map()], /deps\[0] is a Map instance/], [[cyclic], /deps\[0]\.self refers back to itself/]] as const) {
    assert.throws(() => rec.record((v) => v.picture({ key: "k", width: 1, height: 1, deps }, () => {})), usage(message));
  }
});

test("testing mode records each version again and warns when the body draws differently with the same deps", () => {
  const rec = new SceneRecorder({ width: 100, height: 80 }, { audit: true });
  const draw = (color: string) => (v: View): void => {
    v.place(v.picture({ key: "card", width: 20, height: 10, deps: [1] }, () => {
      v.rect(0, 0, 5, 5, { fill: "#000" });
      v.group({ name: "face" }, () => v.circle(2, 2, 1, { fill: color }));
    }), 0, 0);
  };
  assert.deepEqual(rec.record(draw("red")).warnings, []);
  assert.deepEqual(rec.record(draw("red")).warnings, [], "the same drawing does not warn");
  const [warning] = rec.record(draw("blue")).warnings;
  assert.match(warning ?? "", /picture "card" \[1] drew differently from its kept version with the same key and deps \[1]/);
  assert.match(warning ?? "", /first difference at picture "card" \[1] > group #2 > circle #1/);
});

test("a version not asked for in two frames is dropped and recorded again", () => {
  const rec = new SceneRecorder({ width: 10, height: 10 });
  let runs = 0;
  const ask = (v: View): void => void v.picture({ key: "k", width: 1, height: 1 }, () => void runs++);
  rec.record(ask);
  rec.record(() => {});
  rec.record(ask);
  assert.equal(runs, 1, "kept across one frame without it");
  for (let i = 0; i < 3; i++) rec.record(() => {});
  rec.record(ask);
  assert.equal(runs, 2);
});

test("a picture body has its own coordinates and box; it may not log, snapshot, set the cursor or ask for canvas coordinates", () => {
  const rec = new SceneRecorder({ width: 100, height: 80 });
  let inside: [number, number] = [0, 0];
  rec.record((v) => v.at({ translate: [10, 10] }, () => v.picture({ key: "k", width: 30, height: 20 }, () => {
    inside = [v.width, v.height];
  })));
  assert.deepEqual(inside, [30, 20]);
  const cases: [string, (v: View) => void][] = [["log", (v) => v.log("x")], ["snapshot", (v) => v.snapshot()], ["cursor", (v) => v.cursor("grab")], ["toCanvas", (v) => void v.toCanvas([0, 0])]];
  for (const [call, body] of cases) {
    const said = (e: unknown): boolean => e instanceof SketchUsageError && e.message.includes(`v.${call} inside the body of picture "${call}"`);
    assert.throws(() => rec.record((v) => v.picture({ key: call, width: 1, height: 1 }, () => body(v))), said, call);
  }
});

test("pixels fill once per version; a fully transparent fill warns in testing mode", () => {
  const rec = new SceneRecorder({ width: 10, height: 10 }, { audit: true });
  let fills = 0;
  const draw = (alpha: number) => (v: View): void => v.place(v.pixels({ key: "img", width: 2, height: 2, deps: [alpha] }, (im) => {
    fills++;
    for (let i = 3; i < im.data.length; i += 4) im.data[i] = alpha;
  }), 0, 0);
  const first = rec.record(draw(255));
  assert.deepEqual(first.warnings, []);
  const node = first.scene.children[0];
  assert.ok(node?.kind === "place" && node.picture.kind === "pixels");
  assert.equal(node.picture.data.length, 16);
  rec.record(draw(255));
  assert.equal(fills, 2, "filled when new, and again in the next frame to compare (testing mode)");
  assert.match(rec.record(draw(0)).warnings[0] ?? "", /pixels "img" \[0]: the fill left every pixel transparent/);
  assert.throws(() => rec.record((v) => v.pixels({ key: "bad", width: 1.5, height: 2 }, () => {})), usage(/a whole number of pixels/));
});

test("place checks its picture and options; the outline lists each placed version once", () => {
  const rec = new SceneRecorder({ width: 100, height: 80 });
  assert.throws(() => rec.record((v) => v.place({ width: 1, height: 1, get pictureBrand(): never { throw new Error("brand"); } }, 0, 0)), usage(/must come from v.picture or v.pixels/));
  assert.throws(() => rec.record((v) => v.place(v.picture({ key: "k", width: 1, height: 1 }, () => {}), 0, 0, { opacity: 2 })), /place opacity must be a number in 0..1/);
  const scene = rec.record((v) => {
    const p = v.picture({ key: "dot", width: 4, height: 4, deps: ["a"] }, () => v.circle(2, 2, 2, { fill: "#000" }));
    v.place(p, 1, 2);
    v.place(p, 5, 6, { blend: "multiply", opacity: 0.5 });
  }).scene;
  assert.equal(sceneOutline(scene), [
    "scene 100×80",
    '  place picture "dot" ["a"] at (1,2) opacity 1 blend normal',
    '  place picture "dot" ["a"] at (5,6) opacity 0.5 blend multiply',
    'picture "dot" ["a"] 4×4',
    "  circle (2,2) r 2×2 fill #000 stroke none",
  ].join("\n"));
});

test("a debug box inside a picture belongs to its recording and moves with each placement", () => {
  const rec = new SceneRecorder({ width: 100, height: 80 });
  const draw = (v: View): void => {
    const p = v.picture({ key: "boxed", width: 10, height: 10 }, () => v.debugBox("hit", 1, 2, 3, 4));
    v.place(p, 10, 0);
    v.at({ translate: [0, 50] }, () => v.place(p, 20, 0));
  };
  for (const frame of ["recorded", "from the cache"]) {
    const boxes = rec.record(draw).debugBoxes;
    assert.deepEqual(boxes.map((b) => [b.label, b.corners[0], b.corners[2]]), [["hit", [11, 2], [14, 6]], ["hit", [21, 52], [24, 56]]], frame);
  }
});

test("a shared key and a later stale capture at one call each warn: the cause is part of the once-per-run key", () => {
  const rec = new SceneRecorder({ width: 100, height: 80 }, { audit: true });
  const draw = (colors: readonly string[]) => (v: View): void => {
    for (const fill of colors) v.place(v.picture({ key: "chip", width: 4, height: 4 }, () => v.rect(0, 0, 4, 4, { fill })), 0, 0);
  };
  assert.match(rec.record(draw(["#000", "#111"])).warnings.join("\n"), /asked for twice this frame/);
  assert.match(rec.record(draw(["#222"])).warnings.join("\n"), /kept version is stale/);
});

test("a key that records a new version every frame says each new version is used once, not that the picture is never reused", () => {
  const rec = new SceneRecorder({ width: 100, height: 80 }, { audit: true });
  const warnings: string[] = [];
  for (let t = 0; t < 3; t++) {
    warnings.push(...rec.record((v) => {
      v.place(v.picture({ key: "bar", width: 10, height: 10 }, () => v.rect(0, 0, 10, 10, { fill: "#000" })), 0, 0);
      v.place(v.picture({ key: "bar", width: 20 + t, height: 10 }, () => v.rect(0, 0, 20 + t, 10, { fill: "#000" })), 0, 20);
    }).warnings);
  }
  assert.match(warnings.join("\n"), /picture "bar" recorded a new version in each of the last 3 frames .* so each new version is used once/);
  assert.doesNotMatch(warnings.join("\n"), /never reused/);
});
