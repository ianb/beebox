import assert from "node:assert/strict";
import { test } from "node:test";
import { checkParam } from "../../src/browser/param-validate.js";
import type { DeepReadonly, Msg, ParamsDecl, Util, View } from "../../src/core/tea.js";
import { EventScriptError } from "../../src/headless/errors.js";
import { parseTeaEvents } from "../../src/headless/tea-events.js";
import { toTeaModule } from "../../src/headless/tea-load.js";
import { teaRun } from "../../src/headless/tea-runtime.js";
import { readTranscript, teaRunOptions, tmpDir } from "../helpers.js";

const decl: ParamsDecl = { formula: { type: "text", default: "H2O", maxLength: 4 } };

test("a text value is checked against maxLength by every door: link, panel and events file", () => {
  const param = decl["formula"];
  assert.ok(param !== undefined);
  assert.deepEqual(checkParam(param, ""), { ok: true, value: "" });
  assert.equal(checkParam(param, "CaCO3").ok, false);
  assert.equal(checkParam(param, 4).ok, false);
  assert.throws(() => parseTeaEvents([{ frame: 1, type: "param", name: "formula", value: "CaCO3" }], decl), (e: unknown) => e instanceof EventScriptError && /maxLength 4/u.test(e.message));
  assert.throws(() => parseTeaEvents([{ frame: 1, type: "param", name: "formula", value: 7 }], decl), EventScriptError);
});

test("a declaration with a bad text default is rejected when the sketch loads", () => {
  const base = { init: () => ({}), update: (m: object) => m, draw: () => {} };
  assert.throws(() => toTeaModule({ ...base, params: { a: { type: "text", default: 3 } } }), /must be a string/u);
  assert.throws(() => toTeaModule({ ...base, params: { a: { type: "text", default: "long", maxLength: 2 } } }), /longer than "maxLength"/u);
});

test("u.params carries the typed text, starting from the link's value, and scripted edits reach update", () => {
  const typed: string[] = [];
  let started = "";
  const sketch = toTeaModule({
    params: { formula: { type: "text", default: "H2O", placeholder: "a formula" } },
    canvas: { width: 160, height: 60 },
    init: (u: Util) => {
      started = String(u.params["formula"]);
      return { formula: started };
    },
    update: (model: DeepReadonly<{ formula: string }>, msg: Msg) => {
      if (msg.type !== "param") return model;
      typed.push(String(msg.value));
      return { formula: String(msg.value) };
    },
    draw: (v: View) => v.control("formula", { x: 10, y: 10, w: 120, h: 24 }),
  });
  const dir = tmpDir();
  const events = parseTeaEvents([{ frame: 2, type: "param", name: "formula", value: "" }, { frame: 3, type: "param", name: "formula", value: "Ca(OH)2" }], sketch.params);
  const result = teaRun({ ...teaRunOptions(sketch, { outDir: dir, frames: 5, every: 1 }), events, initialParams: { formula: "CO2" } });
  assert.deepEqual(result.errors, []);
  assert.equal(started, "CO2", "the link's value");
  assert.deepEqual(typed, ["", "Ca(OH)2"]);
  assert.ok(readTranscript(dir).length > 0);
});
