// The sample library: the generated data matches the catalog, μ-law decodes
// close to the original, and sample voices render, wrap and speed up.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { SAMPLE_DATA, bundledLibrary } from "../../../src/core/sound/library/bundled.generated.js";
import { LIBRARY_RATE, SAMPLES, SAMPLE_NAMES } from "../../../src/core/sound/library/catalog.js";
import { decodeMuLaw, encodeMuLaw } from "../../../src/core/sound/library/mulaw.js";
import { MissingLibraryError, SAMPLE_RATE, mix, renderVoice } from "../../../src/core/sound/synth.js";
import { assertVoice } from "../../../src/core/sound/voice.js";
import type { Voice } from "../../../src/core/sound/voice.js";

test("the generated data has every catalog name with one take per source (rebuild with pnpm sounds:build)", () => {
  assert.deepEqual(Object.keys(SAMPLE_DATA), [...SAMPLE_NAMES]);
  for (const [name, entry] of Object.entries(SAMPLES)) assert.equal(SAMPLE_DATA[name]?.length, entry.sources.length, name);
  for (const [name, takes] of bundledLibrary()) for (const take of takes) assert.ok(take.length > LIBRARY_RATE * 0.004, `${name} has sound`);
});

test("μ-law round-trips within its quantization step", () => {
  const samples = new Float32Array([0, 0.001, -0.001, 0.25, -0.5, 0.9, -1]);
  for (const [i, decoded] of decodeMuLaw(encodeMuLaw(samples)).entries()) {
    const original = samples[i] ?? 0;
    assert.ok(Math.abs(decoded - original) <= Math.max(0.0005, Math.abs(original) * 0.07), `${original} → ${decoded}`);
  }
});

test("a sample voice plays its take at the output rate; variant wraps and rate shortens", () => {
  const library = bundledLibrary();
  const take = library.get("ding")?.[1];
  assert.ok(take !== undefined);
  const render = (voice: { variant: number; rate?: number }): Float32Array => renderVoice({ id: "d", at: 0, kind: "sample", name: "ding", ...voice }, { sampleRate: SAMPLE_RATE, library });
  const one = render({ variant: 1 });
  assert.ok(Math.abs(one.length - (take.length * SAMPLE_RATE) / LIBRARY_RATE) <= 2);
  assert.deepEqual(render({ variant: 1 + SAMPLES.ding.sources.length }), one, "variant wraps");
  assert.ok(Math.abs(render({ variant: 1, rate: 2 }).length - one.length / 2) <= 2, "rate 2 is half as long");
});

test("sample voices are checked against the catalog, and need the library to render", () => {
  // eslint-disable-next-line no-restricted-syntax -- deliberately wrong input: a sound the library lacks
  const buzz = { id: "s1", at: 0, kind: "sample", name: "bee-buzz" } as unknown as Voice;
  assert.throws(() => assertVoice(buzz), /voice "s1" "name" must be a library sound \(got "bee-buzz"\); the sounds are: ding, chime/u);
  assert.throws(() => assertVoice({ id: "s2", at: 0, kind: "sample", name: "pop", rate: 3 }), /voice "s2" "rate" must be 0.5..2/u);
  assert.throws(() => assertVoice({ id: "s3", at: 0, kind: "sample", name: "pop", variant: -1 }), /voice "s3" "variant"/u);
  assert.throws(() => mix([{ id: "s4", at: 0, kind: "sample", name: "pop" }], { frames: 10, fps: 60, sampleRate: SAMPLE_RATE }), MissingLibraryError);
});

test("TEA.md lists every sample name and instrument", () => {
  const doc = readFileSync(new URL("../../../TEA.md", import.meta.url), "utf8");
  for (const name of SAMPLE_NAMES) assert.ok(doc.includes(`\`${name}\``), `TEA.md lists ${name}`);
});
