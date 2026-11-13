// # canvas-loop figure harness
//
// FigureMount hands a canvas-loop sketch a `mountSketch` that warns about
// card/module param drift and reports learner activity (plan
// docs/implemented-plans/figure-check.md, Track C). The activity
// detail is an allowlist: declared param values and handled names, capped at
// 200 characters; never coordinates, raw keys or model state.

// First, and bare: a happy-dom window, so the fake mount is a real element.
import "../helpers/dom-globals.js";
import { test, type Test } from "tap";
import "@ianbicking/tap-check/tap";
import type { EmittedEvent, MountSketchOptions } from "@ianbicking/canvas-loop/browser";
import { wrapCanvasLoopLib } from "../../src/lib/figure-canvas-loop.js";
import type { ActivityReport } from "../../src/lib/activity/page-queue.js";

/** A stand-in canvas-loop namespace that records each `mountSketch` call's options. */
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

// Card types map string→select, number→number, boolean→boolean. A param the
// module lacks, or one whose type cannot map, warns once per mount wrapper.
void test("card params the module cannot honor warn once each", async (t) => {
  const warnings = captureWarnings(t);
  const { lib } = fakeLib();
  const wrapped = wrapCanvasLoopLib(lib, { declared: [
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
    "figure params: card param \"ghost\" is not declared in the canvas-loop module's params",
  ]);
});

// The sketch's own onEvent runs first, then the report. A param event reports
// its value (it carries no handled names); a pointer event reports only the
// names the sketch handled, and an unhandled one reports nothing.
void test("activity reports params and handled names after the sketch's onEvent", async (t) => {
  const log: string[] = [];
  const { calls, lib } = fakeLib();
  const wrapped = wrapCanvasLoopLib(lib, { declared: [], reportActivity: (kind, detail) => { log.push(`report ${kind}: ${detail ?? ""}`); } });
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
  const wrapped = wrapCanvasLoopLib(lib, { declared: [], reportActivity: (_kind, detail) => { details.push(detail ?? ""); } });
  wrapped.mountSketch(mount, { module: {} });
  calls[0]?.onEvent?.({ frame: 1, type: "trigger", name: "x", handled: ["n".repeat(300)] });
  t.check(details, [`pressed ${"n".repeat(191)}…`]);
});

// The figure's own card is the entry's `card`; the card that shows it (a view
// embedding the figure) is `via`; the sketch's `activity(model)` value rides
// along as `activity`. Events with nothing handled log nothing.
void test("activity entries carry card, via and the sketch's activity", async (t) => {
  const pushed: ActivityReport[] = [];
  const { calls, lib } = fakeLib();
  const wrapped = wrapCanvasLoopLib(lib, { declared: [], activityLog: { card: "Chem/Molecules.figure.card", via: "Chem/Lab.view.card", push: (report) => { pushed.push(report); } } });
  wrapped.mountSketch(mount, { module: {} });
  calls[0]?.onEvent?.({ frame: 1, type: "mousedown", x: 4, y: 5, handled: ["add H"], changed: true, activity: { molecules: ["H2"] } });
  calls[0]?.onEvent?.({ frame: 2, type: "mousemove", x: 4, y: 6 });
  calls[0]?.onEvent?.({ frame: 3, type: "param", name: "mass", value: 2 });
  t.check(pushed, [
    { card: "Chem/Molecules.figure.card", via: "Chem/Lab.view.card", kind: "explored", detail: "pressed add H", activity: { molecules: ["H2"] } },
    { card: "Chem/Molecules.figure.card", via: "Chem/Lab.view.card", kind: "explored", detail: "set mass = 2" },
  ]);
});

void test("a figure shown on its own page logs without via and keeps the latest-wins report", async (t) => {
  const pushed: ActivityReport[] = [];
  const reported: string[] = [];
  const { calls, lib } = fakeLib();
  const wrapped = wrapCanvasLoopLib(lib, { declared: [],
    reportActivity: (kind, detail) => { reported.push(`${kind}: ${detail ?? ""}`); },
    activityLog: { card: "Molecules.figure.card", push: (report) => { pushed.push(report); } } });
  wrapped.mountSketch(mount, { module: {} });
  calls[0]?.onEvent?.({ frame: 1, type: "trigger", name: "x", handled: ["tare"] });
  t.check({ pushed, reported }, { pushed: [{ card: "Molecules.figure.card", kind: "explored", detail: "pressed tare" }], reported: ["explored: pressed tare"] });
});
