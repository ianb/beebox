// The faint-mark warning's decisions (headless/scene/faint.ts): under 8%
// warns, each sketch line once per run, at most 8, then one line saying the
// rest are suppressed.
import assert from "node:assert/strict";
import { test } from "node:test";
import { FAINT, faintState, faintWarnings } from "../../../src/headless/scene/faint.js";

test("a mark under 8% warns with its call, its strength and its line; one at 8% does not", () => {
  const state = faintState();
  const out = faintWarnings([{ call: "line", alpha: 0.034, line: "a.ts:3:5" }, { call: "curve", alpha: FAINT, line: "a.ts:4:5" }], state);
  assert.deepEqual(out, ["faint mark (line): it reaches only 3% opacity and will barely show (gesture({ faint: true }) marks it as intended) (at a.ts:3:5)"]);
  assert.deepEqual(faintWarnings([{ call: "line", alpha: 0.01, line: "a.ts:3:5" }], state), [], "each line once per run");
});

test("after 8 warnings, one says the rest are suppressed, then none; a line is read only for a faint mark", () => {
  const state = faintState();
  const marks = Array.from({ length: 12 }, (_, i) => ({ call: "line", alpha: 0.01, line: `a.ts:${i}:1` }));
  const out = faintWarnings(marks, state);
  assert.equal(out.length, 9);
  assert.equal(out.at(-1), "faint marks: more marks are too faint to see; further warnings suppressed");
  assert.deepEqual(faintWarnings([{ call: "line", alpha: 0, line: "b.ts:1:1" }], state), []);
  let read = false;
  const lazy = {
    call: "line",
    alpha: 0.5,
    get line(): string {
      read = true;
      return "c.ts:1:1";
    },
  };
  faintWarnings([lazy], faintState());
  assert.equal(read, false);
});
