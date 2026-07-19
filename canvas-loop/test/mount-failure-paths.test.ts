// Mid-mount failure paths (from the 2026-07-15 codex review): a throw between
// starting the runtime and returning a teardown must not leak a running rAF
// loop or a half-built figure. Uses the shared fake DOM; own process, so the
// global fakes stay contained.
import assert from "node:assert/strict";
import { test } from "node:test";
import { attachSketch, mountSketch } from "@ianbicking/canvas-loop/browser";
import { asPlaygroundModule } from "../browser/sketch-types.js";
import { FakeElement, asHTMLElement, rafState, makeModule } from "./fake-dom.js";

/** Thrown by the poisoned addEventListener to simulate a mid-wiring failure. */
class HostileAddEventListenerError extends Error {
  constructor() {
    super("hostile DOM operation: addEventListener");
    this.name = "HostileAddEventListenerError";
  }
}

/** Thrown by the poisoned createElement to simulate a mid-chrome-build failure. */
class HostileCreateElementError extends Error {
  constructor() {
    super("hostile DOM operation: createElement(button)");
    this.name = "HostileCreateElementError";
  }
}

test("a throw during listener wiring leaves no running rAF loop", () => {
  const { module } = makeModule();
  const canvas = new FakeElement("canvas");
  canvas.width = 40;
  canvas.height = 30;
  let adds = 0;
  canvas.addEventListener = () => {
    adds += 1;
    if (adds === 3) throw new HostileAddEventListenerError();
  };
  const pendingBefore = rafState.pending.size;
  assert.throws(
    () =>
      // eslint-disable-next-line no-restricted-syntax -- test boundary: the fake element stands in for the DOM canvas the mount code duck-types against
      attachSketch(canvas as unknown as HTMLCanvasElement, {
        module: asPlaygroundModule(module),
        seed: 42,
        paused: false,
        onFrame: () => {
          // Frame progress is irrelevant here — the mount must fail first.
        },
      }),
    HostileAddEventListenerError,
  );
  assert.equal(rafState.pending.size, pendingBefore, "no rAF frame may remain scheduled after a wiring throw");
});

test("a throw while building figure chrome tears down before rethrowing", () => {
  const { module } = makeModule();
  const mount = new FakeElement("div");
  const realCreate = document.createElement.bind(document);
  // Transport is built from <button> elements; poison them to force a throw
  // after the runtime has started.
  document.createElement = (tag: string) => {
    if (tag === "button") throw new HostileCreateElementError();
    return realCreate(tag);
  };
  const pendingBefore = rafState.pending.size;
  try {
    assert.throws(
      () => mountSketch(asHTMLElement(mount), { module, transport: true, panel: false }),
      HostileCreateElementError,
    );
  } finally {
    document.createElement = realCreate;
  }
  assert.equal(rafState.pending.size, pendingBefore, "runtime loop must be stopped by the cleanup path");
  assert.equal(mount.children.length, 0, "no half-built figure may remain in the mount host");
});
