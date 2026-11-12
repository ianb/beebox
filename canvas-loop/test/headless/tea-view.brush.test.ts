import assert from "node:assert/strict";
import { test } from "node:test";
import type { Style } from "../../src/core/paint.js";
import type { Sprite } from "../../src/core/tea.js";
import { teaView } from "../helpers.js";
import type { TeaViewHarness } from "../helpers.js";

function makeView(size: { width: number; height: number }): TeaViewHarness {
  return teaView(size, { seed: 42 });
}

function pixel(h: TeaViewHarness, at: readonly [number, number]): [number, number, number, number] {
  const [r, g, b, a] = h.rgba(at[0], at[1]);
  return [r ?? 0, g ?? 0, b ?? 0, a ?? 0];
}

/** The RGBA bytes of a rectangle of the canvas. */
function region(h: TeaViewHarness, r: { x: number; y: number; w: number; h: number; width: number }): Buffer {
  const data = h.pixels();
  const rows: Buffer[] = [];
  for (let y = r.y; y < r.y + r.h; y += 1) {
    rows.push(Buffer.from(data.subarray((y * r.width + r.x) * 4, (y * r.width + r.x + r.w) * 4)));
  }
  return Buffer.concat(rows);
}

test("group opacity: overlapping opaque children do not darken where they overlap", () => {
  const h = makeView({ width: 100, height: 60 });
  h.v.background("#ffffff");
  h.v.group({ opacity: 0.5 }, () => {
    h.v.circle(35, 30, 40, { fill: "#cc0000" });
    h.v.circle(65, 30, 40, { fill: "#cc0000" });
  });
  assert.deepEqual(pixel(h, [50, 30]), pixel(h, [25, 30]), "overlap matches a single-coverage point");
  assert.notDeepEqual(pixel(h, [25, 30]), [204, 0, 0, 255], "the group is translucent");
});

test("group opacity: translucent children still compound with each other inside the group", () => {
  const h = makeView({ width: 100, height: 60 });
  h.v.group({ opacity: 0.5 }, () => {
    h.v.circle(35, 30, 40, { fill: "rgba(0,0,200,0.5)" });
    h.v.circle(65, 30, 40, { fill: "rgba(0,0,200,0.5)" });
  });
  assert.ok(pixel(h, [50, 30])[3] > pixel(h, [25, 30])[3], "overlap is more opaque than single coverage");
});

test("raw ctx drawing inside a group lands on the group's layer", () => {
  const h = makeView({ width: 40, height: 40 });
  h.v.group({ opacity: 0.5 }, () => {
    h.v.ctx.fillStyle = "#00aa00";
    h.v.ctx.fillRect(0, 0, 40, 40);
  });
  const alpha = pixel(h, [20, 20])[3];
  assert.ok(alpha > 100 && alpha < 160, `expected ~half alpha, got ${alpha}`);
});

test("erase inside a group removes only the group's pixels", () => {
  const h = makeView({ width: 60, height: 60 });
  h.v.background("#ffffff");
  h.v.group({}, () => {
    h.v.rect(0, 0, 60, 60, { fill: "#ff0000" });
    h.v.rect(20, 20, 20, 20, { fill: "#ff0000", erase: true });
  });
  assert.deepEqual(pixel(h, [30, 30]), [255, 255, 255, 255], "the hole shows the background");
  assert.deepEqual(pixel(h, [5, 5]), [255, 0, 0, 255]);
});

const PENCIL: Style = { stroke: "#222222", weight: 6, brush: "pencil" };

function pencilWave(h: TeaViewHarness, dy: number): void {
  h.v.curve(
    [
      [10, 40 + dy],
      [60, 20 + dy],
      [110, 50 + dy],
      [150, 30 + dy],
    ],
    false,
    PENCIL,
  );
}

test("inserting another mark first leaves a mark's pixels unchanged", () => {
  const alone = makeView({ width: 160, height: 160 });
  pencilWave(alone, 0);
  const after = makeView({ width: 160, height: 160 });
  pencilWave(after, 100);
  pencilWave(after, 0);
  const r = { x: 0, y: 0, w: 160, h: 75, width: 160 };
  assert.ok(region(alone, r).equals(region(after, r)));
});

test("under an explicit seed, moving a mark's last point leaves its first half unchanged", () => {
  const draw = (endX: number): TeaViewHarness => {
    const h = makeView({ width: 200, height: 60 });
    h.v.line(10, 30, endX, 30, { ...PENCIL, gesture: { pressure: "even", wobble: 2, seed: 7 } });
    return h;
  };
  const r = { x: 0, y: 0, w: 80, h: 60, width: 200 };
  assert.ok(region(draw(180), r).equals(region(draw(190), r)));
});

test("a mark under translate matches the same mark drawn at the translated coordinates", () => {
  const moved = makeView({ width: 200, height: 160 });
  moved.v.at({ translate: [40, 0] }, () => pencilWave(moved, 0));
  const direct = makeView({ width: 200, height: 160 });
  direct.v.curve(
    [
      [50, 40],
      [100, 20],
      [150, 50],
      [190, 30],
    ],
    false,
    PENCIL,
  );
  const r = { x: 0, y: 0, w: 200, h: 160, width: 200 };
  assert.ok(region(moved, r).equals(region(direct, r)));
});

test("a path with two moves paints no bridge between its pieces", () => {
  const h = makeView({ width: 120, height: 20 });
  h.v.path(
    [
      ["move", 5, 10],
      ["line", 30, 10],
      ["move", 90, 10],
      ["line", 115, 10],
    ],
    { stroke: "#000000", weight: 4, brush: "ink" },
  );
  assert.equal(pixel(h, [60, 10])[3], 0, "nothing between the two pieces");
  assert.ok(pixel(h, [17, 10])[3] > 0 && pixel(h, [102, 10])[3] > 0, "both pieces painted");
});

test("brush blend multiply darkens the colour underneath", () => {
  const h = makeView({ width: 60, height: 20 });
  h.v.background("#ffff00");
  h.v.line(5, 10, 55, 10, { stroke: "#00ffff", weight: 10, brush: h.v.brushOf("ink", { blend: "multiply" }), gesture: { pressure: "even" } });
  const [r, g, b] = pixel(h, [30, 10]);
  assert.ok(r < 40 && g > 200 && b < 40, `yellow × cyan should be green, got ${r},${g},${b}`);
});

test("brush and style validation names the problem", () => {
  const { v } = makeView({ width: 10, height: 10 });
  // eslint-disable-next-line no-restricted-syntax -- deliberately wrong input: checks the runtime guard a hand-edited sketch would hit
  assert.throws(() => v.brushOf("charcoal" as "ink", {}), /unknown brush "charcoal"/);
  assert.throws(() => v.brushOf("ink", { bristles: 3 }), /"bristles" does not apply to a ink brush/);
  assert.throws(() => v.brushOf("pencil", { spacing: 0 }), /spacing must be a number/);
  assert.throws(() => v.line(0, 0, 5, 5, { stroke: "#000", weight: Number.NaN, brush: "ink" }), /style\.weight must be a number ≥ 0/);
  assert.throws(
    () => v.line(0, 0, 5, 5, { stroke: "#000", weight: 2, brush: "ink", gesture: { pressure: [[0.5, 1], [0.2, 0]] } }),
    /sorted by t/,
  );
});

test("the TEA View draws brushed marks inside a group", () => {
  const h = makeView({ width: 120, height: 60 });
  h.v.background("#ffffff");
  h.v.group({ opacity: 0.8 }, () => {
    h.v.curve(
      [
        [10, 30],
        [60, 20],
        [110, 30],
      ],
      false,
      { stroke: "#2f6b3a", weight: 20, brush: "bristle", gesture: { pressure: "even", seed: 3 } },
    );
  });
  const [r, g] = pixel(h, [60, 22]);
  assert.ok(g > r, "green paint landed");
});

test("clip to several shapes keeps drawing inside their union only", () => {
  const h = makeView({ width: 100, height: 40 });
  h.v.clip(
    [
      [
        [0, 0],
        [30, 0],
        [30, 40],
        [0, 40],
      ],
      [
        [70, 0],
        [100, 0],
        [100, 40],
        [70, 40],
      ],
    ],
    () => h.v.rect(0, 0, 100, 40, { fill: "#ff0000" }),
  );
  assert.equal(pixel(h, [15, 20])[3], 255);
  assert.equal(pixel(h, [85, 20])[3], 255);
  assert.equal(pixel(h, [50, 20])[3], 0, "the gap between the shapes stays empty");
});

test("an ellipse gradient is squashed: same colour at the same fraction of each radius", () => {
  const h = makeView({ width: 200, height: 100 });
  h.v.rect(0, 0, 200, 100, {
    fill: h.v.ellipseGradient(100, 50, 160, 40, [
      [0, "#000000"],
      [1, "#ffffff"],
    ]),
  });
  const across = pixel(h, [140, 50])[0];
  const down = pixel(h, [100, 60])[0];
  assert.ok(Math.abs(across - down) <= 8, `half-radius across ${across} vs down ${down}`);
});

test("a mark too faint to see is reported as a warning", () => {
  const { v, logs } = makeView({ width: 100, height: 40 });
  v.line(10, 20, 90, 20, { stroke: "rgba(0,0,0,0.03)", weight: 10, brush: "ink" });
  assert.equal(logs.length, 1);
  assert.match(logs[0] ?? "", /faint mark near/);
  v.line(10, 20, 90, 20, { stroke: "#000000", weight: 10, brush: "ink" });
  assert.equal(logs.length, 1, "a visible mark is not reported");
});

test("cache draws its body once per key and pastes the same pixels after", () => {
  const h = makeView({ width: 60, height: 40 });
  let runs = 0;
  const scene = (): void => {
    runs += 1;
    h.v.line(5, 20, 55, 20, { stroke: "#2f6b3a", weight: 14, brush: "bristle" });
  };
  h.v.cache("scene", scene);
  const first = Buffer.from(h.pixels());
  h.v.background("#ffffff");
  h.v.background("rgba(0,0,0,0)");
  h.v.ctx.clearRect(0, 0, 60, 40);
  h.v.cache("scene", scene);
  assert.equal(runs, 1, "the body ran once");
  assert.ok(Buffer.from(h.pixels()).equals(first), "the pasted pixels match");
  h.v.cache("scene-2", scene);
  assert.equal(runs, 2, "a new key redraws");
});

test("calling paper() again with the same settings keeps the texture (no per-frame rebuild)", () => {
  const { v } = makeView({ width: 300, height: 300 });
  v.paper({ scale: 3 });
  v.paperTexture(1);
  const start = process.hrtime.bigint();
  for (let i = 0; i < 20; i += 1) v.paper({ scale: 3 });
  v.paperTexture(1);
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  assert.ok(ms < 200, `20 repeated paper() calls took ${ms.toFixed(0)} ms`);
});

test("a sprite is drawn once and placed anywhere under the current transform", () => {
  const h = makeView({ width: 100, height: 60 });
  let runs = 0;
  const make = (): Sprite =>
    h.v.sprite({ key: "dot", width: 10, height: 10 }, () => {
      runs += 1;
      h.v.rect(0, 0, 10, 10, { fill: "#ff0000" });
    });
  h.v.image(make(), 5, 5);
  h.v.at({ translate: [60, 20] }, () => h.v.image(make(), 0, 0, { opacity: 0.5 }));
  assert.equal(runs, 1, "the body ran once");
  assert.deepEqual(pixel(h, [9, 9]), [255, 0, 0, 255]);
  assert.equal(pixel(h, [64, 24])[3], 128, "translated, half opacity");
  assert.equal(pixel(h, [30, 30])[3], 0);
  assert.throws(() => h.v.image({ kind: "sprite", key: "nope", width: 1, height: 1 }, 0, 0), /not defined/);
});
