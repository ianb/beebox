// mountSketch / attachSketch behavior in bare Node, against a minimal fake DOM
// (no jsdom: the surface the mount code touches is small enough to fake
// honestly, and node --test runs each file in its own process so the globals
// installed here can't leak into the SSR test's asserted-DOM-free env).
import assert from "node:assert/strict";
import { test } from "node:test";
import { mountSketch, sanitizeInitialParams } from "@ianbicking/canvas-loop/browser";
import { isTeaModule, toTeaModule } from "../src/headless/tea-load.js";
import { FakeElement, asHTMLElement, rafState, runFrames, captureWarnings, decl, makeModule } from "./fake-dom.js";


// ── tests ────────────────────────────────────────────────────────────

test("mountSketch mounts a canvas + generated panel and runs the loop", () => {
  const mount = new FakeElement("div");
  const { module, counters } = makeModule();
  const teardown = mountSketch(asHTMLElement(mount), { module });

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

test("transport toolbar renders on request; panel:false suppresses controls", () => {
  const mount = new FakeElement("div");
  const { module } = makeModule();
  const teardown = mountSketch(asHTMLElement(mount), { module, transport: true, panel: false });

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

test("initialParams: unknown keys and type mismatches warn and fall back to defaults", () => {
  const mount = new FakeElement("div");
  const { module } = makeModule();
  let teardown: () => void = () => {
    // replaced by the real teardown inside captureWarnings below
  };
  const warnings = captureWarnings(() => {
    teardown = mountSketch(asHTMLElement(mount), {
      module,
      initialParams: { speed: 3, bogus: 1, tone: "nope", glow: "yes" },
    });
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

test("teardown cancels the rAF loop, removes listeners, and unmounts the DOM", () => {
  const mount = new FakeElement("div");
  const { module } = makeModule();
  const teardown = mountSketch(asHTMLElement(mount), { module });
  runFrames(1);
  const container = mount.children[0];
  const canvas = container?.find((el) => el.tagName === "canvas");
  assert.ok(canvas !== null && canvas !== undefined, "canvas present before teardown");
  assert.ok(rafState.pending.size > 0, "the loop has a pending frame before teardown");
  assert.equal(canvas.addedListeners, 6, "input wiring attached its listeners");

  teardown();
  assert.equal(rafState.pending.size, 0, "teardown cancels the pending animation frame");
  assert.equal(canvas.removedListeners, 6, "teardown removes every input listener");
  assert.equal(mount.children.length, 0, "teardown removes the container from the mount");
});

test("the headless loader ignores a default export (dual-export entries)", () => {
  const { module } = makeModule();
  const dual = { ...module, default: (): null => null };
  assert.equal(isTeaModule(dual), true, "TEA detection keys on the named update export");
  const loaded = toTeaModule(dual);
  assert.equal(typeof loaded.update, "function", "the named exports load normally");
  assert.equal("default" in loaded, false, "the loaded module carries no default export");
});

test("update returning undefined (an unhandled msg) surfaces a typed error naming the msg type", () => {
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
    draw: () => {},
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
    teardown = mountSketch(asHTMLElement(mount), { module });
    runFrames(2);
  } finally {
    console.error = original;
  }
  const thrown = errors.flat().find((e): e is Error => e instanceof Error);
  assert.ok(thrown !== undefined && thrown.name === "UnhandledMsgError", "an UnhandledMsgError was surfaced");
  assert.ok(thrown.message.includes("tick"), "the error names the unhandled msg type");
  teardown();
});
