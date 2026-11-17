// mountSketch / attachSketch behavior in bare Node, against a minimal fake DOM
// (no jsdom: the surface the mount code touches is small enough to fake
// honestly, and node --test runs each file in its own process so the globals
// installed here can't leak into the SSR test's asserted-DOM-free env).
import assert from "node:assert/strict";
import { test } from "node:test";
import { attachSketch, mountSketch, sanitizeInitialParams, type EmittedEvent } from "@ianbicking/canvas-loop/browser";
import type { Msg, Util } from "@ianbicking/canvas-loop";
import { toTeaModule } from "../../src/headless/tea-load.js";
import { asPlaygroundModule } from "../../src/browser/sketch-types.js";
import { FakeElement, asHTMLCanvas, asHTMLElement, rafState, runFrames, captureWarnings, captureWarningsAsync, decl, makeModule, fakeGpu, settle } from "../fake-dom.js";


// ── tests ────────────────────────────────────────────────────────────

test("mountSketch mounts a canvas + generated panel and runs the loop", async () => {
  const mount = new FakeElement("div");
  const { module, counters } = makeModule();
  const teardown = mountSketch(asHTMLElement(mount), { module, gpu: fakeGpu() });
  await settle();

  const container = mount.children[0];
  assert.ok(container !== undefined && container.className === "cl-figure", "a .cl-figure container is appended");
  const canvas = container.find((el) => el.tagName === "canvas");
  assert.ok(canvas !== null, "a canvas is created");
  assert.equal(canvas.width, 120, "canvas width comes from module.canvas");
  assert.equal(canvas.height, 90, "canvas height comes from module.canvas");
  assert.ok(counters.draws >= 1, "frame 0 is drawn at mount");

  const panel = container.find((el) => el.className === "cl-params");
  assert.ok(panel !== null, "params panel renders by default when the module declares params");
  const slider = panel.find((el) => el.type === "range");
  assert.equal(slider?.value, "1", "number control shows the declared default");
  assert.ok(panel.find((el) => el.tagName === "select") !== null, "select control renders");
  assert.ok(panel.find((el) => el.className === "cl-trigger-btn") !== null, "trigger control renders");
  assert.equal(container.find((el) => el.className === "cl-toolbar"), null, "no transport toolbar by default");

  const before = counters.draws;
  runFrames(4);
  assert.ok(counters.draws > before, "the rAF loop advances frames");
  teardown();
});

test("transport toolbar renders on request; panel:false suppresses controls", async () => {
  const mount = new FakeElement("div");
  const { module } = makeModule();
  const teardown = mountSketch(asHTMLElement(mount), { module, transport: true, panel: false, gpu: fakeGpu() });
  await settle();

  const container = mount.children[0];
  assert.ok(container !== undefined, "container mounted");
  assert.equal(container.find((el) => el.className === "cl-params"), null, "panel suppressed");
  const toolbar = container.find((el) => el.className === "cl-toolbar");
  assert.ok(toolbar !== null, "transport toolbar renders");
  const playPause = toolbar.find((el) => el.tagName === "button" && (el.textContent === "Pause" || el.textContent === "Play"));
  assert.equal(playPause?.textContent, "Pause", "autoplay default shows Pause");
  playPause?.click();
  assert.equal(playPause?.textContent, "Play", "clicking toggles to Play (paused)");
  teardown();
});

test("a non-TEA module throws a typed error and mounts nothing", () => {
  const mount = new FakeElement("div");
  assert.throws(
    () => mountSketch(asHTMLElement(mount), { module: 42 }),
    (e: unknown) => e instanceof Error && e.name === "SketchMountError",
    "a non-object module is a SketchMountError",
  );
  assert.throws(
    () => mountSketch(asHTMLElement(mount), { module: { params: decl } }),
    (e: unknown) => e instanceof Error && e.name === "CliError" && e.message.includes("must export init"),
    "a module without init/update/draw fails the shared TEA validator",
  );
  assert.equal(mount.children.length, 0, "nothing is left mounted after a throw");
});

test("initialParams: unknown keys and type mismatches warn and fall back to defaults", async () => {
  const mount = new FakeElement("div");
  const { module } = makeModule();
  let teardown: () => void = () => {
    // replaced by the real teardown inside captureWarnings below
  };
  const warnings = await captureWarningsAsync(async () => {
    teardown = mountSketch(asHTMLElement(mount), {
      module,
      initialParams: { speed: 3, bogus: 1, tone: "nope", glow: "yes" },
      gpu: fakeGpu(),
    });
    await settle();
  });
  assert.equal(warnings.length, 3, "one warning per rejected override (bogus, tone, glow)");
  assert.ok(warnings.some((w) => w.includes('"bogus"')), "unknown name is named");
  assert.ok(warnings.some((w) => w.includes('"tone"')), "out-of-options select value is named");
  assert.ok(warnings.some((w) => w.includes('"glow"')), "type-mismatched boolean is named");

  const container = mount.children[0];
  const slider = container?.find((el) => el.type === "range");
  assert.equal(slider?.value, "3", "the valid override applies");
  const checkbox = container?.find((el) => el.type === "checkbox");
  assert.equal(checkbox?.checked, true, "rejected boolean override falls back to its declared default");
  teardown();
});

test("sanitizeInitialParams rejects values aimed at trigger params", () => {
  const warnings = captureWarnings(() => {
    const out = sanitizeInitialParams({ decl, overrides: { reset: 1 } });
    assert.deepEqual(out, {}, "a trigger cannot hold a value");
  });
  assert.equal(warnings.length, 1, "the rejected trigger override warns");
});

test("teardown cancels the rAF loop, removes listeners, and unmounts the DOM", async () => {
  const mount = new FakeElement("div");
  const { module } = makeModule();
  const teardown = mountSketch(asHTMLElement(mount), { module, gpu: fakeGpu() });
  await settle();
  runFrames(1);
  const container = mount.children[0];
  const canvas = container?.find((el) => el.tagName === "canvas");
  assert.ok(canvas !== null && canvas !== undefined, "canvas present before teardown");
  assert.ok(rafState.pending.size > 0, "the loop has a pending frame before teardown");
  assert.equal(canvas.addedListeners, 8, "input wiring attached its listeners");

  teardown();
  assert.equal(rafState.pending.size, 0, "teardown cancels the pending animation frame");
  assert.equal(canvas.removedListeners, 8, "teardown removes every input listener");
  assert.equal(mount.children.length, 0, "teardown removes the container from the mount");
});

test("onEvent carries the engagement verdict (handled names + model-reference change)", async () => {
  interface Model {
    hits: number;
  }
  const raw = {
    params: {},
    canvas: { width: 50, height: 50 },
    init: (): Model => ({ hits: 0 }),
    // eslint-disable-next-line max-params -- TEA contract: update(model, msg, util) is the framework-defined fold signature
    update: (model: Model, msg: Msg, u: Util): Model => {
      switch (msg.type) {
        case "mousedown":
          u.handled("pick");
          return { hits: model.hits + 1 }; // named AND changed
        case "keydown":
          return { hits: model.hits }; // new reference, unnamed → changed only
        default:
          return model; // tick, mousemove, …: same reference
      }
    },
    draw: () => null,
  };
  const canvas = new FakeElement("canvas");
  canvas.width = 50;
  canvas.height = 50;
  const emitted: EmittedEvent[] = [];
  const attached = attachSketch(asHTMLCanvas(canvas), {
    module: asPlaygroundModule(raw),
    seed: 1,
    paused: false,
    onFrame: () => {},
    onEvent: (entry) => emitted.push(entry),
    gpu: fakeGpu(),
  });
  const runtime = await attached.ready;

  runtime.pointer({ type: "mousedown", x: 10, y: 10 });
  runFrames(2);
  runtime.key({ type: "keydown", key: "a" });
  runFrames(2);
  runtime.pointer({ type: "mousemove", x: 12, y: 12 });
  runFrames(2);

  const down = emitted.find((e) => e.type === "mousedown");
  assert.deepEqual(down?.handled, ["pick"], "a named u.handled() streams the name");
  assert.equal(down?.changed, true, "the down also changed the model reference");
  const keyEntry = emitted.find((e) => e.type === "keydown");
  assert.deepEqual(keyEntry?.handled, [], "the unnamed keydown streams no names");
  assert.equal(keyEntry?.changed, true, "a new model reference reports changed:true");
  const moveEntry = emitted.find((e) => e.type === "mousemove");
  assert.deepEqual(moveEntry?.handled, [], "the move named nothing");
  assert.equal(moveEntry?.changed, false, "a same-reference return reports changed:false");
  attached.teardown();
});

test("the headless loader ignores a default export (dual-export entries)", () => {
  const { module } = makeModule();
  const dual = { ...module, default: (): null => null };
  const loaded = toTeaModule(dual);
  assert.equal(typeof loaded.update, "function", "the named exports load normally");
  assert.equal("default" in loaded, false, "the loaded module carries no default export");
});

test("update returning undefined (an unhandled msg) surfaces a typed error naming the msg type", async () => {
  const mount = new FakeElement("div");
  const module = {
    params: {},
    canvas: { width: 120, height: 90 },
    init: () => ({ t: 0 }),
    // A box sketch whose update switch has no case for "tick" — the empty body
    // implicitly returns undefined, exactly as a fall-through switch would. The
    // runtime's #fold guard throws UnhandledMsgError rather than letting the
    // model silently become undefined and crash draw downstream.
    update: () => {},
    draw: () => null,
  };
  // The loop catches a frame throw, stops, and reports the error once (default
  // channel is console.error). The first rAF frame only establishes the time
  // baseline (dt=0, no fold); the second accumulates a step and folds the tick
  // that throws.
  const errors: unknown[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args);
  };
  let teardown: () => void = () => {};
  try {
    teardown = mountSketch(asHTMLElement(mount), { module, gpu: fakeGpu() });
    await settle();
    runFrames(2);
  } finally {
    console.error = original;
  }
  const thrown = errors.flat().find((e): e is Error => e instanceof Error);
  assert.ok(thrown !== undefined && thrown.name === "UnhandledMsgError", "an UnhandledMsgError was surfaced");
  assert.ok(thrown.message.includes("tick"), "the error names the unhandled msg type");
  teardown();
});

test("mountSketch keeps a module's sound export, so its runtime collects voices", async () => {
  const mount = new FakeElement("div");
  const { module } = makeModule();
  let calls = 0;
  const teardown = mountSketch(asHTMLElement(mount), {
    module: {
      ...module,
      sound: () => {
        calls += 1;
        return [];
      },
    },
    gpu: fakeGpu(),
  });
  await settle();
  runFrames(3);
  assert.ok(calls > 0, "sound() ran after ticks");
  teardown();
});

test("touch drives the sketch: a drag arrives as mousedown/mousemove/mouseup, page scrolling is off, a second finger is ignored", async () => {
  const seen: string[] = [];
  const raw = {
    params: {},
    canvas: { width: 50, height: 50 },
    init: (): null => null,
    // eslint-disable-next-line max-params -- TEA contract: update(model, msg, util) is the framework-defined fold signature
    update: (model: null, msg: Msg, _u: Util): null => {
      if (msg.type !== "tick") seen.push(`${msg.type} ${"x" in msg ? `${msg.x},${msg.y}` : ""}`.trim());
      return model;
    },
    draw: () => null,
  };
  const canvas = new FakeElement("canvas");
  canvas.width = 50;
  canvas.height = 50;
  const attached = attachSketch(asHTMLCanvas(canvas), { module: asPlaygroundModule(raw), seed: 1, paused: false, onFrame: () => {}, gpu: fakeGpu() });
  await attached.ready;
  assert.equal(canvas.style["touchAction"], "none", "a drag on the canvas does not scroll the page");

  const touch = (pointerId: number, at: { x: number; y: number; isPrimary?: boolean }): object => ({ pointerId, isPrimary: at.isPrimary ?? true, pointerType: "touch", clientX: at.x, clientY: at.y });
  canvas.fire("pointerdown", touch(7, { x: 10, y: 10 }));
  assert.deepEqual([...canvas.captured], [7], "the finger is captured, so sliding off the canvas still reports");
  canvas.fire("pointerdown", touch(8, { x: 40, y: 40, isPrimary: false }));
  canvas.fire("pointermove", touch(8, { x: 41, y: 41, isPrimary: false }));
  canvas.fire("pointermove", touch(7, { x: 20, y: 15 }));
  // The browser takes the touch (e.g. a system gesture): the press still ends.
  canvas.fire("pointercancel", touch(7, { x: 20, y: 15 }));
  canvas.fire("lostpointercapture", touch(7, { x: 20, y: 15 }));
  runFrames(2);
  assert.deepEqual(seen, ["mousedown 10,10", "mousemove 20,15", "mouseup 20,15"]);
  assert.deepEqual([...canvas.captured], [], "capture released");
  // A leave while pressed is held back (capture keeps the moves); one after the release, and only the primary pointer's, is sent.
  canvas.fire("pointerdown", touch(7, { x: 10, y: 10 }));
  canvas.fire("pointerleave", touch(7, { x: 60, y: 10 }));
  canvas.fire("pointerup", touch(7, { x: 60, y: 10 }));
  canvas.fire("pointerleave", touch(8, { x: 60, y: 10, isPrimary: false }));
  canvas.fire("pointerleave", touch(7, { x: 60, y: 10 }));
  runFrames(2);
  assert.deepEqual(seen.slice(3), ["mousedown 10,10", "mouseup 60,10", "mouseleave"]);
  attached.teardown();
});

test("a figure written before mouseleave (no case for it, so update returns undefined) keeps its model and runs on", async () => {
  const errors: unknown[] = [];
  const raw = {
    params: {},
    canvas: { width: 50, height: 50 },
    init: () => ({ n: 0 }),
    // eslint-disable-next-line max-params -- TEA contract: update(model, msg, util) is the framework-defined fold signature
    update: (model: { n: number }, msg: Msg, _u: Util): { n: number } | undefined => (msg.type === "mouseleave" ? undefined : { n: model.n + 1 }),
    draw: () => null,
  };
  const canvas = new FakeElement("canvas");
  const attached = attachSketch(asHTMLCanvas(canvas), { module: asPlaygroundModule(raw), seed: 1, paused: false, onFrame: () => {}, onError: (e) => errors.push(e), gpu: fakeGpu() });
  await attached.ready;
  canvas.fire("pointerleave", { pointerId: 1, isPrimary: true, pointerType: "mouse", clientX: 60, clientY: 10 });
  runFrames(3);
  assert.deepEqual(errors, []);
  attached.teardown();
});

test("a handled event carries the sketch's activity(model) after the fold; a throwing activity warns once and the sketch runs on", async () => {
  interface Model {
    hits: number;
  }
  const make = (activity: (model: Model) => Record<string, unknown>) => ({
    params: {},
    canvas: { width: 50, height: 50 },
    init: (): Model => ({ hits: 0 }),
    // eslint-disable-next-line max-params -- TEA contract: update(model, msg, util) is the framework-defined fold signature
    update: (model: Model, msg: Msg, u: Util): Model => {
      if (msg.type !== "mousedown") return model;
      u.handled("pick");
      return { hits: model.hits + 1 };
    },
    draw: () => null,
    activity,
  });
  const run = async (raw: object): Promise<EmittedEvent[]> => {
    const canvas = new FakeElement("canvas");
    canvas.width = 50;
    canvas.height = 50;
    const emitted: EmittedEvent[] = [];
    const attached = attachSketch(asHTMLCanvas(canvas), { module: asPlaygroundModule(raw), seed: 1, paused: false, onFrame: () => {}, onEvent: (entry) => emitted.push(entry), gpu: fakeGpu() });
    const runtime = await attached.ready;
    for (const x of [10, 20]) {
      runtime.pointer({ type: "mousedown", x, y: 10 });
      runFrames(2);
    }
    runtime.pointer({ type: "mousemove", x: 12, y: 12 });
    runFrames(2);
    return emitted;
  };
  const emitted = await run(make((model) => ({ hits: model.hits })));
  assert.deepEqual(emitted.filter((e) => e.type === "mousedown").map((e) => e.activity), [{ hits: 1 }, { hits: 2 }], "the model after each fold");
  assert.equal(emitted.find((e) => e.type === "mousemove")?.activity, undefined, "an unhandled input carries none");

  let failing: EmittedEvent[] = [];
  const warnings = await captureWarningsAsync(async () => {
    failing = await run(make(() => {
      throw new Error("bad summary");
    }));
  });
  assert.equal(failing.filter((e) => e.type === "mousedown").length, 2, "both clicks still stream");
  assert.ok(failing.every((e) => e.activity === undefined));
  assert.equal(warnings.filter((w) => w.includes("activity(model) threw")).length, 1, "one warning");
});
