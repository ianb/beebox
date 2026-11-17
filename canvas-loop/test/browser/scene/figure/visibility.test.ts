// A figure sleeps when its canvas leaves the viewport or its tab is hidden,
// and wakes only when both are back.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { watchVisibility } from "../../../../src/browser/scene/figure/visibility.js";
import { FakeElement, asHTMLCanvas } from "../../../fake-dom.js";

type Report = (entries: Array<{ isIntersecting: boolean }>) => void;

const saved = { io: globalThis.IntersectionObserver, doc: globalThis.document };
afterEach(() => {
  Object.assign(globalThis, { IntersectionObserver: saved.io, document: saved.doc });
});

function setup(initial: "visible" | "hidden"): { calls: string[]; report: Report; setTab: (state: "visible" | "hidden") => void; stop: () => void } {
  let report: Report | undefined;
  const listeners = new Set<() => void>();
  const doc = {
    visibilityState: initial,
    addEventListener: (_type: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_type: string, fn: () => void) => listeners.delete(fn),
  };
  class FakeObserver {
    constructor(callback: Report) {
      report = callback;
    }
    observe(): void {}
    disconnect(): void {}
  }
  Object.assign(globalThis, { IntersectionObserver: FakeObserver, document: doc });
  const calls: string[] = [];
  const stop = watchVisibility(asHTMLCanvas(new FakeElement("canvas")), {
    suspend: () => calls.push("suspend"),
    resume: () => calls.push("resume"),
    invalidate: () => calls.push("invalidate"),
    fontsLoaded: () => calls.push("fonts"),
  });
  const setTab = (state: "visible" | "hidden"): void => {
    doc.visibilityState = state;
    for (const fn of listeners) fn();
  };
  return { calls, report: (entries) => report?.(entries), setTab, stop };
}

test("a hidden tab suspends an on-screen figure and a shown tab resumes it", () => {
  const s = setup("visible");
  s.report([{ isIntersecting: true }]);
  s.setTab("hidden");
  s.setTab("visible");
  assert.deepEqual(s.calls, ["suspend", "resume"]);
});

test("a figure scrolled off screen stays asleep when its tab is shown again", () => {
  const s = setup("visible");
  s.report([{ isIntersecting: false }]);
  s.setTab("hidden");
  s.setTab("visible");
  s.report([{ isIntersecting: true }]);
  assert.deepEqual(s.calls, ["suspend", "resume"]);
});

test("a figure that starts in a hidden tab sleeps on the observer's first report", () => {
  const s = setup("hidden");
  s.report([{ isIntersecting: true }]);
  s.setTab("visible");
  assert.deepEqual(s.calls, ["suspend", "resume"]);
});

test("after teardown a tab change does nothing", () => {
  const s = setup("visible");
  s.report([{ isIntersecting: true }]);
  s.stop();
  s.setTab("hidden");
  assert.deepEqual(s.calls, []);
});
