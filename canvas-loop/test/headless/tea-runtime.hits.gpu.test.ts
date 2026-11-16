// Pointer targets in a headless run (plan:canvas-loop-layout-text-hits.subplan,
// chunk B2): a message at frame N is hit-tested against the scene frame N−1
// drew, since frame N's events dispatch before frame N's draw. Frame 0 has no
// scene, so no targets. The transcript names what each click landed on.
import assert from "node:assert/strict";
import { test } from "node:test";
import { teaRun } from "../../src/headless/tea-runtime/runner.js";
import { toTeaModule } from "../../src/headless/tea-load.js";
import type { Msg, View } from "../../src/core/tea.js";
import { readTranscript, teaRunOptions, tmpDir } from "../helpers.js";

interface Model {
  readonly frame: number;
  readonly clicks: number;
}

test("targets come from the scene of frame N−1: none at frame 0, and the same for every event of one frame", async () => {
  const seen: string[][] = [];
  const module = toTeaModule({
    canvas: { width: 20, height: 20 },
    init: (): Model => ({ frame: -1, clicks: 0 }),
    update: (model: Model, msg: Msg): Model => {
      if (msg.type === "tick") return { ...model, frame: msg.frame };
      if (msg.type === "mousedown") {
        seen.push([...msg.targets]);
        assert.equal(msg.target, msg.targets[0]);
        return { ...model, clicks: model.clicks + 1 };
      }
      return model;
    },
    // One rect over the canvas, inside an `at` named for the whole figure.
    draw: (v: View, model: Model) => v.at({ name: "figure" }, v.rect(0, 0, 20, 20, { fill: "#000", name: `f${model.frame}c${model.clicks}` })),
  });
  const dir = tmpDir();
  await teaRun(
    teaRunOptions(module, {
      outDir: dir,
      frames: 6,
      events: [
        { frame: 0, type: "mousedown", x: 5, y: 5 },
        { frame: 5, type: "mousedown", x: 5, y: 5 },
        { frame: 5, type: "mousedown", x: 6, y: 6 },
        { frame: 5, type: "mousedown", x: 30, y: 30 },
      ],
    }),
  );
  assert.deepEqual(seen, [[], ["f4c1", "figure"], ["f4c1", "figure"], []]);
  const transcript = readTranscript(dir);
  assert.match(transcript, /mousedown \(5,5\) on f4c1 in figure/);
  assert.match(transcript, /mousedown \(30,30\)(?! on)/);
});
