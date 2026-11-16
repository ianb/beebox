// # canvas-loop figure harness
//
// FigureMount hands a canvas-loop sketch a `mountSketch` that warns about
// card/module param drift and reports learner activity (plan
// plan:figure-check, Track C). The activity
// detail is an allowlist: declared param values and handled names, capped at
// 200 characters; never coordinates, raw keys or model state.

// First, and bare: a happy-dom window, so the fake mount is a real element.
import "../helpers/dom-globals.js";
import { test, type Test } from "tap";
import "@ianbicking/tap-check/tap";
import { NoGpuAdapterError, NoWebGpuError, RemovedCallError, SketchMountError, type EmittedEvent, type MountSketchOptions } from "@ianbicking/canvas-loop/browser";
import { figureNotice, wrapCanvasLoopLib } from "../../src/lib/figure-canvas-loop.js";

/** A stand-in canvas-loop namespace that records each `mountSketch` call's options. */
/** The host's error handler, for the tests that raise no error. */
const onError = (_error: unknown): void => {};

function fakeLib() {
  const calls: MountSketchOptions[] = [];
  return { calls, lib: { mountSketch: (_mount: HTMLElement, opts: MountSketchOptions) => { calls.push(opts); return () => {}; } } };
}

const mount = document.createElement("div");

function captureWarnings(t: Test): string[] {
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(" ")); };
  t.teardown(() => { console.warn = original; });
  return warnings;
}

// Card types map string→select, number→number, boolean→boolean. A param whose
// type cannot map warns once per mount wrapper. A param the module lacks is
// quiet: the factory may read it from figure.params (bbx figure run names it).
void test("card params the module declares with another type warn once each; undeclared ones are quiet", async (t) => {
  const warnings = captureWarnings(t);
  const { lib } = fakeLib();
  const wrapped = wrapCanvasLoopLib(lib, { onError, declared: [
    { name: "mode", type: "string" },
    { name: "formula", type: "string" },
    { name: "mass", type: "number" },
    { name: "tare", type: "boolean" },
    { name: "ghost", type: "number" },
  ] });
  const module = { params: { mode: { type: "select" }, formula: { type: "text" }, mass: { type: "number" }, tare: { type: "trigger" } } };
  wrapped.mountSketch(mount, { module });
  wrapped.mountSketch(mount, { module });
  t.check(warnings, [
    "figure params: card param \"tare\" is boolean, but the module declares it trigger (card string→select or text, number→number, boolean→boolean)",
  ]);
});

// The sketch's own onEvent runs first, then the report. A param event reports
// its value (it carries no handled names); a pointer event reports only the
// names the sketch handled, and an unhandled one reports nothing.
void test("activity reports params and handled names after the sketch's onEvent", async (t) => {
  const log: string[] = [];
  const { calls, lib } = fakeLib();
  const wrapped = wrapCanvasLoopLib(lib, { onError, declared: [], report: (kind, detail) => { log.push(`report ${kind}: ${detail ?? ""}`); } });
  wrapped.mountSketch(mount, { module: {}, onEvent: (event) => { log.push(`sketch ${event.type}`); } });
  const events: EmittedEvent[] = [
    { frame: 1, type: "param", name: "mass", value: 2.5 },
    { frame: 2, type: "mousedown", x: 40, y: 12, handled: ["tare button", "pan"], changed: true },
    { frame: 3, type: "keydown", key: "q", handled: [], changed: false },
    { frame: 4, type: "mousemove", x: 41, y: 12 },
  ];
  for (const event of events) calls[0]?.onEvent?.(event);
  t.check(log, [
    "sketch param",
    "report explored: set mass = 2.5",
    "sketch mousedown",
    "report explored: pressed tare button, pan",
    "sketch keydown",
    "sketch mousemove",
  ]);
});

// 200 characters is the plan's cap: 199 kept plus an ellipsis.
void test("a long detail is capped at 200 characters", async (t) => {
  const details: string[] = [];
  const { calls, lib } = fakeLib();
  const wrapped = wrapCanvasLoopLib(lib, { onError, declared: [], report: (_kind, detail) => { details.push(detail ?? ""); } });
  wrapped.mountSketch(mount, { module: {} });
  calls[0]?.onEvent?.({ frame: 1, type: "trigger", name: "x", handled: ["n".repeat(300)] });
  t.check(details, [`pressed ${"n".repeat(191)}…`]);
});

// The sketch's `activity(model)` value rides along as the third argument.
// Events with nothing handled report nothing.
void test("reports carry the sketch's activity", async (t) => {
  const reported: unknown[][] = [];
  const { calls, lib } = fakeLib();
  const wrapped = wrapCanvasLoopLib(lib, { onError, declared: [], report: (...args) => { reported.push(args); } });
  wrapped.mountSketch(mount, { module: {} });
  calls[0]?.onEvent?.({ frame: 1, type: "mousedown", x: 4, y: 5, handled: ["add H"], changed: true, activity: { molecules: ["H2"] } });
  calls[0]?.onEvent?.({ frame: 2, type: "mousemove", x: 4, y: 6 });
  calls[0]?.onEvent?.({ frame: 3, type: "param", name: "mass", value: 2 });
  t.check(reported, [
    ["explored", "pressed add H", { molecules: ["H2"] }],
    ["explored", "set mass = 2", undefined],
  ]);
});

// A mount failure goes to the card first, then to the sketch's own onError,
// each in its own try: a sketch callback that throws cannot keep the error
// from the card, and its throw is logged.
void test("a mount error reaches the host first, even when the sketch's onError throws", async (t) => {
  const log: string[] = [];
  const logged: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { logged.push(args); };
  t.teardown(() => { console.error = original; });
  const { calls, lib } = fakeLib();
  const wrapped = wrapCanvasLoopLib(lib, { declared: [], onError: (error) => { log.push(`host ${String(error)}`); } });
  const thrown = new SketchMountError({ detail: "sketch handler broke" });
  wrapped.mountSketch(mount, { module: {}, onError: (error) => { log.push(`sketch ${String(error)}`); throw thrown; } });
  calls[0]?.onError?.("no webgpu");
  t.check({ log, logged }, { log: ["host no webgpu", "sketch no webgpu"], logged: [["figure sketch onError threw", thrown]] });
});

// A sketch with no onError of its own: the host still hears the error.
void test("a mount error reaches the host when the sketch has no onError", async (t) => {
  const heard: unknown[] = [];
  const { calls, lib } = fakeLib();
  wrapCanvasLoopLib(lib, { declared: [], onError: (error) => { heard.push(error); } }).mountSketch(mount, { module: {} });
  calls[0]?.onError?.("lost");
  t.check(heard, ["lost"]);
});

// canvas-loop's own error classes. The card matches them by name, since they
// arrive from a lazily loaded chunk. The notice kinds: a removed call is `outdated` with its replacement line;
// no WebGPU and no adapter each have their own kind; anything else, and a
// compile error string from the module route, is `error`.
void test("figureNotice picks the notice by the error's name", async (t) => {
  t.check([
    figureNotice(new RemovedCallError({ call: "v.cache", replacement: "use v.picture" })),
    figureNotice(new NoWebGpuError()),
    figureNotice(new NoGpuAdapterError({ browser: true })),
    figureNotice(new SketchMountError({ detail: "module must be a TEA sketch module object" })),
    figureNotice("Build failed with 1 error"),
  ], [
    { kind: "outdated", detail: "v.cache was removed: use v.picture" },
    { kind: "no-webgpu", detail: "no WebGPU: this browser has no navigator.gpu, so the figure cannot draw (canvas-loop figures need WebGPU)" },
    { kind: "no-adapter", detail: "no GPU adapter: the browser has WebGPU but gave no adapter, so the figure cannot draw. Possible causes: the GPU is blocked for this browser or site, or unavailable" },
    { kind: "error", detail: "mountSketch: module must be a TEA sketch module object" },
    { kind: "error", detail: "Build failed with 1 error" },
  ]);
});

// Sketch code never holds the page's GPU device: `inspect` would hand it over
// and `gpu` would replace where it comes from, so the wrapper drops both.
void test("the wrapper drops the options that reach the GPU device", async (t) => {
  const { calls, lib } = fakeLib();
  const wrapped = wrapCanvasLoopLib(lib, { declared: [], onError });
  wrapped.mountSketch(mount, { module: {}, autoplay: false, inspect: () => {}, gpu: {} });
  t.check(Object.keys(calls[0] ?? {}).toSorted(), ["autoplay", "module", "onError"]);
});
