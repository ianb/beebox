import assert from "node:assert/strict";
import { test } from "node:test";
import type { DeepReadonly, Msg, Util } from "../../src/core/tea.js";
import { parseTeaEvents } from "../../src/headless/tea-events.js";
import { toTeaModule } from "../../src/headless/tea-load.js";
import { teaRun } from "../../src/headless/tea-runtime.js";
import { readTranscript, teaRunOptions, tmpDir } from "../helpers.js";

interface Model {
  picks: number;
}

const sketch = toTeaModule({
  params: { mode: { type: "select", options: ["a", "b"], default: "a" } },
  canvas: { width: 40, height: 40 },
  init: (): Model => ({ picks: 0 }),
  // eslint-disable-next-line max-params -- TEA contract: update(model, msg, util) is the framework-defined fold signature
  update: (model: DeepReadonly<Model>, msg: Msg, u: Util): Model => {
    if (msg.type !== "mousedown") return { ...model };
    u.handled("pick");
    return { picks: model.picks + 1 };
  },
  draw: () => {},
  activity: (model: Model) => ({ picks: model.picks }),
});

test("the transcript shows activity(model) after a handled input and a param change, not after an unhandled one", () => {
  const dir = tmpDir();
  const events = parseTeaEvents(
    [
      { frame: 1, type: "mousedown", x: 5, y: 5 },
      { frame: 2, type: "mouseup", x: 5, y: 5 },
      { frame: 3, type: "param", name: "mode", value: "b" },
    ],
    sketch.params,
  );
  teaRun({ ...teaRunOptions(sketch, { outDir: dir, frames: 5, every: 1 }), events });
  const lines = readTranscript(dir).split("\n").filter((line) => line.includes("activity {"));
  assert.equal(lines.length, 2, lines.join("\n"));
  assert.ok(lines.every((line) => line.includes('activity {"picks":1}')));
});

test("an activity export that is not a function is a load error", () => {
  assert.throws(() => toTeaModule({ init: () => ({}), update: (m: object) => m, draw: () => {}, activity: 3 }), /"activity" export must be a function/u);
});
