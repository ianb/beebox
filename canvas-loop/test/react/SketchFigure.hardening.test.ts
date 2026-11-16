// Hardening tests for the browser figure runtime, against the shared fake DOM
// and a stand-in GPU device (test/browser/fake-dom.ts; node --test isolates each
// file's globals). Covers: the loop's frame-throw guard + `onError` channel, and
// the single param-validation choke points (initial overrides via
// `sanitizeInitialParams`, live changes via `Runtime.setParam`).
import assert from "node:assert/strict";
import { test } from "node:test";
import { attachSketch, mountSketch, sanitizeInitialParams } from "@ianbicking/canvas-loop/browser";
import { recorderJson } from "../../src/react/SketchFigure/figure-internals.js";
import { asPlaygroundModule, type PlaygroundModule } from "../../src/browser/sketch-types.js";
import { FakeElement, asHTMLCanvas, asHTMLElement, captureWarningsAsync, captureWarnings, decl, fakeGpu, rafState, runFrames, settle } from "../fake-dom.js";

function makeModule(update?: () => unknown): PlaygroundModule {
  return asPlaygroundModule({
    params: decl,
    canvas: { width: 40, height: 30 },
    init: () => ({ t: 0 }),
    update: update ?? ((model: unknown) => model),
    draw: () => {
      // no-op
    },
  });
}

// ── finding 2: a throwing frame stops the loop, reports once ──────────

test("a throwing frame stops the loop and reports the error exactly once via onError", async () => {
  const boom = { marker: "boom" };
  // Paramless so mountSketch renders no panel (keeping the fake DOM minimal)
  // while still exercising mountSketch's onError forward → attachSketch → Runtime.
  const module = {
    params: {},
    canvas: { width: 40, height: 30 },
    init: () => ({ t: 0 }),
    update: () => {
      throw boom;
    },
    draw: () => {
      // no-op
    },
  };
  const errors: unknown[] = [];
  const teardown = mountSketch(asHTMLElement(new FakeElement("div")), { module, gpu: fakeGpu(), onError: (e) => errors.push(e) });
  await settle();
  // Frame 1 only sets the time baseline (dt=0, no fold); frame 2 folds the
  // throwing tick. Further frames must NOT re-throw or re-report.
  runFrames(4);
  assert.equal(errors.length, 1, "onError fires exactly once, not once per subsequent rAF tick");
  assert.equal(errors[0], boom, "onError receives the thrown value");
  assert.equal(rafState.pending.size, 0, "the loop stopped: no rAF remains scheduled");
  teardown();
});

// ── finding 3: the recorder JSON is computed only when visible ────────

test("recorderJson skips the full-log JSON.stringify unless the recorder is visible", () => {
  let calls = 0;
  const source = {
    eventsJSON: () => {
      calls += 1;
      return '[{"frame":0}]';
    },
  };
  assert.equal(recorderJson(false, source), "[]", "hidden → the cheap empty array");
  assert.equal(calls, 0, "eventsJSON never ran — no O(n) stringify per input while the panel is closed");
  assert.equal(recorderJson(true, source), '[{"frame":0}]', "visible → the real recorded-events JSON");
  assert.equal(calls, 1, "eventsJSON ran only once, only when the panel is open");
  assert.equal(recorderJson(true, null), "[]", "no runtime yet → empty array (no throw)");
});

// ── finding 4: number overrides are finiteness-checked + clamped ──────

test("sanitizeInitialParams drops a non-finite number (warn + fall back to the default)", () => {
  const warnings = captureWarnings(() => {
    const out = sanitizeInitialParams({ decl, overrides: { speed: Number.NaN } });
    assert.deepEqual(out, {}, "NaN is dropped — the declared default applies");
  });
  assert.equal(warnings.length, 1, "the non-finite value warns");
  assert.ok(warnings[0]?.includes('"speed"') && warnings[0]?.includes("finite"), "the warning names the param and the reason");
});

test("sanitizeInitialParams clamps an out-of-range number into [min, max] (warn + keep)", () => {
  const warnings = captureWarnings(() => {
    const out = sanitizeInitialParams({ decl, overrides: { speed: 999 } });
    assert.deepEqual(out, { speed: 5 }, "999 is clamped to the declared max of 5");
  });
  assert.equal(warnings.length, 1, "the clamp warns");
  assert.ok(warnings[0]?.includes('"speed"') && warnings[0]?.includes("clamped"), "the warning names the param and the clamp");
});

// ── finding 5: attachSketch + Runtime.setParam are the choke points ───

test("attachSketch validates initialParams — the single point both figure surfaces share", async () => {
  const module = makeModule();
  const warnings = await captureWarningsAsync(async () => {
    const attached = attachSketch(asHTMLCanvas(new FakeElement("canvas")), {
      module,
      seed: 1,
      paused: true,
      initialParams: { bogus: 1 },
      onFrame: () => {
        // no-op
      },
      gpu: fakeGpu(),
    });
    await attached.ready;
    attached.teardown();
  });
  assert.equal(warnings.length, 1, "an unknown initial-param key warns — the React path no longer bypasses validation");
  assert.ok(warnings[0]?.includes('"bogus"'), "the unknown key is named");
});

test("Runtime.setParam validates every live change (unknown dropped, out-of-range clamped)", async () => {
  const module = makeModule();
  const attached = attachSketch(asHTMLCanvas(new FakeElement("canvas")), {
    module,
    seed: 1,
    paused: true,
    onFrame: () => {
      // no-op
    },
    gpu: fakeGpu(),
  });
  const rt = await attached.ready;
  const warnings = captureWarnings(() => {
    rt.setParam("bogus", 1); // unknown → dropped
    rt.setParam("speed", 999); // out of [0,5] → clamped to 5
  });
  assert.equal(warnings.length, 2, "each invalid live change warns");
  assert.ok(
    warnings.some((w) => w.includes('"bogus"')),
    "the unknown live param is named",
  );
  assert.ok(
    warnings.some((w) => w.includes("clamped")),
    "the out-of-range live param is clamped, not passed through",
  );
  runFrames(1); // the paused loop flushes the queued param change
  assert.equal(rt.paramValues()["speed"], 5, "the clamped value is what actually dispatched to the model");
  attached.teardown();
});
