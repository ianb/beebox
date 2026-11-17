// Frame pacing: on a 60 Hz display whose frame timestamps wander by a
// millisecond or two, every animation frame runs one step and draws once.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Runtime, frameTime } from "../../../src/browser/runtime/engine.js";
import type { PlaygroundModule } from "../../../src/browser/sketch-types.js";
import type { Msg } from "../../../src/core/tea.js";
import type { TextMeasure } from "../../../src/core/text/measure.js";
import type { Scene } from "../../../src/scene/nodes.js";
import { rafState } from "../../fake-dom.js";

const EMPTY: Scene = { width: 10, height: 10, children: [] };
const textMeasure: TextMeasure = { width: () => 0, bounds: (_content, box) => ({ x: box.x, y: box.y, w: 0, h: 0, lines: 0, size: 0, overflow: false }) };
const module: PlaygroundModule = {
  canvas: { width: 10, height: 10 },
  init: () => 0,
  update: (model: unknown, msg: Msg) => (msg.type === "tick" ? msg.frame + 1 : model),
  draw: () => null,
};

/** How many times `draw` ran for each animation frame, given the frames' intervals. */
function drawsPerFrame(intervals: readonly number[]): number[] {
  let draws = 0;
  const runtime = new Runtime({
    module,
    surface: () => ({ textMeasure, forgetTextWidths: () => {}, draw: () => { draws += 1; return { placements: new Map(), scene: EMPTY }; }, recordScene: () => EMPTY }),
    seed: 1,
    onFrame: () => {},
    onLog: () => {},
  });
  runtime.start();
  const out: number[] = [];
  for (const dt of [16.7, ...intervals]) {
    rafState.now += dt;
    const before = draws;
    for (const [id, cb] of [...rafState.pending.entries()]) {
      rafState.pending.delete(id);
      cb(rafState.now);
    }
    out.push(draws - before);
  }
  runtime.stop();
  return out.slice(1);
}

test("a 60 Hz frame whose timestamp wanders still runs one step and one draw", () => {
  // Measured in Chrome: pairs of 15.2 and 18.2 ms among 16.7 ms frames.
  const jitter = Array.from({ length: 120 }, (_, i) => (i % 7 === 3 ? 15.1 : i % 7 === 4 ? 18.2 : 16.67));
  const draws = drawsPerFrame(jitter);
  assert.deepEqual(draws.filter((n) => n !== 1), [], `frames with no draw or a double step: ${draws.join("")}`);
});

test("frame time snaps only near a whole number of steps", () => {
  const step = 1000 / 60;
  assert.equal(frameTime(15.2), step);
  assert.equal(frameTime(18.4), step);
  assert.equal(frameTime(33), 2 * step, "a missed frame is two steps");
  assert.equal(frameTime(8.33), 8.33, "120 Hz keeps its time");
  assert.equal(frameTime(6.94), 6.94, "144 Hz keeps its time");
  assert.equal(frameTime(25), 25);
});
