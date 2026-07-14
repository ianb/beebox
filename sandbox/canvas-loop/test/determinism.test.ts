import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { parseEvents } from "../src/events.js";
import { run } from "../src/runtime.js";
import type { SketchModule } from "../src/types.js";
import * as bounce from "../examples/bounce.js";
import { readDirBytes, runOptions, tmpDir } from "./helpers.js";

const eventsJson = fileURLToPath(new URL("../examples/bounce-events.json", import.meta.url));
const module: SketchModule = bounce;

test("two runs of the same sketch produce byte-identical output", () => {
  const events = parseEvents(JSON.parse(readFileSync(eventsJson, "utf8")));
  const dirA = tmpDir();
  const dirB = tmpDir();
  run(runOptions(module, { outDir: dirA, frames: 120, events }));
  run(runOptions(module, { outDir: dirB, frames: 120, events }));

  const a = readDirBytes(dirA);
  const b = readDirBytes(dirB);
  assert.deepEqual([...a.keys()], [...b.keys()], "same set of output files");
  assert.ok(a.size > 1, "produced frames plus a transcript");
  for (const [name, bytesA] of a) {
    const bytesB = b.get(name);
    assert.ok(bytesB !== undefined, `${name} exists in both runs`);
    assert.equal(Buffer.compare(bytesA, bytesB), 0, `${name} is byte-identical`);
  }
});

test("a different seed changes the output", () => {
  const dir42 = tmpDir();
  const dir7 = tmpDir();
  run(runOptions(module, { outDir: dir42, frames: 40, seed: 42 }));
  run(runOptions(module, { outDir: dir7, frames: 40, seed: 7 }));
  const first = readDirBytes(dir42).get("frame-0030.png");
  const second = readDirBytes(dir7).get("frame-0030.png");
  assert.ok(first !== undefined && second !== undefined, "both runs captured frame 30");
  assert.notEqual(Buffer.compare(first, second), 0, "seed changes the seeded launch velocity");
});
