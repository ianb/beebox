// Replaying an events file in the browser runtime runs the same folds and
// draws, frame by frame, as a headless run of the same events.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Runtime } from "../../../src/browser/runtime/engine.js";
import type { PlaygroundModule } from "../../../src/browser/sketch-types.js";
import type { Msg, ParamsDecl } from "../../../src/core/tea.js";
import { parseTeaEvents } from "../../../src/headless/tea-events.js";
import { teaRun } from "../../../src/headless/tea-runtime.js";
import { toTeaModule } from "../../../src/headless/tea-load.js";
import { teaRunOptions, tmpDir } from "../../helpers.js";
import { FakeElement } from "../fake-dom.js";

const params = { size: { type: "number", default: 3, min: 1, max: 10 } } as const satisfies ParamsDecl;

// The model accumulates every input; draw records what it saw each frame.
function sketch(drawn: string[]): PlaygroundModule {
  return {
    canvas: { width: 20, height: 20 },
    params,
    init: () => [],
    update: (...[model, msg, u]: [unknown, Msg, { handled: (name: string) => void }]) => {
      const list = Array.isArray(model) ? model : [];
      if (msg.type === "tick") return msg.frame % 5 === 0 ? [...list, `t${msg.frame}`] : model;
      if (msg.type === "mousedown") {
        u.handled("press");
        return [...list, `down${msg.x}`];
      }
      if (msg.type === "param") return [...list, `${msg.name}=${String(msg.value)}`];
      return model;
    },
    draw: (_v: unknown, model: unknown) => void drawn.push(JSON.stringify(model)),
  };
}

const events = [
  { frame: 2, type: "mousedown", x: 4, y: 4 },
  { frame: 2, type: "mouseup", x: 4, y: 4 },
  { frame: 3, type: "mouseup", x: 5, y: 5 },
  { frame: 6, type: "param", name: "size", value: 7 },
  { frame: 8, type: "mouseup", x: 6, y: 6 },
];

test("a browser replay draws what a headless run draws, frame by frame", () => {
  const headless: string[] = [];
  const outDir = tmpDir();
  teaRun(teaRunOptions(toTeaModule({ ...sketch(headless) }), { outDir, frames: 9, events: parseTeaEvents(events, params) }));

  const replayed: string[] = [];
  const logs: string[] = [];
  const canvas = new FakeElement("canvas");
  const runtime = new Runtime({
    module: sketch(replayed),
    // eslint-disable-next-line no-restricted-syntax -- test boundary: the fake context stands in for the DOM context
    ctx: canvas.getContext("2d") as CanvasRenderingContext2D,
    width: 20,
    height: 20,
    seed: 42,
    onFrame: () => {},
    onLog: (entry) => logs.push(`${entry.frame}: ${entry.message}`),
    script: { events: parseTeaEvents(events, params) },
  });
  assert.deepEqual(replayed, headless);
  assert.equal(runtime.paused, true);
  assert.deepEqual(logs, [
    "2: mousedown (4,4) → press",
    "2: mouseup (4,4) → (unhandled)",
    "6: param: size = 7",
    "8: mouseup: 2 more unhandled (not listed)",
  ]);
});

test("a replay runs through the frame asked for", () => {
  const drawn: string[] = [];
  const canvas = new FakeElement("canvas");
  // eslint-disable-next-line no-restricted-syntax -- test boundary: the fake context stands in for the DOM context
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  new Runtime({ module: sketch(drawn), ctx, width: 20, height: 20, seed: 42, onFrame: () => {}, onLog: () => {}, script: { events: [], frame: 10 } });
  assert.equal(drawn.length, 11);
});
