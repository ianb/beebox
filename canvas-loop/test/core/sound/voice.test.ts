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
  assert.deepEqual(score.add([first], 10).added, [first]);
  assert.deepEqual(
    score.add([first], 11),
    { added: [], dropped: [] },
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

test("a voice budget drops a fifth voice of one sound, and a seventeenth voice in all, within a quarter second", () => {
  const score = new Score();
  const thud = (n: number, at: number): Voice => ({ id: `thud-${n}`, at, kind: "sample", name: "thud", variant: n });
  const first = score.add([0, 1, 2, 3, 4].map((n) => thud(n, 10 + n)), 10);
  assert.deepEqual(first.added.map((v) => v.id), ["thud-0", "thud-1", "thud-2", "thud-3"]);
  assert.deepEqual(first.dropped.map((v) => v.id), ["thud-4"], "other takes of the same sample are the same sound");
  assert.deepEqual(score.add([thud(4, 14)], 12), { added: [], dropped: [] }, "a dropped voice declared again stays dropped");
  assert.deepEqual(score.add([thud(5, 25)], 25).added.map((v) => v.id), ["thud-5"], "15 frames after the first, it has room again");
  const notes = Array.from({ length: 14 }, (_, i): Voice => ({ id: `note-${i}`, at: 30, kind: "note", instrument: "marimba", note: `${"CDEFGAB"[i % 7] ?? "C"}${4 + Math.floor(i / 7)}` }));
  const chord = score.add([...notes, thud(6, 30), thud(7, 30)], 30);
  assert.deepEqual(chord.dropped.map((v) => v.id), ["thud-7"], "thud-5 still sounds, so 14 notes and thud-6 make sixteen in all");
  assert.equal(score.voices().length, 4 + 1 + 15, "only kept voices are in the score");
});

test("a voice declared ahead reserves its start: four thuds due at frame 30 leave no room for one due at 29", () => {
  const score = new Score();
  const thud = (n: number, at: number): Voice => ({ id: `t${n}`, at, kind: "sample", name: "thud" });
  assert.equal(score.add([0, 1, 2, 3].map((n) => thud(n, 30)), 0).added.length, 4);
  assert.deepEqual(score.add([thud(4, 29)], 1).dropped.map((v) => v.id), ["t4"]);
});

test("required fields and the wave name are checked", () => {
  // eslint-disable-next-line no-restricted-syntax -- deliberately wrong input: a voice missing required fields, as plain JavaScript could pass
  const bad = (voice: object): Voice => voice as unknown as Voice;
  assert.throws(() => assertVoice(bad({ id: "n", at: 0, kind: "noise" })), /"duration"/u);
  assert.throws(() => assertVoice(bad({ id: "t", at: 0, kind: "tone", duration: 1 })), /"freq"/u);
  assert.throws(() => assertVoice(bad({ id: "w", at: 0, kind: "tone", freq: 440, duration: 1, wave: "sawtooth" })), /"wave" must be sine, triangle or square/u);
});
