// Mobile performance: a mounted sketch redraws only when its model or params
// change, sleeps while its canvas is off screen, and draws at most 2× density.
import assert from "node:assert/strict";
import { test } from "node:test";
import { attachSketch, setDensity } from "@ianbicking/canvas-loop/browser";
import type { Msg, Util } from "@ianbicking/canvas-loop";
import { asPlaygroundModule } from "../../src/browser/sketch-types.js";
import { FakeElement, asHTMLCanvas, rafState, runFrames } from "./fake-dom.js";

// IntersectionObserver stand-in: the test calls `observed` to say whether the canvas is on screen.
let observed: (onScreen: boolean) => void = () => {};
Object.assign(globalThis, {
  IntersectionObserver: class {
    constructor(cb: (entries: { isIntersecting: boolean }[]) => void) {
      observed = (onScreen) => cb([{ isIntersecting: onScreen }]);
    }
    observe(): void {}
    disconnect(): void {
      observed = () => {};
    }
  },
});

interface Model {
  clicks: number;
  frames: number;
}

function sketch(): { attached: NonNullable<ReturnType<typeof attachSketch>>; counts: { draws: number; ticks: number } } {
  const counts = { draws: 0, ticks: 0 };
  const raw = {
    params: { size: { type: "number", min: 1, max: 10, default: 3 } },
    canvas: { width: 40, height: 40 },
    init: (): Model => ({ clicks: 0, frames: 0 }),
    // eslint-disable-next-line max-params -- TEA contract: update(model, msg, util) is the framework-defined fold signature
    update: (model: Model, msg: Msg, _u: Util): Model => {
      if (msg.type === "tick") counts.ticks += 1;
      // A still figure: ticks and moves return the same model.
      return msg.type === "mousedown" ? { ...model, clicks: model.clicks + 1 } : model;
    },
    draw: (): void => {
      counts.draws += 1;
    },
  };
  const canvas = new FakeElement("canvas");
  canvas.width = 40;
  canvas.height = 40;
  const attached = attachSketch(asHTMLCanvas(canvas), { module: asPlaygroundModule(raw), seed: 1, paused: false, onFrame: () => {} });
  assert.ok(attached !== null);
  return { attached, counts };
}

test("a still figure draws once, then only when the model or a param changes", () => {
  const { attached, counts } = sketch();
  runFrames(30);
  // The first frame only sets the clock, so 30 frames are 29 ticks.
  assert.deepEqual(counts, { draws: 1, ticks: 29 }, "29 ticks, the model unchanged: no redraws");
  attached.runtime.pointer({ type: "mousemove", x: 5, y: 5 });
  runFrames(2);
  // Input always redraws once (the cursor or an over-canvas input may follow it), then rests.
  assert.equal(counts.draws, 2, "a hover redraws once, even with the model unchanged");
  attached.runtime.pointer({ type: "mousedown", x: 5, y: 5 });
  runFrames(2);
  assert.equal(counts.draws, 3, "a click redraws once");
  attached.runtime.setParam("size", 5);
  runFrames(2);
  assert.equal(counts.draws, 4, "a param change redraws once");
  attached.runtime.invalidate();
  runFrames(5);
  assert.equal(counts.draws, 5, "invalidate (a font arrived, a resize) redraws once");
  attached.teardown();
});

test("off screen the loop stops; back on screen it resumes from the same frame", () => {
  const { attached, counts } = sketch();
  runFrames(5);
  observed(false);
  assert.equal(rafState.pending.size, 0, "no frame scheduled while off screen");
  runFrames(20);
  assert.equal(counts.ticks, 4, "time stopped while away");
  observed(true);
  runFrames(3);
  // Resuming sets the clock afresh (one frame), then ticks: no catching up the time away.
  assert.equal(counts.ticks, 6, "resumed without catching up the time away");
  attached.teardown();
  observed(true);
  assert.equal(rafState.pending.size, 0, "after teardown the watcher is gone: nothing restarts the loop");
});

test("density is capped at 2× on a 3× screen", () => {
  Object.assign(globalThis, { devicePixelRatio: 3 });
  const canvas = new FakeElement("canvas");
  setDensity(asHTMLCanvas(canvas), { width: 100, height: 50 });
  assert.deepEqual([canvas.width, canvas.height], [200, 100]);
});
