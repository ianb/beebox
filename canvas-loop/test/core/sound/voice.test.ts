import assert from "node:assert/strict";
import { test } from "node:test";
import { Score, assertVoice } from "../../../src/core/sound/voice.js";
import type { Voice } from "../../../src/core/sound/voice.js";

test("assertVoice names the voice and the key", () => {
  assert.throws(
    () => assertVoice({ id: "s1", at: 0, kind: "pluck", freq: 0 }),
    /voice "s1" "freq" must be 20..20000 Hz/u,
  );
  assert.throws(
    () => assertVoice({ id: "s2", at: 1.5, kind: "noise", duration: 1 }),
    /voice "s2" "at" must be a frame number/u,
  );
  assert.throws(
    () =>
      assertVoice({ id: "s3", at: 0, kind: "tone", freq: 440, duration: 60 }),
    /voice "s3" "duration"/u,
  );
  // eslint-disable-next-line no-restricted-syntax -- deliberately wrong input: a key a pluck does not take
  const extra = {
    id: "s4",
    at: 0,
    kind: "pluck",
    freq: 220,
    duration: 1,
  } as unknown as Voice;
  assert.throws(
    () => assertVoice(extra),
    /unknown key "duration" for a pluck/u,
  );
});

test("a voice is one occurrence: re-declaring is harmless, changing it or backdating it is an error", () => {
  const score = new Score();
  const first: Voice = { id: "pluck-1", at: 10, kind: "pluck", freq: 196 };
  assert.deepEqual(score.add([first], 10), [first]);
  assert.deepEqual(
    score.add([first], 11),
    [],
    "returning it again is harmless",
  );
  assert.throws(
    () => score.add([{ ...first, freq: 220 }], 12),
    /voice "pluck-1" changed/u,
  );
  assert.throws(
    () => score.add([{ id: "late", at: 3, kind: "noise", duration: 0.1 }], 12),
    /starts at frame 3, before frame 12/u,
  );
  assert.deepEqual(score.voices(), [first]);
});

test("at most 32 new voices a frame", () => {
  const many: Voice[] = Array.from({ length: 33 }, (_, i) => ({
    id: `n${i}`,
    at: 0,
    kind: "noise",
    duration: 0.05,
  }));
  assert.throws(() => new Score().add(many, 0), /33 new voices on frame 0/u);
});

test("required fields and the wave name are checked", () => {
  // eslint-disable-next-line no-restricted-syntax -- deliberately wrong input: a voice missing required fields, as plain JavaScript could pass
  const bad = (voice: object): Voice => voice as unknown as Voice;
  assert.throws(() => assertVoice(bad({ id: "n", at: 0, kind: "noise" })), /"duration"/u);
  assert.throws(() => assertVoice(bad({ id: "t", at: 0, kind: "tone", duration: 1 })), /"freq"/u);
  assert.throws(() => assertVoice(bad({ id: "w", at: 0, kind: "tone", freq: 440, duration: 1, wave: "sawtooth" })), /"wave" must be sine, triangle or square/u);
});
