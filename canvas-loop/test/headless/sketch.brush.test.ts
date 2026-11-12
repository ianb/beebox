import assert from "node:assert/strict";
import { test } from "node:test";
import { SketchUsageError } from "../../src/core/errors.js";
import { Sketch } from "../../src/headless/sketch.js";
import { TeaView } from "../../src/headless/tea-view.js";

const NO_OP_HOST = { recordLog(): void {}, requestSnapshot(): void {} };

function makeSketch(size: { width: number; height: number }): Sketch {
  const s = new Sketch({ host: NO_OP_HOST, seed: 42, fps: 60, onHandled: () => {} });
  s.createCanvas(size.width, size.height);
  return s;
}

function pixel(s: Sketch, at: readonly [number, number]): [number, number, number, number] {
  const { data, width } = s.readPixels();
  const i = (at[1] * width + at[0]) * 4;
  return [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0, data[i + 3] ?? 0];
}

/** The RGBA bytes of a rectangle of the canvas. */
function region(s: Sketch, r: { x: number; y: number; w: number; h: number }): Buffer {
  const { data, width } = s.readPixels();
  const rows: Buffer[] = [];
  for (let y = r.y; y < r.y + r.h; y += 1) {
    rows.push(Buffer.from(data.subarray((y * width + r.x) * 4, (y * width + r.x + r.w) * 4)));
  }
  return Buffer.concat(rows);
}

test("group opacity: overlapping opaque children do not darken where they overlap", () => {
  const s = makeSketch({ width: 100, height: 60 });
  s.background("#ffffff");
  s.noStroke();
  s.fill("#cc0000");
  s.group({ opacity: 0.5 }, () => {
    s.circle(35, 30, 40);
    s.circle(65, 30, 40);
  });
  assert.deepEqual(pixel(s, [50, 30]), pixel(s, [25, 30]), "overlap matches a single-coverage point");
  assert.notDeepEqual(pixel(s, [25, 30]), [204, 0, 0, 255], "the group is translucent");
});

test("group opacity: translucent children still compound with each other inside the group", () => {
  const s = makeSketch({ width: 100, height: 60 });
  s.noStroke();
  s.fill("rgba(0,0,200,0.5)");
  s.group({ opacity: 0.5 }, () => {
    s.circle(35, 30, 40);
    s.circle(65, 30, 40);
  });
  assert.ok(pixel(s, [50, 30])[3] > pixel(s, [25, 30])[3], "overlap is more opaque than single coverage");
});

test("raw ctx drawing inside a group lands on the group's layer", () => {
  const s = makeSketch({ width: 40, height: 40 });
  s.group({ opacity: 0.5 }, () => {
    s.ctx.fillStyle = "#00aa00";
    s.ctx.fillRect(0, 0, 40, 40);
  });
  const alpha = pixel(s, [20, 20])[3];
  assert.ok(alpha > 100 && alpha < 160, `expected ~half alpha, got ${alpha}`);
});

test("a group body that pushes and throws leaves no state behind", () => {
  const s = makeSketch({ width: 40, height: 40 });
  assert.throws(() => {
    s.group({}, () => {
      s.push();
      s.erase();
      throw new SketchUsageError({ detail: "test" });
    });
  }, SketchUsageError);
  s.noStroke();
  s.fill("#0000ff");
  s.rect(0, 0, 40, 40);
  assert.deepEqual(pixel(s, [20, 20]), [0, 0, 255, 255], "the rect paints (erase did not leak out)");
  assert.throws(() => s.pop(), SketchUsageError, "the group's push was unwound");
});

test("pop cannot reach out of a group into the caller's push", () => {
  const s = makeSketch({ width: 10, height: 10 });
  s.push();
  assert.throws(() => s.group({}, () => s.pop()), SketchUsageError);
  s.pop();
});

test("erase inside a group removes only the group's pixels", () => {
  const s = makeSketch({ width: 60, height: 60 });
  s.background("#ffffff");
  s.noStroke();
  s.group({}, () => {
    s.fill("#ff0000");
    s.rect(0, 0, 60, 60);
    s.erase();
    s.rect(20, 20, 20, 20);
  });
  assert.deepEqual(pixel(s, [30, 30]), [255, 255, 255, 255], "the hole shows the background");
  assert.deepEqual(pixel(s, [5, 5]), [255, 0, 0, 255]);
});

function pencilWave(s: Sketch, dy: number): void {
  s.noFill();
  s.stroke("#222222");
  s.strokeWeight(6);
  s.brush("pencil");
  s.curve([
    [10, 40 + dy],
    [60, 20 + dy],
    [110, 50 + dy],
    [150, 30 + dy],
  ]);
}

test("inserting another mark first leaves a mark's pixels unchanged", () => {
  const alone = makeSketch({ width: 160, height: 160 });
  pencilWave(alone, 0);
  const after = makeSketch({ width: 160, height: 160 });
  pencilWave(after, 100);
  pencilWave(after, 0);
  const r = { x: 0, y: 0, w: 160, h: 75 };
  assert.ok(region(alone, r).equals(region(after, r)));
});

test("under an explicit seed, moving a mark's last point leaves its first half unchanged", () => {
  const draw = (endX: number): Sketch => {
    const s = makeSketch({ width: 200, height: 60 });
    s.stroke("#222222");
    s.strokeWeight(6);
    s.brush("pencil");
    s.gesture({ pressure: "even", wobble: 2, seed: 7 });
    s.line(10, 30, endX, 30);
    return s;
  };
  const r = { x: 0, y: 0, w: 80, h: 60 };
  assert.ok(region(draw(180), r).equals(region(draw(190), r)));
});

test("a mark under translate matches the same mark drawn at the translated coordinates", () => {
  const moved = makeSketch({ width: 200, height: 160 });
  moved.translate(40, 0);
  pencilWave(moved, 0);
  const direct = makeSketch({ width: 200, height: 160 });
  direct.noFill();
  direct.stroke("#222222");
  direct.strokeWeight(6);
  direct.brush("pencil");
  direct.curve([
    [50, 40],
    [100, 20],
    [150, 50],
    [190, 30],
  ]);
  const r = { x: 0, y: 0, w: 200, h: 160 };
  assert.ok(region(moved, r).equals(region(direct, r)));
});

test("a path with two moves paints no bridge between its pieces", () => {
  const s = makeSketch({ width: 120, height: 20 });
  s.noFill();
  s.stroke("#000000");
  s.strokeWeight(4);
  s.brush("ink");
  s.path([
    ["move", 5, 10],
    ["line", 30, 10],
    ["move", 90, 10],
    ["line", 115, 10],
  ]);
  assert.equal(pixel(s, [60, 10])[3], 0, "nothing between the two pieces");
  assert.ok(pixel(s, [17, 10])[3] > 0 && pixel(s, [102, 10])[3] > 0, "both pieces painted");
});

test("brush blend multiply darkens the colour underneath", () => {
  const s = makeSketch({ width: 60, height: 20 });
  s.background("#ffff00");
  s.stroke("#00ffff");
  s.strokeWeight(10);
  s.brush("ink", { blend: "multiply" });
  s.gesture({ pressure: "even" });
  s.line(5, 10, 55, 10);
  const [r, g, b] = pixel(s, [30, 10]);
  assert.ok(r < 40 && g > 200 && b < 40, `yellow × cyan should be green, got ${r},${g},${b}`);
});

test("brush validation names the problem", () => {
  const s = makeSketch({ width: 10, height: 10 });
  // eslint-disable-next-line no-restricted-syntax -- deliberately wrong input: checks the runtime guard a hand-edited sketch would hit
  assert.throws(() => s.brush("charcoal" as "ink"), /unknown brush "charcoal"/);
  assert.throws(() => s.brush("ink", { bristles: 3 }), /"bristles" does not apply to a ink brush/);
  assert.throws(() => s.brush("pencil", { spacing: 0 }), /spacing must be a number/);
  s.brush("ink");
  s.stroke("#000");
  s.strokeWeight(Number.NaN);
  assert.throws(() => s.line(0, 0, 5, 5), /strokeWeight must be a positive number/);
  s.strokeWeight(2);
  s.gesture({ pressure: [[0.5, 1], [0.2, 0]] });
  assert.throws(() => s.line(0, 0, 5, 5), /sorted by t/);
});

test("the TEA View draws brushed marks inside a group", () => {
  const s = makeSketch({ width: 120, height: 60 });
  const v = new TeaView({ sketch: s, decl: {}, getParams: () => ({}) });
  v.background("#ffffff");
  v.group({ opacity: 0.8 }, () => {
    v.noFill();
    v.stroke("#2f6b3a");
    v.strokeWeight(20);
    v.brush("bristle");
    v.gesture({ pressure: "even", seed: 3 });
    v.curve([
      [10, 30],
      [60, 20],
      [110, 30],
    ]);
  });
  const [r, g] = pixel(s, [60, 22]);
  assert.ok(g > r, "green paint landed");
});

test("clip to several shapes keeps drawing inside their union only", () => {
  const s = makeSketch({ width: 100, height: 40 });
  s.noStroke();
  s.fill("#ff0000");
  s.clip(
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
    () => s.rect(0, 0, 100, 40),
  );
  assert.equal(pixel(s, [15, 20])[3], 255);
  assert.equal(pixel(s, [85, 20])[3], 255);
  assert.equal(pixel(s, [50, 20])[3], 0, "the gap between the shapes stays empty");
});

test("an ellipse gradient is squashed: same colour at the same fraction of each radius", () => {
  const s = makeSketch({ width: 200, height: 100 });
  s.noStroke();
  s.fill(
    s.ellipseGradient(100, 50, 160, 40, [
      [0, "#000000"],
      [1, "#ffffff"],
    ]),
  );
  s.rect(0, 0, 200, 100);
  const across = pixel(s, [140, 50])[0];
  const down = pixel(s, [100, 60])[0];
  assert.ok(Math.abs(across - down) <= 8, `half-radius across ${across} vs down ${down}`);
});

test("a mark too faint to see is reported as a warning", () => {
  const warnings: string[] = [];
  const s = new Sketch({
    host: { recordLog: (e) => warnings.push(e.message), requestSnapshot(): void {} },
    seed: 42,
    fps: 60,
    onHandled: () => {},
  });
  s.createCanvas(100, 40);
  s.stroke("rgba(0,0,0,0.03)");
  s.strokeWeight(10);
  s.brush("ink");
  s.line(10, 20, 90, 20);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0] ?? "", /faint mark near/);
  s.stroke("#000000");
  s.line(10, 20, 90, 20);
  assert.equal(warnings.length, 1, "a visible mark is not reported");
});

test("cache draws its body once per key and pastes the same pixels after", () => {
  const s = makeSketch({ width: 60, height: 40 });
  let runs = 0;
  const scene = (): void => {
    runs += 1;
    s.stroke("#2f6b3a");
    s.strokeWeight(14);
    s.brush("bristle");
    s.line(5, 20, 55, 20);
  };
  s.cache("scene", scene);
  const first = Buffer.from(s.readPixels().data);
  s.background("#ffffff");
  s.background("rgba(0,0,0,0)");
  s.ctx.clearRect(0, 0, 60, 40);
  s.cache("scene", scene);
  assert.equal(runs, 1, "the body ran once");
  assert.ok(Buffer.from(s.readPixels().data).equals(first), "the pasted pixels match");
  s.cache("scene-2", scene);
  assert.equal(runs, 2, "a new key redraws");
});

test("calling paper() again with the same settings keeps the texture (no per-frame rebuild)", () => {
  const s = makeSketch({ width: 300, height: 300 });
  s.paper({ scale: 3 });
  s.paperTexture(1);
  const start = process.hrtime.bigint();
  for (let i = 0; i < 20; i += 1) s.paper({ scale: 3 });
  s.paperTexture(1);
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  assert.ok(ms < 200, `20 repeated paper() calls took ${ms.toFixed(0)} ms`);
});

test("a sprite is drawn once and placed anywhere under the current transform", () => {
  const s = makeSketch({ width: 100, height: 60 });
  let runs = 0;
  const make = () =>
    s.sprite({ key: "dot", width: 10, height: 10 }, () => {
      runs += 1;
      s.noStroke();
      s.fill("#ff0000");
      s.rect(0, 0, 10, 10);
    });
  s.image(make(), 5, 5);
  s.push();
  s.translate(60, 20);
  s.image(make(), 0, 0, 0.5);
  s.pop();
  assert.equal(runs, 1, "the body ran once");
  assert.deepEqual(pixel(s, [9, 9]), [255, 0, 0, 255]);
  assert.equal(pixel(s, [64, 24])[3], 128, "translated, half opacity");
  assert.equal(pixel(s, [30, 30])[3], 0);
  assert.throws(() => s.image({ kind: "sprite", key: "nope", width: 1, height: 1 }, 0, 0), /not defined/);
});
