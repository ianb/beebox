import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { Msg } from "../../src/core/tea.js";
import type { Voice } from "../../src/core/sound/voice.js";
import { teaRun } from "../../src/headless/tea-runtime.js";
import type { LoadedTeaModule } from "../../src/headless/tea-load.js";
import { readTranscript, teaRunOptions, tmpDir } from "../helpers.js";

interface Model {
  plucks: readonly number[];
}

/** The loaded-module boundary hands models back as `unknown`; this test's model is always a Model. */
function asModel(model: unknown): Model {
  // eslint-disable-next-line no-restricted-syntax -- loaded-module boundary: the runtime passes back the Model this test's init made
  return model as Model;
}

// Plucks a string on frames 10 and 40; each pluck is its own voice.
const module: LoadedTeaModule = {
  params: {},
  canvas: { width: 20, height: 20 },
  init: (): Model => ({ plucks: [] }),
  update: (model, msg: Msg) => {
    const m = asModel(model);
    if (msg.type === "tick" && (msg.frame === 10 || msg.frame === 40)) return { plucks: [...m.plucks, msg.frame] };
    return m;
  },
  draw: () => {},
  sound: (model): readonly Voice[] => asModel(model).plucks.map((at, i) => ({ id: `pluck-${i}`, at, kind: "pluck", freq: 196 })),
};

test("a run's voices become sound.wav, sound.png and transcript lines, the same bytes every run", () => {
  const a = tmpDir();
  const b = tmpDir();
  assert.deepEqual(teaRun(teaRunOptions(module, { outDir: a, frames: 60 })).errors, []);
  teaRun(teaRunOptions(module, { outDir: b, frames: 60 }));
  const wav = readFileSync(join(a, "sound.wav"));
  assert.ok(wav.equals(readFileSync(join(b, "sound.wav"))), "deterministic");
  assert.equal(wav.length, 44 + 44_100 * 2, "one second of 16-bit mono");
  assert.ok(readFileSync(join(a, "sound.png")).length > 0);
  const transcript = readTranscript(a);
  assert.match(transcript, /sound pluck "pluck-0" 196 Hz/u);
  assert.match(transcript, /sound pluck "pluck-1" 196 Hz/u);
});

test("a longer run keeps the shorter run's audio as its prefix", () => {
  const short = tmpDir();
  const long = tmpDir();
  teaRun(teaRunOptions(module, { outDir: short, frames: 30 }));
  teaRun(teaRunOptions(module, { outDir: long, frames: 60 }));
  const s = readFileSync(join(short, "sound.wav")).subarray(44);
  const l = readFileSync(join(long, "sound.wav")).subarray(44);
  assert.ok(l.subarray(0, s.length).equals(s));
});

test("a run with no sound writes no sound files", () => {
  const dir = tmpDir();
  teaRun(teaRunOptions({ ...module, sound: () => [] }, { outDir: dir, frames: 5 }));
  assert.throws(() => readFileSync(join(dir, "sound.wav")));
});
