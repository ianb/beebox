// Client-render tests for <SketchFigure> — the pieces that only manifest once
// the creation effect actually runs (which SSR never does). Uses linkedom for a
// real-enough DOM plus a fake rAF; node --test isolates these globals to this
// file's process (the SSR test still asserts a DOM-free env in its own process).
import assert from "node:assert/strict";
import { test } from "node:test";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { SketchFigure } from "../src/react/SketchFigure.js";

// ── DOM + rAF harness ─────────────────────────────────────────────────

const { window, document } = parseHTML("<!doctype html><html><body></body></html>");
const raf: Array<(now: number) => void> = [];
Object.assign(globalThis, {
  window,
  document,
  HTMLCanvasElement: window.HTMLCanvasElement,
  IS_REACT_ACT_ENVIRONMENT: true,
  requestAnimationFrame: (cb: (now: number) => void): number => raf.push(cb),
  cancelAnimationFrame: (id: number): void => {
    // Match the array-index handle push() returns (1-based); clear the slot.
    delete raf[id - 1];
  },
});
// A permissive 2D context so attachSketch builds a runtime (linkedom has none).
Object.defineProperty(window.HTMLCanvasElement.prototype, "getContext", {
  configurable: true,
  value: () => new Proxy({}, { get: (t: Record<PropertyKey, unknown>, p) => (p in t ? t[p] : () => null) }),
});

/** Fire the currently-queued rAF callbacks once, 17 virtual ms apart per call. */
let now = 0;
function pumpFrames(times: number): void {
  for (let i = 0; i < times; i += 1) {
    now += 17;
    for (const cb of raf.splice(0).filter((c): c is (n: number) => void => c !== undefined)) cb(now);
  }
}

function asContainer(el: Element): HTMLElement {
  // eslint-disable-next-line no-restricted-syntax -- test boundary: linkedom's element stands in for the DOM container createRoot types against
  return el as unknown as HTMLElement;
}

function mountInto(element: React.ReactElement): { root: Root; host: Element } {
  const host = document.createElement("div");
  document.body.append(host);
  let root!: Root;
  act(() => {
    root = createRoot(asContainer(host));
  });
  act(() => {
    root.render(element);
  });
  return { root, host };
}

// ── finding 1: identity keyed on sub-references, not the wrapper ──────

// Module-scope sketch functions: an inline `module={{…}}` literal rebuilt from
// these on every render carries new WRAPPER identity but stable sub-identities.
const update = (m: unknown): unknown => m;
const draw = (): void => {
  // no-op
};
// A stable module-scope params reference — the documented contract is that
// `params` is keyed by reference too, so it must be stable to stay stable.
const params = {};
let inits = 0;
const countingInit = (): { t: number } => {
  inits += 1;
  return { t: 0 };
};

test("an inline module literal (stable sub-refs) does NOT reset the sketch on parent re-render", () => {
  inits = 0;
  const { root } = mountInto(React.createElement(SketchFigure, { module: { init: countingInit, update, draw, params } }));
  assert.equal(inits, 1, "the sketch initialised once at mount");
  // Re-render with a brand-new wrapper object built from the SAME sub-references.
  act(() => {
    root.render(React.createElement(SketchFigure, { module: { init: countingInit, update, draw, params } }));
  });
  assert.equal(inits, 1, "no re-init: the runtime was not torn down and recreated (no frame-0 reset / reseed)");
  act(() => {
    root.unmount();
  });
});

test("a genuinely new update function still restarts the sketch (keying stays correct)", () => {
  inits = 0;
  const { root } = mountInto(React.createElement(SketchFigure, { module: { init: countingInit, update, draw, params } }));
  assert.equal(inits, 1, "initialised once");
  act(() => {
    // Only the update reference changes — a real identity change must recreate.
    root.render(React.createElement(SketchFigure, { module: { init: countingInit, update: (m: unknown) => m, draw, params } }));
  });
  assert.equal(inits, 2, "the runtime was recreated when a sub-identity genuinely changed");
  act(() => {
    root.unmount();
  });
});

// ── finding 2: a throwing frame renders the inline error box ──────────

class BoomError extends Error {
  name = "BoomError";
  constructor() {
    super("kaboom sketch failure");
  }
}

test("a throwing update surfaces a small inline error box and stops the loop", () => {
  const throwingUpdate = (): unknown => {
    throw new BoomError();
  };
  const { root, host } = mountInto(
    React.createElement(SketchFigure, { module: { init: () => ({ t: 0 }), update: throwingUpdate, draw, params: {} }, showControls: false }),
  );
  assert.equal(host.querySelector(".cl-error"), null, "no error box before the first throwing frame");
  act(() => {
    pumpFrames(4); // frame 1 sets the baseline; frame 2 folds the throwing tick
  });
  const box = host.querySelector(".cl-error");
  assert.ok(box !== null, "an inline .cl-error box renders after the throw");
  assert.match(box.textContent ?? "", /kaboom/, "the error message is shown");
  assert.equal(host.querySelector('[role="alert"]'), box, "the error box is an alert landmark");
  act(() => {
    root.unmount();
  });
});
