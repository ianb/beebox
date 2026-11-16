// <SketchFigure> while its GPU device is still opening: the controls are
// disabled, a runtime that arrives after an unmount or a module swap is never
// applied (and its device goes back), and what changed meanwhile is applied
// when the runtime is ready. linkedom for the DOM, a fake rAF, and a
// stand-in device whose lease the test resolves by hand.
import assert from "node:assert/strict";
import { test } from "node:test";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import type { Msg } from "../../src/core/tea.js";
import type { GpuLease } from "../../src/browser/scene/shared-gpu.js";
import { SketchFigure } from "../../src/react/SketchFigure/figure/view.js";
import type { SketchFigureProps } from "../../src/react/SketchFigure/figure/view.js";
import { fakeGpu, fakeLease, settle } from "../fake-dom.js";
import type { FakeLease } from "../fake-dom.js";

// ── DOM + rAF harness (the fake-dom import above installs its own; these replace it) ──

const { window, document } = parseHTML("<!doctype html><html><body></body></html>");
const raf: Array<(now: number) => void> = [];
Object.assign(globalThis, {
  window,
  document,
  HTMLCanvasElement: window.HTMLCanvasElement,
  IS_REACT_ACT_ENVIRONMENT: true,
  requestAnimationFrame: (cb: (now: number) => void): number => raf.push(cb),
  cancelAnimationFrame: (id: number): void => {
    delete raf[id - 1];
  },
});
Object.defineProperty(window.HTMLCanvasElement.prototype, "getContext", {
  configurable: true,
  value: (kind: string) => (kind === "webgpu" ? { configure: () => {}, unconfigure: () => {}, getCurrentTexture: () => ({}) } : null),
});

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

/** A device lease the test resolves by hand: one entry per attach. */
interface HeldLeases {
  gpu: NonNullable<SketchFigureProps["gpu"]>;
  /** Hand over the `index`th requested lease; returns it. */
  arrive: (index: number) => FakeLease;
  requested: () => number;
}

function heldLeases(): HeldLeases {
  const waiting: Array<(lease: GpuLease) => void> = [];
  const gpu = fakeGpu(
    () =>
      new Promise<GpuLease>((resolve) => {
        waiting.push(resolve);
      }),
  );
  return {
    gpu,
    arrive: (index) => {
      const lease = fakeLease();
      const resolve = waiting[index];
      assert.ok(resolve !== undefined, `lease ${index} was requested`);
      resolve(lease);
      return lease;
    },
    requested: () => waiting.length,
  };
}

async function mount(element: React.ReactElement): Promise<{ root: Root; host: Element }> {
  const host = document.createElement("div");
  document.body.append(host);
  let root!: Root;
  act(() => {
    root = createRoot(asContainer(host));
  });
  await rerender(root, element);
  return { root, host };
}

async function rerender(root: Root, element: React.ReactElement): Promise<void> {
  await act(async () => {
    root.render(element);
    await settle();
  });
}

/** Hand over leases inside act and let their consequences land (the lazy import, the runtime, React state). */
async function arriving(held: HeldLeases, indexes: readonly number[]): Promise<FakeLease[]> {
  const leases: FakeLease[] = [];
  await act(async () => {
    for (const index of indexes) leases.push(held.arrive(index));
    await settle();
  });
  return leases;
}

interface Counted {
  module: SketchFigureProps["module"];
  counts: { draws: number; params: Array<[string, unknown]> };
}

/** A moving sketch (each tick a new model, so each frame draws) that records what it is told. */
function countedModule(params: SketchFigureProps["module"]["params"]): Counted {
  const counts: Counted["counts"] = { draws: 0, params: [] };
  const module: SketchFigureProps["module"] = {
    ...(params === undefined ? {} : { params }),
    canvas: { width: 40, height: 30 },
    init: () => ({ t: 0 }),
    update: (model: unknown, msg: Msg) => {
      if (msg.type === "param") counts.params.push([msg.name, msg.value]);
      return { t: typeof model === "object" && model !== null && "t" in model && typeof model.t === "number" ? model.t + 1 : 0 };
    },
    draw: () => {
      counts.draws += 1;
      return null;
    },
  };
  return { module, counts };
}

const decl = { speed: { type: "number", min: 0, max: 5, default: 1 } } as const;
const textDecl = { answer: { type: "text", default: "" } } as const;

function props(extra: Omit<SketchFigureProps, "module"> & { module: SketchFigureProps["module"] }): React.ReactElement {
  return React.createElement(SketchFigure, extra);
}

function disabledInputs(host: Element): boolean[] {
  return [...host.querySelectorAll("input, button, select, textarea")].map((el) => el.hasAttribute("disabled"));
}

// ── tests ────────────────────────────────────────────────────────────

test("unmounting before the device arrives: nothing runs, and the device goes back", async () => {
  const held = heldLeases();
  const { module, counts } = countedModule({});
  const { root } = await mount(props({ module, gpu: held.gpu }));
  assert.equal(held.requested(), 1);
  await act(async () => {
    root.unmount();
  });
  const [lease] = await arriving(held, [0]);
  pumpFrames(3);
  assert.ok(lease !== undefined);
  assert.equal(lease.released, true, "the late lease is released");
  assert.equal(counts.draws, 0, "nothing drew");
});

test("a module replaced before the device arrives: only the second module draws", async () => {
  const held = heldLeases();
  const first = countedModule({});
  const second = countedModule({});
  const { root } = await mount(props({ module: first.module, gpu: held.gpu }));
  await rerender(root, props({ module: second.module, gpu: held.gpu }));
  assert.equal(held.requested(), 2, "each module asked for a device");
  const [leaseA, leaseB] = await arriving(held, [0, 1]);
  assert.ok(leaseA !== undefined && leaseB !== undefined);
  await act(async () => {
    pumpFrames(3);
  });
  assert.equal(first.counts.draws, 0, "the replaced module never drew");
  assert.equal(leaseA.released, true, "its device went back");
  assert.ok(second.counts.draws >= 1, "the current module draws");
  assert.equal(leaseB.released, false, "the current figure keeps its device");
  await act(async () => {
    root.unmount();
  });
  assert.equal(leaseB.released, true);
});

test("a controlled param changed before ready is applied when ready", async () => {
  const held = heldLeases();
  const { module, counts } = countedModule(decl);
  const { root } = await mount(props({ module, params: { speed: 1 }, showControls: false, gpu: held.gpu }));
  await rerender(root, props({ module, params: { speed: 3 }, showControls: false, gpu: held.gpu }));
  assert.deepEqual(counts.params, [], "nothing reaches a runtime that does not exist yet");
  await arriving(held, [0]);
  await act(async () => {
    pumpFrames(3);
  });
  assert.deepEqual(counts.params, [["speed", 3]], "the latest value is dispatched once the runtime exists");
  await act(async () => {
    root.unmount();
  });
});

test("autoplay off: the toolbar waits for the device, and the runtime starts paused", async () => {
  const held = heldLeases();
  const { module, counts } = countedModule({});
  const { root, host } = await mount(props({ module, autoplay: false, gpu: held.gpu }));
  assert.deepEqual(disabledInputs(host), [true, true], "Play and Restart are disabled before ready");
  const play = host.querySelector("button");
  assert.ok(play !== null);
  assert.equal(play.textContent, "Play");
  await act(async () => {
    play.click();
  });
  assert.equal(play.textContent, "Play", "a click on a disabled button does nothing");
  await arriving(held, [0]);
  assert.deepEqual(disabledInputs(host), [false, false], "enabled once ready");
  const drawn = counts.draws;
  await act(async () => {
    pumpFrames(5);
  });
  assert.equal(counts.draws, drawn, "paused: no frame advances");
  await act(async () => {
    host.querySelector("button")?.click();
  });
  await act(async () => {
    pumpFrames(5);
  });
  assert.ok(counts.draws > drawn, "Play starts the loop");
  await act(async () => {
    root.unmount();
  });
});

test("an uncontrolled text control is disabled while the device opens, then live", async () => {
  const held = heldLeases();
  const { module, counts } = countedModule(textDecl);
  const { root, host } = await mount(props({ module, gpu: held.gpu }));
  const input = host.querySelector("input.cl-text");
  assert.ok(input !== null, "the control is there from the start");
  assert.equal(input.hasAttribute("disabled"), true, "disabled before ready");
  await arriving(held, [0]);
  assert.equal(input.hasAttribute("disabled"), false, "enabled once ready");
  // linkedom lacks `oninput`, so React watches a text box the old way: it starts on focusin
  // (which calls attachEvent) and reads the value at the next keyup. A native setter skips React's value tracker.
  Object.assign(input, { attachEvent: () => {}, detachEvent: () => {} });
  const valueSetter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")?.set;
  assert.ok(valueSetter !== undefined);
  await act(async () => {
    input.dispatchEvent(new window.Event("focusin", { bubbles: true }));
    valueSetter.call(input, "42");
    input.dispatchEvent(new window.Event("keyup", { bubbles: true }));
    pumpFrames(3);
  });
  assert.deepEqual(counts.params, [["answer", "42"]], "typing reaches the runtime as a param");
  await act(async () => {
    root.unmount();
  });
});
