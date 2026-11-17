// Pointer targets in a headless run (plan:canvas-loop-layout-text-hits.subplan,
// chunk B2): a message at frame N is hit-tested against the scene frame N−1
// drew, since frame N's events dispatch before frame N's draw. Frame 0 has no
// scene, so no targets. The transcript names what each click landed on. An
// entry with a `target` aims at the named drawing's centre (chunk B3), and a
// bad aim stops the run. The scale example (B5) runs its own events file plus
// one click in empty space, which examples:check would fail as unhandled.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { teaRun } from "../../src/headless/tea-runtime/runner.js";
import { toTeaModule } from "../../src/headless/tea-load.js";
import type { Msg, View } from "../../src/core/tea.js";
import { parseTeaEvents } from "../../src/headless/tea-events.js";
import * as scaleTea from "../../src/examples/scale-tea.js";
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

test("a target entry clicks the named drawing's centre; a later move keeps the point; a bad aim stops the run", async () => {
  const seen: string[] = [];
  const module = toTeaModule({
    canvas: { width: 100, height: 60 },
    init: () => ({}),
    update: (model: object, msg: Msg): object => {
      if (msg.type === "mousedown" || msg.type === "mousemove") seen.push(`${msg.type} ${msg.x},${msg.y} ${msg.targets.join("/")}`);
      return model;
    },
    draw: (v: View) => [v.rect(10, 10, 20, 20, { fill: "#000", name: "left" }), v.at({ translate: [60, 10], name: "right" }, v.circle(10, 10, 10, { stroke: "#000", weight: 2, name: "ring" }))],
  });
  const ok = tmpDir();
  await teaRun(teaRunOptions(module, { outDir: ok, frames: 3, events: [{ frame: 1, type: "mousedown", target: "left" }, { frame: 2, type: "mousemove" }] }));
  assert.deepEqual(seen, ["mousedown 20,20 left", "mousemove 20,20 left"]);
  assert.match(readTranscript(ok), /mousedown \(20,20\) on left/);
  const bad = tmpDir();
  const result = await teaRun(teaRunOptions(module, { outDir: bad, frames: 3, events: [{ frame: 1, type: "mousedown", target: "ring" }] }));
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0] ?? "", /frame 1: mousedown target "ring": its centre \(70,20\) lands on no named drawing; aim with x and y/);
});

test("the scale example adds weights by pan name and removes a nested weight", async () => {
  const module = toTeaModule(scaleTea);
  const own = parseTeaEvents(JSON.parse(readFileSync(fileURLToPath(new URL("../../src/examples/scale-tea-events.json", import.meta.url)), "utf8")), module.params);
  const events = [...own, { frame: 75, type: "mousedown" as const, x: 240, y: 20 }];
  const dir = tmpDir();
  const result = await teaRun(teaRunOptions(module, { outDir: dir, frames: 90, events }));
  assert.deepEqual(result.errors, []);
  const lines = readTranscript(dir).split("\n").filter((l) => l.includes("mousedown")).map((l) => l.replace(/\(\d+,\d+\) /u, ""));
  assert.deepEqual(lines, [
    "**[frame 10]** mousedown on pan-left → add-weight-left",
    "**[frame 20]** mousedown on pan-left → add-weight-left",
    "**[frame 30]** mousedown on pan-right → add-weight-right",
    "**[frame 40]** mousedown on pan-left → add-weight-left",
    "**[frame 60]** mousedown on weight-2 in pan-left → remove-weight",
    "**[frame 75]** mousedown → (unhandled)",
  ]);
});
