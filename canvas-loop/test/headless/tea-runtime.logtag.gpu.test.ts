import assert from "node:assert/strict";
import { test } from "node:test";
import { teaRun } from "../../src/headless/tea-runtime/runner.js";
import { toTeaModule } from "../../src/headless/tea-load.js";
import type { Msg } from "../../src/core/tea.js";
import { readTranscript, teaRunOptions, tmpDir } from "../helpers.js";

const module = toTeaModule({
  canvas: { width: 20, height: 20 },
  init: () => ({ frame: 0 }),
  update: (model: { frame: number }, msg: Msg) => (msg.type === "tick" ? { frame: msg.frame } : model),
  draw: (v: { background: (c: string) => unknown; log: (...a: unknown[]) => void }, model: { frame: number }) => {
    if (model.frame === 2) console.log("via-console");
    if (model.frame === 3) v.log("via-log");
    return v.background("#000000");
  },
});

test("log lines are tagged with the frame they happened during", async () => {
  const dir = tmpDir();
  await teaRun(teaRunOptions(module, { outDir: dir, frames: 5 }));
  const transcript = readTranscript(dir);
  assert.ok(transcript.includes("**[frame 2]** log: via-console"), "console.log routed and tagged");
  assert.ok(transcript.includes("**[frame 3]** log: via-log"), "v.log() tagged with its frame");
});

test("logs before a draw that throws reach the transcript, in call order with console output", async () => {
  const failing = toTeaModule({
    canvas: { width: 20, height: 20 },
    init: () => ({}),
    update: (model: object) => model,
    draw: (v: { log: (...a: unknown[]) => void }) => {
      v.log("first");
      console.log("second");
      v.log("third");
      throw new RangeError("boom");
    },
  });
  const dir = tmpDir();
  const result = await teaRun(teaRunOptions(failing, { outDir: dir, frames: 1 }));
  assert.equal(result.errors.length, 1);
  const transcript = readTranscript(dir);
  const at = ["log: first", "log: second", "log: third", "error in draw: RangeError: boom"].map((line) => transcript.indexOf(line));
  assert.ok(at.every((i, k) => i >= 0 && (k === 0 || i > (at[k - 1] ?? 0))), `in call order: ${JSON.stringify(at)}\n${transcript}`);
});
