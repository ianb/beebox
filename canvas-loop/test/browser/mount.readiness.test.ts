// The browser figure starts asynchronously and needs WebGPU: how a figure fails
// (no WebGPU, no adapter, no context, a throwing frame) and what teardown does
// before the device arrives. Shared fake DOM and stand-in device.
import assert from "node:assert/strict";
import { test } from "node:test";
import { NoGpuAdapterError, NoWebGpuError, SketchMountError, attachSketch, mountSketch } from "@ianbicking/canvas-loop/browser";
import type { GpuLease } from "../../src/browser/scene/shared-gpu.js";
import { asPlaygroundModule } from "../../src/browser/sketch-types.js";
import { FakeElement, asHTMLCanvas, asHTMLElement, fakeGpu, fakeLease, makeModule, rafState, runFrames, settle } from "../fake-dom.js";
import type { FakeLease } from "../fake-dom.js";

function attach(options: { gpu?: ReturnType<typeof fakeGpu>; errors: unknown[]; module?: object; canvas?: FakeElement }): ReturnType<typeof attachSketch> {
  const canvas = options.canvas ?? new FakeElement("canvas");
  canvas.width = 120;
  canvas.height = 90;
  return attachSketch(asHTMLCanvas(canvas), {
    module: asPlaygroundModule(options.module ?? makeModule().module),
    seed: 1,
    paused: false,
    onFrame: () => {},
    onError: (e) => options.errors.push(e),
    ...(options.gpu === undefined ? {} : { gpu: options.gpu }),
  });
}

/** True when `promise` resolved within a settle. */
async function resolvesSoon(promise: Promise<unknown>): Promise<boolean> {
  let resolved = false;
  void promise.then(() => {
    resolved = true;
  });
  await settle();
  return resolved;
}

test("no WebGPU: the lease throws NoWebGpuError, reported once, never ready", async () => {
  const errors: unknown[] = [];
  const attached = attach({
    errors,
    gpu: fakeGpu(async () => {
      throw new NoWebGpuError();
    }),
  });
  assert.equal(await resolvesSoon(attached.ready), false, "a failed figure is never ready");
  assert.equal(errors.length, 1, "reported exactly once");
  assert.ok(errors[0] instanceof NoWebGpuError);
  assert.equal(attached.runtime, undefined);
  assert.equal(rafState.pending.size, 0, "no loop runs");
  attached.teardown();
  assert.equal(errors.length, 1, "teardown does not report again");
});

test("no navigator.gpu and no stand-in device: the shared lease reports NoWebGpuError once", async () => {
  const errors: unknown[] = [];
  const attached = attach({ errors });
  await settle();
  assert.equal(errors.length, 1, "reported exactly once");
  assert.ok(errors[0] instanceof NoWebGpuError);
  assert.equal(attached.runtime, undefined);
  attached.teardown();
});

test("mountSketch reports NoWebGpuError once and still builds its shell", async () => {
  const errors: unknown[] = [];
  const mount = new FakeElement("div");
  const teardown = mountSketch(asHTMLElement(mount), {
    module: makeModule().module,
    onError: (e) => errors.push(e),
    gpu: fakeGpu(async () => {
      throw new NoWebGpuError();
    }),
  });
  await settle();
  assert.equal(errors.length, 1);
  assert.ok(errors[0] instanceof NoWebGpuError);
  const container = mount.children[0];
  assert.ok(container?.find((el) => el.tagName === "canvas") !== null, "the shell is there");
  assert.equal(container?.find((el) => el.className === "cl-params") ?? null, null, "the panel waits for a runtime that never comes");
  teardown();
  assert.equal(mount.children.length, 0);
});

test("no adapter: NoGpuAdapterError reported once", async () => {
  const errors: unknown[] = [];
  const attached = attach({
    errors,
    gpu: fakeGpu(async () => {
      throw new NoGpuAdapterError({ browser: true });
    }),
  });
  assert.equal(await resolvesSoon(attached.ready), false);
  assert.equal(errors.length, 1);
  assert.ok(errors[0] instanceof NoGpuAdapterError);
  attached.teardown();
});

test("a canvas with no webgpu context: SketchMountError once, and the lease is released", async () => {
  const errors: unknown[] = [];
  const canvas = new FakeElement("canvas");
  canvas.getContext = () => null;
  const lease = fakeLease();
  const attached = attach({ errors, canvas, gpu: fakeGpu(async () => lease) });
  assert.equal(await resolvesSoon(attached.ready), false);
  assert.equal(errors.length, 1);
  assert.ok(errors[0] instanceof SketchMountError);
  assert.equal(lease.released, true, "the device goes back");
  assert.equal(rafState.pending.size, 0);
  attached.teardown();
});

test("a bad module still throws from mountSketch at once, and mounts nothing", () => {
  const mount = new FakeElement("div");
  assert.throws(() => mountSketch(asHTMLElement(mount), { module: 42, gpu: fakeGpu() }), SketchMountError);
  assert.throws(() => mountSketch(asHTMLElement(mount), { module: {}, gpu: fakeGpu() }), (e: unknown) => e instanceof Error && e.name === "CliError");
  assert.equal(mount.children.length, 0);
});

test("a frame that throws reports once, stops the loop and hands the device back", async () => {
  const errors: unknown[] = [];
  const boom = new Error("boom");
  const lease = fakeLease();
  const module = { params: {}, canvas: { width: 40, height: 30 }, init: () => ({}), update: () => { throw boom; }, draw: () => {} };
  const attached = attach({ errors, module, gpu: fakeGpu(async () => lease) });
  await attached.ready;
  runFrames(5);
  await settle();
  assert.deepEqual(errors, [boom], "once, with the thrown value");
  assert.equal(rafState.pending.size, 0, "the loop stopped");
  assert.equal(lease.released, true, "the failed figure hands the device back");
  attached.teardown();
});

test("teardown before ready releases the lease when it arrives, and ready never resolves", async () => {
  const errors: unknown[] = [];
  let arrive: (lease: GpuLease) => void = () => {};
  const pending = new Promise<GpuLease>((resolve) => {
    arrive = resolve;
  });
  const lease: FakeLease = fakeLease();
  const attached = attach({ errors, gpu: fakeGpu(() => pending) });
  await settle();
  assert.equal(attached.runtime, undefined, "waiting for the device");
  attached.teardown();
  arrive(lease);
  assert.equal(await resolvesSoon(attached.ready), false, "never ready after teardown");
  assert.equal(lease.released, true, "the late lease is handed back");
  assert.equal(attached.runtime, undefined);
  assert.equal(rafState.pending.size, 0, "nothing runs");
  assert.deepEqual(errors, [], "a teardown is not a failure");
});

// Review fixes (scene core chunk 6).

test("teardown from a callback during frame 0 releases the lease, and ready never resolves", async () => {
  const errors: unknown[] = [];
  const lease = fakeLease();
  const canvas = new FakeElement("canvas");
  canvas.width = 120;
  canvas.height = 90;
  const placing = { ...makeModule().module, draw: () => {} };
  const attached: ReturnType<typeof attachSketch> = attachSketch(asHTMLCanvas(canvas), {
    module: asPlaygroundModule(placing),
    seed: 1,
    paused: false,
    onFrame: () => {},
    onError: (e) => errors.push(e),
    // The first draw's placements arrive inside the start; the host tears down there.
    onPlace: () => attached.teardown(),
    gpu: fakeGpu(async () => lease),
  });
  assert.equal(await resolvesSoon(attached.ready), false);
  assert.equal(lease.released, true);
  assert.equal(attached.runtime, undefined);
  assert.deepEqual(errors, []);
});

test("a device lost and not recreated reaches onError once; the figure stays retryable", async () => {
  const errors: unknown[] = [];
  const first = fakeLease();
  let opens = 0;
  const gpu = fakeGpu(async () => {
    opens++;
    if (opens === 1) return first;
    if (opens === 2) throw new NoGpuAdapterError({ browser: true });
    return fakeLease();
  });
  let figure: { setOnScreen: (on: boolean) => Promise<void> } | undefined;
  const canvas = new FakeElement("canvas");
  const attached = attachSketch(asHTMLCanvas(canvas), {
    module: asPlaygroundModule(makeModule().module),
    seed: 1,
    paused: false,
    onFrame: () => {},
    onError: (e) => errors.push(e),
    onNotice: () => {},
    inspect: (f) => {
      figure = f;
    },
    gpu,
  });
  await attached.ready;
  first.lose();
  await figure?.setOnScreen(true);
  assert.equal(errors.length, 1);
  assert.ok(errors[0] instanceof NoGpuAdapterError);
  await figure?.setOnScreen(true);
  assert.equal(opens, 3, "waking again tries a third device");
  assert.equal(errors.length, 1, "reported once");
  attached.teardown();
});

test("a first frame that fails to draw is reported once, and ready never resolves", async () => {
  const errors: unknown[] = [];
  const lease = fakeLease();
  const attached = attach({ errors, gpu: fakeGpu(async () => lease, async () => Promise.reject(new Error("GPU fault"))) });
  assert.equal(await resolvesSoon(attached.ready), false);
  assert.equal(errors.length, 1);
  assert.match(String(errors[0]), /GPU fault/);
  assert.equal(lease.released, true);
});
