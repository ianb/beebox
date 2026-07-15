import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { Sketch } from "../src/headless/sketch.js";

// A no-op host: these tests drive the Sketch engine directly and probe pixels,
// so they don't need the recorder's log/snapshot channels.
const NO_OP_HOST = { recordLog(): void {}, requestSnapshot(): void {} };

function makeSketch(): Sketch {
  const s = new Sketch({ host: NO_OP_HOST, seed: 42, fps: 60, onHandled: () => {} });
  s.createCanvas(100, 100);
  return s;
}

function hashFrame(s: Sketch): string {
  const { data } = s.readPixels();
  return createHash("sha256").update(Buffer.from(data.buffer, data.byteOffset, data.byteLength)).digest("hex");
}

function pixel(s: Sketch, at: readonly [number, number]): [number, number, number, number] {
  const { data, width } = s.readPixels();
  const i = (at[1] * width + at[0]) * 4;
  return [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0, data[i + 3] ?? 0];
}

// The empty (fresh) canvas is transparent black — the "did it paint anything?" baseline.
const EMPTY_HASH = hashFrame(makeSketch());

// name → a draw that exercises exactly one new primitive.
const PRIMITIVES: Record<string, (s: Sketch) => void> = {
  polygon(s) {
    s.fill("#ff3355");
    s.polygon([
      [10, 10],
      [90, 20],
      [50, 90],
    ]);
  },
  path(s) {
    s.fill("#33cc66");
    s.stroke("#003311");
    s.strokeWeight(2);
    s.path([
      ["move", 12, 12],
      ["line", 88, 20],
      ["quad", 92, 60, 60, 78],
      ["bezier", 40, 92, 20, 60, 12, 40],
      ["close"],
    ]);
  },
  arc(s) {
    s.noFill();
    s.stroke("#3366ff");
    s.strokeWeight(5);
    s.arc(50, 50, 32, 0, Math.PI * 1.25);
  },
  linearGradient(s) {
    s.fill(s.linearGradient(0, 0, 100, 0, [
      [0, "#000000"],
      [1, "#ffffff"],
    ]));
    s.rect(0, 0, 100, 100);
  },
  radialGradient(s) {
    s.fill(s.radialGradient(50, 50, 55, [
      [0, "#ffffff"],
      [1, "#101020"],
    ]));
    s.rect(0, 0, 100, 100);
  },
  clip(s) {
    s.clip(
      [
        [0, 0],
        [50, 0],
        [50, 100],
        [0, 100],
      ],
      () => {
        s.fill("#ff0000");
        s.rect(0, 0, 100, 100);
      },
    );
  },
};

for (const [name, draw] of Object.entries(PRIMITIVES)) {
  test(`${name}: paints something and is deterministic across two runs`, () => {
    const a = makeSketch();
    const b = makeSketch();
    draw(a);
    draw(b);
    const hashA = hashFrame(a);
    assert.notEqual(hashA, EMPTY_HASH, `${name} left the canvas unchanged`);
    assert.equal(hashA, hashFrame(b), `${name} rendered differently on a second run`);
  });
}

test("clip confines drawing to its region: inside painted, outside untouched", () => {
  const s = makeSketch();
  s.clip(
    [
      [0, 0],
      [50, 0],
      [50, 100],
      [0, 100],
    ],
    () => {
      s.fill("#ff0000");
      s.rect(0, 0, 100, 100);
    },
  );
  const [ri, gi, bi, ai] = pixel(s, [25, 50]);
  assert.deepEqual([ri, gi, bi, ai], [255, 0, 0, 255], "inside the clip is opaque red");
  assert.equal(pixel(s, [75, 50])[3], 0, "outside the clip stayed transparent");
});

test("clip also accepts a path-command shape", () => {
  const s = makeSketch();
  s.clip(
    [
      ["move", 0, 0],
      ["line", 40, 0],
      ["line", 40, 100],
      ["line", 0, 100],
      ["close"],
    ],
    () => {
      s.fill("#00aaff");
      s.rect(0, 0, 100, 100);
    },
  );
  assert.equal(pixel(s, [20, 50])[3], 255, "inside the path clip is painted");
  assert.equal(pixel(s, [70, 50])[3], 0, "outside the path clip stayed transparent");
});

test("linearGradient produces differing pixels along its axis", () => {
  const s = makeSketch();
  s.fill(s.linearGradient(0, 0, 100, 0, [
    [0, "#000000"],
    [1, "#ffffff"],
  ]));
  s.rect(0, 0, 100, 100);
  const left = pixel(s, [5, 50])[0];
  const right = pixel(s, [95, 50])[0];
  assert.ok(right > left + 100, `expected a bright→dark ramp, got left=${left} right=${right}`);
  // Same y, different x differ; same x, different y match (axis is horizontal).
  assert.equal(pixel(s, [50, 10])[0], pixel(s, [50, 90])[0], "gradient is constant across its perpendicular");
});

test("radialGradient is bright at center, dark at the corners", () => {
  const s = makeSketch();
  s.fill(s.radialGradient(50, 50, 55, [
    [0, "#ffffff"],
    [1, "#101020"],
  ]));
  s.rect(0, 0, 100, 100);
  const center = pixel(s, [50, 50])[0];
  const corner = pixel(s, [2, 2])[0];
  assert.ok(center > corner + 100, `expected center brighter than corner, got center=${center} corner=${corner}`);
});

test("a gradient handle works as a background paint", () => {
  const s = makeSketch();
  s.background(s.linearGradient(0, 0, 0, 100, [
    [0, "#220000"],
    [1, "#ff0000"],
  ]));
  const top = pixel(s, [50, 3])[0];
  const bottom = pixel(s, [50, 97])[0];
  assert.ok(bottom > top + 100, `expected a vertical background ramp, got top=${top} bottom=${bottom}`);
});
