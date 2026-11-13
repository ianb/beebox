// The browser runtime hands out the same voices, on the same frames, whether
// it runs one tick per animation frame or several to catch up.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Runtime } from "../../../src/browser/runtime/engine.js";
import type { PlaygroundModule } from "../../../src/browser/sketch-types.js";
import type { Msg, Voice } from "../../../src/core/tea.js";
import { FakeElement, rafState } from "../fake-dom.js";

// A new voice every third tick, declared one frame ahead of its start.
const module: PlaygroundModule = {
  canvas: { width: 10, height: 10 },
  init: () => 0,
  update: (model: unknown, msg: Msg) => (msg.type === "tick" ? msg.frame : model),
  draw: () => {},
  sound: (model: unknown): readonly Voice[] => {
    const frame = typeof model === "number" ? model : 0;
    return frame % 3 === 0 ? [{ id: `v${frame}`, at: frame + 1, kind: "noise", duration: 0.05 }] : [];
  },
};

function heard(stepMs: number): string[] {
  const played: string[] = [];
  const canvas = new FakeElement("canvas");
  const ctx = canvas.getContext("2d");
  const runtime = new Runtime({
    module,
    // eslint-disable-next-line no-restricted-syntax -- test boundary: the fake context stands in for the DOM context
    ctx: ctx as CanvasRenderingContext2D,
    width: 10,
    height: 10,
    seed: 1,
    onFrame: () => {},
    onLog: () => {},
    onVoice: (voice) => played.push(`${voice.id}@${voice.at}`),
  });
  runtime.start();
  for (let i = 0; i < 400 / stepMs; i += 1) {
    rafState.now += stepMs;
    for (const [id, cb] of [...rafState.pending.entries()]) {
      rafState.pending.delete(id);
      cb(rafState.now);
    }
  }
  runtime.stop();
  return played;
}

test("voices are the same with one tick per animation frame or several", () => {
  const steady = heard(17);
  assert.ok(steady.length >= 5, steady.join(" "));
  assert.deepEqual(heard(50).slice(0, 5), steady.slice(0, 5));
});
