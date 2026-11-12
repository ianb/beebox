import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import type { View } from "../../src/core/tea.js";
import { teaView } from "../helpers.js";
import type { TeaViewHarness } from "../helpers.js";

function makeView(): TeaViewHarness {
  return teaView({ width: 100, height: 100 }, { seed: 42 });
}

function hashFrame(h: TeaViewHarness): string {
  const data = h.pixels();
  return createHash("sha256").update(Buffer.from(data.buffer, data.byteOffset, data.byteLength)).digest("hex");
}

function pixel(h: TeaViewHarness, at: readonly [number, number]): [number, number, number, number] {
  const [r, g, b, a] = h.rgba(at[0], at[1]);
  return [r ?? 0, g ?? 0, b ?? 0, a ?? 0];
}

// The empty (fresh) canvas is transparent black — the "did it paint anything?" baseline.
const EMPTY_HASH = hashFrame(makeView());

// name → a draw that exercises exactly one new primitive.
const PRIMITIVES: Record<string, (v: View) => void> = {
  polygon(v) {
    v.polygon(
      [
        [10, 10],
        [90, 20],
        [50, 90],
      ],
      { fill: "#ff3355" },
    );
  },
  path(v) {
    v.path(
      [
        ["move", 12, 12],
        ["line", 88, 20],
        ["quad", 92, 60, 60, 78],
        ["bezier", 40, 92, 20, 60, 12, 40],
        ["close"],
      ],
      { fill: "#33cc66", stroke: "#003311", weight: 2 },
    );
  },
  arc(v) {
    v.arc(50, 50, 32, 0, Math.PI * 1.25, { stroke: "#3366ff", weight: 5 });
  },
  linearGradient(v) {
    v.rect(0, 0, 100, 100, {
      fill: v.linearGradient(0, 0, 100, 0, [
        [0, "#000000"],
        [1, "#ffffff"],
      ]),
    });
  },
  radialGradient(v) {
    v.rect(0, 0, 100, 100, {
      fill: v.radialGradient(50, 50, 55, [
        [0, "#ffffff"],
        [1, "#101020"],
      ]),
    });
  },
  clip(v) {
    v.clip(
      [
        [0, 0],
        [50, 0],
        [50, 100],
        [0, 100],
      ],
      () => v.rect(0, 0, 100, 100, { fill: "#ff0000" }),
    );
  },
};

for (const [name, draw] of Object.entries(PRIMITIVES)) {
  test(`${name}: paints something and is deterministic across two runs`, () => {
    const a = makeView();
    const b = makeView();
    draw(a.v);
    draw(b.v);
    const hashA = hashFrame(a);
    assert.notEqual(hashA, EMPTY_HASH, `${name} left the canvas unchanged`);
    assert.equal(hashA, hashFrame(b), `${name} rendered differently on a second run`);
  });
}

test("clip confines drawing to its region: inside painted, outside untouched", () => {
  const h = makeView();
  h.v.clip(
    [
      [0, 0],
      [50, 0],
      [50, 100],
      [0, 100],
    ],
    () => h.v.rect(0, 0, 100, 100, { fill: "#ff0000" }),
  );
  assert.deepEqual(pixel(h, [25, 50]), [255, 0, 0, 255], "inside the clip is opaque red");
  assert.equal(pixel(h, [75, 50])[3], 0, "outside the clip stayed transparent");
});

test("clip also accepts a path-command shape", () => {
  const h = makeView();
  h.v.clip(
    [
      ["move", 0, 0],
      ["line", 40, 0],
      ["line", 40, 100],
      ["line", 0, 100],
      ["close"],
    ],
    () => h.v.rect(0, 0, 100, 100, { fill: "#00aaff" }),
  );
  assert.equal(pixel(h, [20, 50])[3], 255, "inside the path clip is painted");
  assert.equal(pixel(h, [70, 50])[3], 0, "outside the path clip stayed transparent");
});

test("linearGradient produces differing pixels along its axis", () => {
  const h = makeView();
  h.v.rect(0, 0, 100, 100, {
    fill: h.v.linearGradient(0, 0, 100, 0, [
      [0, "#000000"],
      [1, "#ffffff"],
    ]),
  });
  const left = pixel(h, [5, 50])[0];
  const right = pixel(h, [95, 50])[0];
  assert.ok(right > left + 100, `expected a bright→dark ramp, got left=${left} right=${right}`);
  // Same y, different x differ; same x, different y match (axis is horizontal).
  assert.equal(pixel(h, [50, 10])[0], pixel(h, [50, 90])[0], "gradient is constant across its perpendicular");
});

test("radialGradient is bright at center, dark at the corners", () => {
  const h = makeView();
  h.v.rect(0, 0, 100, 100, {
    fill: h.v.radialGradient(50, 50, 55, [
      [0, "#ffffff"],
      [1, "#101020"],
    ]),
  });
  const center = pixel(h, [50, 50])[0];
  const corner = pixel(h, [2, 2])[0];
  assert.ok(center > corner + 100, `expected center brighter than corner, got center=${center} corner=${corner}`);
});

test("a gradient handle works as a background paint", () => {
  const h = makeView();
  h.v.background(
    h.v.linearGradient(0, 0, 0, 100, [
      [0, "#220000"],
      [1, "#ff0000"],
    ]),
  );
  const top = pixel(h, [50, 3])[0];
  const bottom = pixel(h, [50, 97])[0];
  assert.ok(bottom > top + 100, `expected a vertical background ramp, got top=${top} bottom=${bottom}`);
});
