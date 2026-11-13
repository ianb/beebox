// Notes, scales and synthesized instruments: in tune, the right length, and
// scaled to the voice's gain.
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_SECONDS, INSTRUMENTS } from "../../../src/core/sound/instruments.js";
import { midiOf, noteFreq, scaleNote } from "../../../src/core/sound/notes.js";
import { SAMPLE_RATE, renderVoice } from "../../../src/core/sound/synth.js";
import { assertVoice } from "../../../src/core/sound/voice.js";
import type { Voice } from "../../../src/core/sound/voice.js";

test("note names give equal-tempered frequencies around A4 = 440", () => {
  assert.equal(noteFreq("A4"), 440);
  assert.ok(Math.abs(noteFreq("C4") - 261.6256) < 0.001);
  assert.equal(noteFreq("A#3"), noteFreq("Bb3"));
  assert.equal(midiOf("H4"), undefined);
  assert.equal(midiOf("C"), undefined);
  assert.throws(() => noteFreq("C"), /"C" is not a note name/u);
});

test("scaleNote walks the scale, wrapping into the next octave and below the root", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((step) => scaleNote(step)), ["C4", "D4", "E4", "G4", "A4", "C5"]);
  assert.equal(scaleNote(-1), "A3");
  assert.equal(scaleNote(2, { root: "D4", scale: "major" }), "F#4");
  assert.equal(scaleNote(2, { scale: "minor" }), "D#4");
  assert.throws(() => scaleNote(1.5), /step must be an integer/u);
  assert.throws(() => scaleNote(30), /leaves C0..C9/u);
});

test("every instrument renders its default length, peaks at the voice's gain, and starts silent", () => {
  for (const instrument of INSTRUMENTS) {
    const voice: Voice = { id: instrument, at: 0, kind: "note", instrument, note: "E4", gain: 0.3 };
    const samples = renderVoice(voice, { sampleRate: SAMPLE_RATE });
    const held = instrument === "pad" ? 0.4 : 0;
    assert.equal(samples.length, Math.ceil((DEFAULT_SECONDS[instrument] + held) * SAMPLE_RATE), instrument);
    let peak = 0;
    for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
    assert.ok(Math.abs(peak - 0.3) < 0.01, `${instrument} peak ${peak}`);
    assert.equal(samples[0], 0, `${instrument} starts at zero`);
    assert.ok(Math.abs(samples.at(-1) ?? 1) < 0.001, `${instrument} ends near zero`);
  }
});

test("a note's duration cuts a struck instrument and holds the pad", () => {
  const marimba = renderVoice({ id: "m", at: 0, kind: "note", instrument: "marimba", note: "C5", duration: 0.25 }, { sampleRate: SAMPLE_RATE });
  assert.equal(marimba.length, Math.ceil(0.25 * SAMPLE_RATE));
  const pad = renderVoice({ id: "p", at: 0, kind: "note", instrument: "pad", note: "C3", duration: 2 }, { sampleRate: SAMPLE_RATE });
  assert.equal(pad.length, Math.ceil(2.4 * SAMPLE_RATE));
});

test("note voices with a bad instrument, note or duration are refused with the voice's id", () => {
  // eslint-disable-next-line no-restricted-syntax -- deliberately wrong input: an instrument that does not exist
  const tuba = { id: "n1", at: 0, kind: "note", instrument: "tuba", note: "C4" } as unknown as Voice;
  assert.throws(() => assertVoice(tuba), /voice "n1" "instrument" must be one of marimba, bell, kalimba, epiano, pad/u);
  assert.throws(() => assertVoice({ id: "n2", at: 0, kind: "note", instrument: "bell", note: "C" }), /voice "n2" "note" must be a note name/u);
  assert.throws(() => assertVoice({ id: "n3", at: 0, kind: "note", instrument: "bell", note: "C4", duration: 0 }), /voice "n3" "duration"/u);
});

test("the highest and lowest accepted notes still sound on every instrument", () => {
  for (const instrument of ["pad", "epiano", "marimba"] as const) {
    for (const note of ["C0", "C9"]) {
      const samples = renderVoice({ id: "x", at: 0, kind: "note", instrument, note, duration: 0.3 }, { sampleRate: SAMPLE_RATE });
      let peak = 0;
      for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
      assert.ok(peak > 0.4, `${instrument} ${note} peak ${peak}`);
    }
  }
});
