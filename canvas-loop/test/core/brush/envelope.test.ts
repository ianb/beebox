import assert from "node:assert/strict";
import { test } from "node:test";
import { evalEnvelope } from "../../../src/core/brush/envelope.js";

test("envelopes: taper rises from near zero, presets clamp, keyframes ease", () => {
  assert.ok(evalEnvelope("taper", 0) < 0.1);
  assert.equal(evalEnvelope("taper", 0.5), 1);
  assert.ok(evalEnvelope("taper", 1) < 0.1);
  assert.equal(evalEnvelope(2, 0.3), 1, "a constant above 1 clamps");
  const kf: readonly (readonly [number, number])[] = [
    [0, 0],
    [1, 1],
  ];
  assert.equal(evalEnvelope(kf, 0.5), 0.5);
  assert.equal(
    evalEnvelope(
      [
        [0.5, 0.2],
        [0.5, 0.8],
      ],
      0.6,
    ),
    0.8,
    "a duplicate t keeps the last value",
  );
});

test("duplicate keyframe positions: the later value holds just before the position too", async () => {
  const { evalEnvelope: ev } = await import("../../../src/core/brush/envelope.js");
  const env: readonly (readonly [number, number])[] = [
    [0, 0],
    [0.5, 0.2],
    [0.5, 0.8],
    [1, 1],
  ];
  assert.ok(ev(env, 0.499) > 0.75, `got ${ev(env, 0.499)}`);
});
