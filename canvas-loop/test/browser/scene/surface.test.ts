// The scene surface after a lost device: a figure torn down while its new
// device is still opening stays torn down, and a failed reopen can be tried
// again. The GPU, canvas and lease are stand-ins.
import assert from "node:assert/strict";
import { test } from "node:test";
import { openTextMeasurer } from "../../../src/device/open.js";
import type { GpuHandle } from "../../../src/device/open.js";
import type { GpuLease } from "../../../src/browser/scene/shared-gpu.js";
import { SceneSurface } from "../../../src/browser/scene/surface.js";
import type { SurfaceRenderer } from "../../../src/browser/scene/surface.js";

class NoAdapterError extends Error {
  name = "NoAdapterError";
  constructor() {
    super("no adapter");
  }
}

Object.assign(globalThis, { GPUTextureUsage: Reflect.get(globalThis, "GPUTextureUsage") ?? { RENDER_ATTACHMENT: 16, COPY_DST: 2 } });

interface FakeLease extends GpuLease {
  /** Release is idempotent, as the shared device's is. */
  released: boolean;
  lose(): void;
}

function fakeLease(): FakeLease {
  let listener: ((info: GPUDeviceLostInfo) => void) | undefined;
  const lease: FakeLease = {
    // eslint-disable-next-line no-restricted-syntax -- test stand-in: the surface reads only `device` off the handle, and only for its own getter
    gpu: { device: {} } as GpuHandle,
    released: false,
    onLost: (l) => {
      listener = l;
    },
    release: () => {
      lease.released = true;
      listener = undefined;
    },
    // eslint-disable-next-line no-restricted-syntax -- test stand-in: the listener reads only `reason` and `message`
    lose: () => listener?.({ reason: "unknown", message: "driver reset" } as GPUDeviceLostInfo),
  };
  return lease;
}

const renderer = (): SurfaceRenderer => ({
  present: async () => {},
  release: () => {},
  destroy: () => {},
  held: { textures: 0, bytes: 0, inUse: 0, images: 0, imageBytes: 0, strokes: 0, geometry: 0, tiles: 0, tileBytes: 0 },
  // eslint-disable-next-line no-restricted-syntax -- test stand-in: the surface never reads the stats it passes through
  stats: {} as SurfaceRenderer["stats"],
});

async function surface(openLease: () => Promise<GpuLease>): Promise<{ s: SceneSurface; first: FakeLease; unconfigured: () => number }> {
  let unconfigured = 0;
  const ctx = { configure: () => {}, unconfigure: () => unconfigured++, getCurrentTexture: () => ({}) };
  // eslint-disable-next-line no-restricted-syntax -- test stand-in: the surface uses only getContext("webgpu") and style
  const canvas = { getContext: () => ctx, style: {} } as unknown as HTMLCanvasElement;
  const first = fakeLease();
  const s = new SceneSurface({ canvas, size: { width: 40, height: 30 }, ratio: 1, seed: 1, decl: {}, draw: () => {}, text: await openTextMeasurer(), lease: first, onError: () => {}, openLease, makeRenderer: renderer });
  return { s, first, unconfigured: () => unconfigured };
}

test("a figure torn down while its new device is opening ends torn down, and lets the new device go", async () => {
  let resolve: (lease: GpuLease) => void = () => {};
  const second = fakeLease();
  const { s, first, unconfigured } = await surface(() => new Promise((r) => (resolve = r)));
  first.lose();
  assert.equal(s.state, "lost");
  const waking = s.wake();
  await new Promise((r) => setImmediate(r));
  const destroying = s.destroy();
  resolve(second);
  await Promise.all([waking, destroying]);
  assert.equal(s.state, "destroyed");
  assert.equal(second.released, true);
  assert.equal(first.released, true);
  assert.equal(unconfigured(), 1);
});

test("a reopen that fails leaves the figure lost, and the next wake tries again", async () => {
  let attempts = 0;
  const { s, first } = await surface(async () => {
    attempts++;
    if (attempts === 1) throw new NoAdapterError();
    return fakeLease();
  });
  first.lose();
  await assert.rejects(s.wake(), NoAdapterError);
  assert.equal(s.state, "lost");
  await s.wake();
  assert.equal(attempts, 2);
  assert.equal(s.state, "awake");
  await s.destroy();
});
