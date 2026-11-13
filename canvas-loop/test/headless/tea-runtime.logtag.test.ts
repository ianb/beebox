import assert from "node:assert/strict";
import { test } from "node:test";
import { teaRun } from "../../src/headless/tea-runtime.js";
import { toTeaModule } from "../../src/headless/tea-load.js";
import type { Msg } from "../../src/core/tea.js";
import { readTranscript, teaRunOptions, tmpDir } from "../helpers.js";

const module = toTeaModule({
  canvas: { width: 20, height: 20 },
  init: () => ({ frame: 0 }),
  update: (model: { frame: number }, msg: Msg) => (msg.type === "tick" ? { frame: msg.frame } : model),
  draw: (v: { background: (c: string) => void; log: (...a: unknown[]) => void }, model: { frame: number }) => {
    v.background("#000000");
    if (model.frame === 2) console.log("via-console");
    if (model.frame === 3) v.log("via-log");
  },
});

test("log lines are tagged with the frame they happened during", () => {
  const dir = tmpDir();
  teaRun(teaRunOptions(module, { outDir: dir, frames: 5 }));
  const transcript = readTranscript(dir);
  assert.ok(transcript.includes("**[frame 2]** log: via-console"), "console.log routed and tagged");
  assert.ok(transcript.includes("**[frame 3]** log: via-log"), "v.log() tagged with its frame");
});
