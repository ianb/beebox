// Mid-mount failure paths (from the 2026-07-15 codex review): a throw between
// starting the runtime and returning a teardown must not leak a running rAF
// loop or a half-built figure. Uses the shared fake DOM; own process, so the
// global fakes stay contained.
import assert from "node:assert/strict";
import { test } from "node:test";
import { attachSketch, mountSketch } from "@ianbicking/canvas-loop/browser";
import { asPlaygroundModule } from "../../src/browser/sketch-types.js";
import { FakeElement, asHTMLCanvas, asHTMLElement, rafState, makeModule, fakeGpu, settle } from "../fake-dom.js";

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

test("a throw during listener wiring reports once, leaves no running rAF loop, and never becomes ready", async () => {
  const { module } = makeModule();
  const canvas = new FakeElement("canvas");
  canvas.width = 40;
  canvas.height = 30;
  let adds = 0;
  canvas.addEventListener = () => {
    adds += 1;
    if (adds === 3) throw new HostileAddEventListenerError();
  };
  const errors: unknown[] = [];
  const pendingBefore = rafState.pending.size;
  const attached = attachSketch(asHTMLCanvas(canvas), {
    module: asPlaygroundModule(module),
    seed: 42,
    paused: false,
    onFrame: () => {
      // Frame progress is irrelevant here: the mount must fail first.
    },
    onError: (e) => errors.push(e),
    gpu: fakeGpu(),
  });
  let resolved = false;
  void attached.ready.then(() => {
    resolved = true;
  });
  await settle();
  assert.equal(errors.length, 1, "the host hears the failure once");
  assert.ok(errors[0] instanceof HostileAddEventListenerError);
  assert.equal(resolved, false, "a failed figure is never ready");
  assert.equal(attached.runtime, undefined, "no runtime is exposed");
  assert.equal(rafState.pending.size, pendingBefore, "no rAF frame may remain scheduled after a wiring throw");
});

test("a throw while building figure chrome stops the loop and reports once; teardown removes the shell", async () => {
  const { module } = makeModule();
  const mount = new FakeElement("div");
  const realCreate = document.createElement.bind(document);
  const errors: unknown[] = [];
  const pendingBefore = rafState.pending.size;
  let teardown: () => void = () => {};
  try {
    teardown = mountSketch(asHTMLElement(mount), { module, transport: true, panel: false, gpu: fakeGpu(), onError: (e) => errors.push(e) });
    // The transport is built from <button> elements once the figure is ready; poison them
    // to force a throw after the runtime has started.
    document.createElement = (tag: string) => {
      if (tag === "button") throw new HostileCreateElementError();
      return realCreate(tag);
    };
    await settle();
  } finally {
    document.createElement = realCreate;
  }
  assert.equal(errors.length, 1, "the host hears it once");
  assert.ok(errors[0] instanceof HostileCreateElementError);
  assert.equal(rafState.pending.size, pendingBefore, "runtime loop must be stopped by the cleanup path");
  teardown();
  assert.equal(mount.children.length, 0, "no half-built figure may remain in the mount host after teardown");
});
