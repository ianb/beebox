// Picture versions in the recorder (draft section 5): keyed by key, size and
// deep-equal plain-data deps; the testing-mode audit; eviction; `pixels`;
// what a picture body may not do (section 8).
import assert from "node:assert/strict";
import { test } from "node:test";
import { SketchUsageError } from "../../src/core/errors.js";
import type { Drawing, Picture, PlaceOptions, View } from "../../src/core/tea.js";
import { sceneOutline } from "../../src/scene/outline.js";
import { SceneRecorder } from "../../src/scene/recorder/view.js";
import { createCanvas } from "@napi-rs/canvas";
import type { Ctx2D } from "../../src/core/ctx2d.js";
import { colorsFrom } from "../../src/scene/colors.js";

const usage = (message: RegExp) => (e: unknown): boolean => e instanceof SketchUsageError && message.test(e.message);

test("a version is recorded once per key, size and deps; deps compare by value", () => {
  const rec = new SceneRecorder({ width: 100, height: 80 });
  let runs = 0;
  const pic = (v: View, at: { deps: readonly unknown[]; width?: number }): Drawing => {
    return v.place(v.picture({ key: "card", width: at.width ?? 20, height: 10, deps: at.deps }, () => {
      runs++;
      return v.rect(0, 0, 5, 5, { fill: "#000" });
    }), 0, 0);
  };
  rec.record((v) => pic(v, { deps: [1, { look: "a" }] }));
  rec.record((v) => pic(v, { deps: [1, { look: "a" }] }));
  assert.equal(runs, 1, "equal deps (a new but equal object) reuse the version");
  rec.record((v) => {
    return [
      pic(v, { deps: [1, { look: "b" }] }),
      pic(v, { deps: [1, { look: "a" }] }),
      pic(v, { deps: [1, { look: "a" }], width: 30 }),
    ];
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
  const draw = (color: string) => (v: View): Drawing => {
    return v.place(v.picture({ key: "card", width: 20, height: 10, deps: [1] }, () => {
      return [
        v.rect(0, 0, 5, 5, { fill: "#000" }),
        v.group({ name: "face" }, v.circle(2, 2, 1, { fill: color })),
      ];
    }), 0, 0);
  };
  assert.deepEqual(rec.record(draw("red")).warnings, []);
  assert.deepEqual(rec.record(draw("red")).warnings, [], "the same drawing does not warn");
  const [warning] = rec.record(draw("blue")).warnings;
  assert.match(warning ?? "", /picture "card" \[1] drew differently from its kept version with the same key and deps \[1]/);
  assert.match(warning ?? "", /first difference at picture "card" \[1] > group #2 > circle #1/);
});

test("a version not asked for stays kept, so a walk cycle's poses record once and the churn warning stays quiet", () => {
  const rec = new SceneRecorder({ width: 100, height: 80 }, { audit: true });
  const warnings: string[] = [];
  // Three walkers on one key, each holding a pose three frames; one of them changes pose each frame, so the first cycle adds a version in every frame.
  for (let f = 0; f < 40; f++) {
    warnings.push(...rec.record((v) => [0, 1, 2].map((i) => {
      const pose = (Math.floor((f + i) / 3) + i * 2) % 6;
      return v.place(v.picture({ key: "walker", width: 10, height: 10, deps: [pose] }, () => v.rect(0, 0, pose + 1, 10, { fill: "#000" })), i * 20, 0);
    })).warnings);
  }
  assert.deepEqual(warnings, []);
  const plain = new SceneRecorder({ width: 10, height: 10 });
  let recorded = 0;
  const ask = (pose: number) => (v: View): Drawing => v.place(v.picture({ key: "k", width: 1, height: 1, deps: [pose] }, () => {
    recorded++;
    return v.rect(0, 0, 1, 1, { fill: "#000" });
  }), 0, 0);
  for (let f = 0; f < 60; f++) plain.record(ask(Math.floor(f / 5) % 4));
  assert.equal(recorded, 4, "each of 4 poses, shown 5 frames in turn, is recorded once (not each time it comes back)");
});

test("versions not asked for are dropped, least recently asked first, past about 16 MB", () => {
  const rec = new SceneRecorder({ width: 10, height: 10 });
  let fills = 0;
  // Each version holds 1000 × 1000 × 4 bytes: four of them idle fit in 16 MiB, five do not.
  const ask = (n: number) => (v: View): Drawing => v.place(v.pixels({ key: "big", width: 1000, height: 1000, deps: [n] }, (im) => {
    fills++;
    im.data[3] = 255;
  }), 0, 0);
  for (let n = 0; n < 8; n++) rec.record(ask(n));
  for (let f = 0; f < 3; f++) rec.record(() => null);
  assert.equal(fills, 8);
  rec.record(ask(7));
  rec.record(ask(4));
  assert.equal(fills, 8, "the four most recent are kept");
  rec.record(ask(3));
  assert.equal(fills, 9, "an older one was dropped and is filled again");
});

test("a picture body has its own coordinates and box; it may not log, snapshot or set the cursor", () => {
  const rec = new SceneRecorder({ width: 100, height: 80 });
  let inside: [number, number] = [0, 0];
  const picture = (v: View): Picture =>
    v.picture({ key: "k", width: 30, height: 20 }, () => {
      inside = [v.width, v.height];
      return null;
    });
  rec.record((v) => v.at({ translate: [10, 10] }, v.place(picture(v), 0, 0)));
  assert.deepEqual(inside, [30, 20]);
  const cases: [string, (v: View) => void][] = [["log", (v) => v.log("x")], ["snapshot", (v) => v.snapshot()], ["cursor", (v) => v.cursor("grab")]];
  for (const [call, body] of cases) {
    const said = (e: unknown): boolean => e instanceof SketchUsageError && e.message.includes(`v.${call} inside the body of picture "${call}"`);
    const draw = (v: View): Drawing => {
      v.picture({ key: call, width: 1, height: 1 }, () => {
        body(v);
        return null;
      });
      return null;
    };
    assert.throws(() => rec.record(draw), said, call);
  }
});

test("testing mode compares a kept version in its first frames, then 30 frames after the last comparison; a stale capture that lasts is found then", () => {
  const rec = new SceneRecorder({ width: 100, height: 80 }, { audit: true });
  let runs = 0;
  const draw = (color: string) => (v: View): Drawing => v.place(v.picture({ key: "card", width: 20, height: 10, deps: [1] }, () => {
    runs++;
    return v.rect(0, 0, 5, 5, { fill: color });
  }), 0, 0);
  const warnings: (readonly string[])[] = [];
  for (let frame = 0; frame <= 60; frame++) warnings.push(rec.record(draw(frame < 10 ? "#000" : "#fff")).warnings);
  assert.equal(runs, 4, "recorded at frame 0, compared at frames 1, 2 and 32");
  assert.deepEqual(warnings.slice(0, 32).flat(), [], "the change at frame 10 falls between audits");
  assert.match(warnings[32]?.[0] ?? "", /picture "card" \[1] drew differently from its kept version/);
  // Asked for only on odd frames, it is still compared: at the first ask 30 or more frames after the last comparison.
  const odd = new SceneRecorder({ width: 100, height: 80 }, { audit: true });
  const seen: (readonly string[])[] = [];
  for (let frame = 0; frame <= 40; frame++) seen.push(odd.record(frame % 2 === 1 || frame === 0 ? draw(frame < 3 ? "#000" : "#fff") : () => null).warnings);
  assert.deepEqual(seen.slice(0, 31).flat(), []);
  assert.match(seen[31]?.[0] ?? "", /picture "card" \[1] drew differently/);
});

test("a new version first asked for inside a re-record keeps its checks: a drawing its body drops still warns", () => {
  const rec = new SceneRecorder({ width: 100, height: 80 }, { audit: true });
  let level = 1;
  const inner = (v: View): Picture => v.picture({ key: "leaf", width: 10, height: 10, deps: [level] }, () => {
    if (level === 2) v.circle(2, 2, 1, { fill: "#000" });
    return v.rect(0, 0, level, level, { fill: "#000" });
  });
  // The outer body reads `level` too, outside its deps: its frame-1 comparison asks for the new inner version.
  const draw = (v: View): Drawing => v.place(v.picture({ key: "tree", width: 20, height: 20 }, () => v.place(inner(v), 0, 0)), 0, 0);
  assert.deepEqual(rec.record(draw).warnings, []);
  level = 2;
  const again = rec.record(draw).warnings;
  assert.ok(again.some((w) => /picture "tree" drew differently/.test(w)), again.join("\n"));
  assert.ok(again.some((w) => /v\.circle made a drawing that was not returned.*\(at test\/scene\/recorder\.pictures\.test\.ts:\d+:\d+\)/.test(w)), again.join("\n"));
});

test("a placement's tint is a colour, checked at the call", () => {
  // eslint-disable-next-line no-restricted-syntax -- structural-context boundary: SKRSContext2D is a superset of Ctx2D, as in src/device/open.ts
  const rec = new SceneRecorder({ width: 20, height: 20 }, { colors: colorsFrom(createCanvas(1, 1).getContext("2d") as unknown as Ctx2D) });
  const placed = (tint: unknown) => (v: View): Drawing => {
    // A sketch without types can pass anything: set it past the option's type.
    const options: PlaceOptions = {};
    Reflect.set(options, "tint", tint);
    return v.place(v.picture({ key: "dot", width: 4, height: 4 }, () => v.rect(0, 0, 4, 4, { fill: "#000" })), 0, 0, options);
  };
  const node = rec.record(placed("oklch(0.8 0.05 240 / 0.4)")).scene.children[0];
  assert.ok(node?.kind === "place" && node.tint === "oklch(0.8 0.05 240 / 0.4)");
  assert.throws(() => rec.record(placed("bluish")), usage(/place tint "bluish" is not a CSS colour/));
  assert.throws(() => rec.record(placed(3)), usage(/place tint must be a CSS colour string, got number/));
});

test("pixels fill once per version; a fully transparent fill warns in testing mode", () => {
  const rec = new SceneRecorder({ width: 10, height: 10 }, { audit: true });
  let fills = 0;
  const draw = (alpha: number) => (v: View): Drawing => v.place(v.pixels({ key: "img", width: 2, height: 2, deps: [alpha] }, (im) => {
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
    return [
      v.place(p, 1, 2),
      v.place(p, 5, 6, { blend: "multiply", opacity: 0.5 }),
    ];
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
  const draw = (v: View): Drawing => {
    const p = v.picture({ key: "boxed", width: 10, height: 10 }, () => v.debugBox("hit", 1, 2, 3, 4));
    return [
      v.place(p, 10, 0),
      v.at({ translate: [0, 50] }, v.place(p, 20, 0)),
    ];
  };
  for (const frame of ["recorded", "from the cache"]) {
    const boxes = rec.record(draw).debugBoxes;
    assert.deepEqual(boxes.map((b) => [b.label, b.corners[0], b.corners[2]]), [["hit", [11, 2], [14, 6]], ["hit", [21, 52], [24, 56]]], frame);
  }
});

test("a shared key and a later stale capture at one call each warn: the cause is part of the once-per-run key", () => {
  const rec = new SceneRecorder({ width: 100, height: 80 }, { audit: true });
  const draw = (colors: readonly string[]) => (v: View): Drawing => {
    const out: Drawing[] = [];
    for (const fill of colors) out.push(v.place(v.picture({ key: "chip", width: 4, height: 4 }, () => v.rect(0, 0, 4, 4, { fill })), 0, 0));
    return out;
  };
  assert.match(rec.record(draw(["#000", "#111"])).warnings.join("\n"), /asked for twice this frame/);
  assert.match(rec.record(draw(["#222"])).warnings.join("\n"), /kept version is stale/);
});

test("a key that records a new version every frame says each new version is used once, not that the picture is never reused", () => {
  const rec = new SceneRecorder({ width: 100, height: 80 }, { audit: true });
  const warnings: (readonly string[])[] = [];
  for (let t = 0; t < 40; t++) {
    warnings.push(rec.record((v) => {
      return [
        v.place(v.picture({ key: "bar", width: 10, height: 10 }, () => v.rect(0, 0, 10, 10, { fill: "#000" })), 0, 0),
        v.place(v.picture({ key: "bar", width: 20 + t, height: 10 }, () => v.rect(0, 0, 20 + t, 10, { fill: "#000" })), 0, 20),
      ];
    }).warnings);
  }
  assert.deepEqual(warnings.slice(0, 32).flat(), [], "quiet while the versions could still come back");
  assert.match(warnings.flat().join("\n"), /picture "bar" recorded a new version in each of the last 33 frames .*, and the versions from 30 frames ago were not asked for again: .* so each new version is used once/);
  assert.doesNotMatch(warnings.flat().join("\n"), /never reused/);
});

test("poses that change every frame and come back (one walker, pose = frame % 4; six poses at three steps a frame) do not warn", () => {
  for (const pose of [(f: number) => f % 4, (f: number) => Math.floor((f * 3) / 2) % 6, (f: number) => f % 24]) {
    const rec = new SceneRecorder({ width: 100, height: 80 }, { audit: true });
    const warnings: string[] = [];
    for (let f = 0; f < 120; f++) {
      warnings.push(...rec.record((v) => v.place(v.picture({ key: "walker", width: 10, height: 10, deps: [pose(f)] }, () => v.rect(0, 0, pose(f) + 1, 10, { fill: "#000" })), 0, 0)).warnings);
    }
    assert.deepEqual(warnings, []);
  }
});
