import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SAMPLE_RATE,
  encodeWav,
  mix,
  renderVoice,
} from "../../../src/core/sound/synth.js";
import type { Voice } from "../../../src/core/sound/voice.js";

const pluck: Voice = { id: "a", at: 0, kind: "pluck", freq: 220 };

test("a voice renders the same samples every time, and its id seeds the noise", () => {
  const one = renderVoice(pluck, { sampleRate: SAMPLE_RATE });
  assert.deepEqual(renderVoice(pluck, { sampleRate: SAMPLE_RATE }), one);
  assert.notDeepEqual(renderVoice({ ...pluck, id: "b" }, { sampleRate: SAMPLE_RATE }), one);
  assert.equal(one.length, 2 * SAMPLE_RATE, "default decay is 2 s");
});

test("a pluck fades away and has the pitch's period", () => {
  const samples = renderVoice({ ...pluck, freq: 441 }, { sampleRate: SAMPLE_RATE });
  const peak = (from: number, to: number): number =>
    Math.max(...samples.slice(from, to).map(Math.abs));
  assert.ok(peak(0, 4410) > 0.1);
  assert.ok(
    peak(SAMPLE_RATE * 1.9, SAMPLE_RATE * 2) < peak(0, 4410) / 50,
    "quiet near the end",
  );
  // 441 Hz at 44100 Hz repeats every 100 samples (almost exactly, early on).
  const a = samples.slice(1000, 1100);
  const b = samples.slice(1100, 1200);
  let total = 0;
  for (const [i, value] of a.entries()) total += Math.abs(value - (b[i] ?? 0));
  const diff = total / 100;
  assert.ok(diff < 0.02, `period mismatch ${diff}`);
});

test("tones and noise last their duration", () => {
  assert.equal(
    renderVoice(
      { id: "t", at: 0, kind: "tone", freq: 440, duration: 0.5 },
      { sampleRate: SAMPLE_RATE },
    ).length,
    SAMPLE_RATE / 2,
  );
  assert.equal(
    renderVoice({ id: "n", at: 0, kind: "noise", duration: 0.1 }, { sampleRate: SAMPLE_RATE })
      .length,
    SAMPLE_RATE / 10,
  );
});

test("pink and brown noise are as loud as white at their peaks and duller; an attack swells in, then falls away", () => {
  const render = (color: "white" | "pink" | "brown"): Float32Array => renderVoice({ id: "n", at: 0, kind: "noise", duration: 1, color, gain: 1, attack: 0.5 }, { sampleRate: SAMPLE_RATE });
  // How much of the signal is sample-to-sample change: high frequencies.
  const roughness = (s: Float32Array): number => {
    let diff = 0;
    let level = 0;
    for (let i = 1; i < s.length; i++) {
      diff += Math.abs((s[i] ?? 0) - (s[i - 1] ?? 0));
      level += Math.abs(s[i] ?? 0);
    }
    return diff / level;
  };
  const [white, pink, brown] = [render("white"), render("pink"), render("brown")];
  for (const s of [white, pink, brown]) {
    const peak = Math.max(...s.map(Math.abs));
    assert.ok(peak > 0.3 && peak <= 1, `peak ${peak}`);
  }
  assert.ok(roughness(white) > roughness(pink) && roughness(pink) > roughness(brown), `${roughness(white)} > ${roughness(pink)} > ${roughness(brown)}`);
  const level = ([from, to]: readonly [number, number]): number => Math.max(...pink.slice(from * SAMPLE_RATE, to * SAMPLE_RATE).map(Math.abs));
  assert.ok(level([0, 0.05]) < 0.05 && level([0.45, 0.55]) > 4 * level([0, 0.05]) && level([0.95, 1]) < 0.05, "silent at both ends, loudest at the attack's end");
});

test("mix places voices at their frame, cuts at the end, and never clips", () => {
  const voices: Voice[] = [
    { id: "x", at: 30, kind: "tone", freq: 440, duration: 1, gain: 1 },
    { id: "y", at: 30, kind: "tone", freq: 440, duration: 1, gain: 1 },
    { id: "late", at: 600, kind: "noise", duration: 0.1 },
  ];
  const out = mix(voices, { frames: 120, fps: 60, sampleRate: SAMPLE_RATE });
  assert.equal(out.length, 2 * SAMPLE_RATE);
  assert.equal(
    Math.max(...out.slice(0, SAMPLE_RATE / 2 - 1).map(Math.abs)),
    0,
    "silent before frame 30",
  );
  assert.ok(Math.max(...out.map(Math.abs)) <= 1);
});

test("a WAV has a 44-byte PCM header and two bytes a sample", () => {
  const bytes = encodeWav(new Float32Array([0, 1, -1]), 8000);
  const text =
    new TextDecoder().decode(bytes.slice(0, 4)) +
    new TextDecoder().decode(bytes.slice(8, 12));
  assert.equal(text, "RIFFWAVE");
  assert.equal(bytes.length, 50);
  const view = new DataView(bytes.buffer);
  assert.deepEqual(
    [
      view.getUint32(24, true),
      view.getInt16(46, true),
      view.getInt16(48, true),
    ],
    [8000, 32_767, -32_767],
  );
});
