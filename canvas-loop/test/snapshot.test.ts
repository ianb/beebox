import assert from "node:assert/strict";
import { test } from "node:test";
import { EventScriptError } from "../src/headless/errors.js";
import { parseEvents } from "../src/headless/events.js";
import { run } from "../src/headless/runtime.js";
import type { SketchModule } from "../src/headless/sketch.js";
import { parseTeaEvents } from "../src/headless/tea-events.js";
import { teaRun } from "../src/headless/tea-runtime.js";
import type { LoadedTeaModule } from "../src/headless/tea-load.js";
import type { ParamsDecl } from "../src/core/tea.js";
import { readDirBytes, readTranscript, runOptions, teaRunOptions, tmpDir } from "./helpers.js";

// A mutable sketch whose pixels move with frameCount, so an unperturbed run is
// a meaningful thing to diff against.
const mover: SketchModule = {
  setup: (s) => s.createCanvas(50, 50),
  draw: (s) => {
    s.background("#000000");
    s.fill("#ffffff");
    s.circle(s.frameCount * 4, 25, 8);
  },
};

test("a scripted snapshot event forces a capture with its label (mutable tier)", () => {
  const dir = tmpDir();
  // frames 0..9, every=30 → only frames 0 and 9 capture on their own. The
  // snapshot pulls frame 5 into the transcript with a labeled heading.
  run(runOptions(mover, { outDir: dir, frames: 10, every: 30, events: [{ frame: 5, type: "snapshot", label: "midway" }] }));
  const transcript = readTranscript(dir);
  assert.match(transcript, /### frame 5 — midway/, "labeled snapshot frame appears in the transcript");
});

test("a snapshot event captures without perturbing state (mutable tier)", () => {
  const plain = tmpDir();
  const snapped = tmpDir();
  run(runOptions(mover, { outDir: plain, frames: 10, every: 30, events: [] }));
  run(runOptions(mover, { outDir: snapped, frames: 10, every: 30, events: [{ frame: 5, type: "snapshot" }] }));
  const plainFrames = readDirBytes(plain);
  const snappedFrames = readDirBytes(snapped);
  // Every frame the plain run captured is byte-identical in the snapshot run;
  // the snapshot only ADDS frame-0005.png, it changes nothing else.
  for (const [name, bytes] of plainFrames) {
    if (name === "transcript.md") continue;
    assert.deepEqual(snappedFrames.get(name), bytes, `${name} is unchanged by the snapshot`);
  }
  assert.ok(snappedFrames.has("frame-0005.png"), "the snapshot added its frame");
});

test("a scripted snapshot event forces a capture with its label (TEA tier)", () => {
  const params: ParamsDecl = {};
  const module: LoadedTeaModule = {
    params,
    canvas: { width: 40, height: 40 },
    init: () => ({}),
    update: (model) => model,
    draw: (v) => {
      v.background("#101010");
    },
  };
  const dir = tmpDir();
  teaRun(teaRunOptions(module, { outDir: dir, frames: 10, every: 30, events: [{ frame: 5, type: "snapshot", label: "midway" }] }));
  assert.match(readTranscript(dir), /### frame 5 — midway/, "labeled TEA snapshot frame appears");
});

test("both parsers accept a snapshot (with and without label) and reject a non-string label", () => {
  const mutable = parseEvents([
    { frame: 3, type: "snapshot" },
    { frame: 7, type: "snapshot", label: "peak" },
  ]);
  assert.deepEqual(mutable, [
    { frame: 3, type: "snapshot" },
    { frame: 7, type: "snapshot", label: "peak" },
  ]);

  const tea = parseTeaEvents(
    [
      { frame: 3, type: "snapshot" },
      { frame: 7, type: "snapshot", label: "peak" },
    ],
    {},
  );
  assert.deepEqual(tea, [
    { frame: 3, type: "snapshot" },
    { frame: 7, type: "snapshot", label: "peak" },
  ]);

  assert.throws(
    () => parseEvents([{ frame: 1, type: "snapshot", label: 5 }]),
    (e: unknown) => e instanceof EventScriptError && e.message.includes('"label" must be a string'),
  );
  assert.throws(
    () => parseTeaEvents([{ frame: 1, type: "snapshot", label: 5 }], {}),
    (e: unknown) => e instanceof EventScriptError && e.message.includes('"label" must be a string'),
  );
});
