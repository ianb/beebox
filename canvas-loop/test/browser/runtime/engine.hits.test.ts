// Which scene the browser runtime hit-tests a pointer message against
// (plan:canvas-loop-layout-text-hits.subplan, chunk B2): the scene of the state
// at the end of the last frame run, as headless. The last draw's scene counts
// when it was drawn from that state (a still figure keeps its constructor's
// draw); a paused draw does not, and a state with no draw is recorded again,
// once, without being shown. A fake surface names each scene by its model.
import assert from "node:assert/strict";
import { before, test } from "node:test";
import { Runtime } from "../../../src/browser/runtime/engine.js";
import type { DrawSurface, EmittedEvent } from "../../../src/browser/runtime/engine.js";
import type { PlaygroundModule } from "../../../src/browser/sketch-types.js";
import type { Msg } from "../../../src/core/tea.js";
import type { TextMeasure, TextMeasurer } from "../../../src/core/text/measure.js";
import { openTextMeasurer } from "../../../src/device/open.js";
import type { Scene } from "../../../src/scene/nodes.js";
import { SceneRecorder } from "../../../src/scene/recorder/view.js";
import { rafState } from "../../fake-dom.js";

let text: TextMeasurer | undefined;
before(async () => {
  text = await openTextMeasurer();
});

const textMeasure: TextMeasure = { width: () => 0, bounds: (_content, box) => ({ x: box.x, y: box.y, w: 0, h: 0, lines: 0, size: 0, overflow: false }) };

/** A model that counts clicks; ticks change nothing, so the figure is still. */
const module: PlaygroundModule = {
  canvas: { width: 10, height: 10 },
  init: () => 0,
  update: (model: unknown, msg: Msg) => (msg.type === "mousedown" && typeof model === "number" ? model + 1 : model),
  draw: () => null,
};

/** A surface whose scene is one rect over the canvas named `m<model>`; it notes the models it drew and recorded for hits. */
function fakeSurface(): { draws: unknown[]; records: unknown[]; surface: () => DrawSurface } {
  const t = text;
  if (t === undefined) throw new Error("no text measurer");
  const recorder = new SceneRecorder({ width: 10, height: 10 }, { text: t });
  const scene = (model: unknown): Scene => recorder.record((v) => v.rect(0, 0, 10, 10, { fill: "#000", name: `m${String(model)}` })).scene;
  const draws: unknown[] = [];
  const records: unknown[] = [];
  const surface: DrawSurface = {
    textMeasure,
    forgetTextWidths: () => {},
    draw: (model) => {
      draws.push(model);
      return { placements: new Map(), scene: scene(model) };
    },
    recordScene: (model) => {
      records.push(model);
      return scene(model);
    },
  };
  return { draws, records, surface: () => surface };
}

/** One animation frame, a frame's time after the last. */
function step(): void {
  rafState.now += 17;
  for (const [id, cb] of [...rafState.pending.entries()]) {
    rafState.pending.delete(id);
    cb(rafState.now);
  }
}

function start(): { runtime: Runtime; fake: ReturnType<typeof fakeSurface>; events: EmittedEvent[]; frame: () => number } {
  const fake = fakeSurface();
  const events: EmittedEvent[] = [];
  let frame = 0;
  const runtime = new Runtime({ module, surface: fake.surface, seed: 1, onFrame: (f) => void (frame = f), onLog: () => {}, onEvent: (e) => void events.push(e) });
  runtime.start();
  // The loop's first animation frame only notes the time.
  step();
  return { runtime, fake, events, frame: () => frame };
}

const click = { type: "mousedown", x: 5, y: 5 } as const;

test("a click at frame 0 has no targets", () => {
  const { runtime, events } = start();
  runtime.pointer(click);
  step();
  assert.equal(events[0]?.frame, 0);
  assert.deepEqual(events[0]?.targets, []);
  runtime.stop();
});

test("a still figure's first click at frame 100 uses the constructor's draw", () => {
  const { runtime, fake, events, frame } = start();
  while (frame() < 100) step();
  runtime.pointer(click);
  step();
  assert.equal(events[0]?.frame, 100);
  assert.deepEqual(events[0]?.targets, ["m0"]);
  assert.deepEqual(fake.draws, [0, 1], "the constructor's draw, then the click's");
  assert.deepEqual(fake.records, [], "no extra record: the kept draw is of the frame's end state");
  runtime.stop();
});

test("a paused draw does not become the hit scene; the end state is recorded again once", () => {
  const { runtime, fake, events } = start();
  for (let i = 0; i < 5; i++) step();
  runtime.setPaused(true);
  for (let i = 0; i < 3; i++) {
    runtime.pointer(click);
    step();
  }
  // Each paused click drew the new count at once, but the frame did not move.
  assert.deepEqual(fake.draws, [0, 1, 2, 3]);
  assert.deepEqual(events.map((e) => e.targets), [["m0"], ["m0"], ["m0"]]);
  assert.deepEqual(fake.records, [0], "the first mismatch records the end state; later clicks reuse it");
  runtime.setPaused(false);
  step();
  step();
  runtime.pointer(click);
  step();
  assert.deepEqual(events[3]?.targets, ["m3"], "running again, the end state is the latest model");
  runtime.stop();
});

test("only mouse entries carry targets", () => {
  const { runtime, events } = start();
  step();
  runtime.key({ type: "keydown", key: "a" });
  step();
  assert.equal(events[0]?.type, "keydown");
  assert.equal(events[0] !== undefined && "targets" in events[0], false);
  runtime.stop();
});
