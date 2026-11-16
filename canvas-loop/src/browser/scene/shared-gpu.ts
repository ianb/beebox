// One GPU device for every scene figure on a page. Figures lease it; the last
// lease to end destroys it. A lost device is reported once (console.warn) and
// forgotten, so the next lease (a figure waking) opens a new one.
import type { GpuHandle } from "../../device/open.js";
import { openBrowserGpu } from "../../device/browser.js";
import { NoGpuAdapterError, NoWebGpuError } from "../../scene/errors.js";

/** A figure's hold on the shared device; `release` is idempotent and drops its loss listener. */
export interface GpuLease {
  readonly gpu: GpuHandle;
  /** Call `listener` if the device is lost for any reason but its own destruction (one listener per lease; a later call replaces it). */
  onLost(listener: (info: GPUDeviceLostInfo) => void): void;
  release(): void;
}

/** Opens a lease; the browser mount's is `leaseGpu`, tests pass their own. */
export type LeaseGpu = () => Promise<GpuLease>;

type LostListener = (info: GPUDeviceLostInfo) => void;

interface Shared {
  readonly opening: Promise<GpuHandle>;
  users: number;
  /** Lost or destroyed: new leases open another device. */
  gone: boolean;
  /** The live leases' loss listeners, removed when a lease ends so a torn-down figure is not kept reachable. */
  readonly listeners: Set<LostListener>;
}

let shared: Shared | undefined;

/** Whether the browser offers WebGPU at all (the scene renderer has no Canvas2D fallback). */
export function hasWebGpu(): boolean {
  const nav: unknown = Reflect.get(globalThis, "navigator");
  return typeof nav === "object" && nav !== null && typeof Reflect.get(nav, "gpu") === "object" && Reflect.get(nav, "gpu") !== null;
}

function open(): Shared {
  const opening = openBrowserGpu().then((gpu) => {
    if (gpu === undefined) throw new NoGpuAdapterError({ browser: true });
    return gpu;
  });
  const entry: Shared = { opening, users: 0, gone: false, listeners: new Set() };
  void opening.then(
    async (gpu) => {
      const info = await gpu.device.lost;
      const ours = entry.gone;
      entry.gone = true;
      if (ours) return;
      console.warn(`canvas-loop: the GPU device was lost (${info.reason}: ${info.message}); scene figures redraw when they next come into view`);
      const listeners = [...entry.listeners];
      entry.listeners.clear();
      for (const listener of listeners) listener(info);
    },
    () => {
      entry.gone = true;
    },
  );
  return entry;
}

/** Lease the page's device, opening it when there is none. Throws `NoWebGpuError` without WebGPU, `NoGpuAdapterError` without an adapter. */
export async function leaseGpu(): Promise<GpuLease> {
  if (!hasWebGpu()) throw new NoWebGpuError();
  if (shared === undefined || shared.gone) shared = open();
  const entry = shared;
  entry.users++;
  let gpu: GpuHandle;
  try {
    gpu = await entry.opening;
  } catch (error) {
    entry.users--;
    if (shared === entry) shared = undefined;
    throw error;
  }
  let released = false;
  let mine: LostListener | undefined;
  return {
    gpu,
    onLost: (listener) => {
      if (mine !== undefined) entry.listeners.delete(mine);
      mine = released ? undefined : listener;
      if (mine !== undefined) entry.listeners.add(mine);
    },
    release: () => {
      if (released) return;
      released = true;
      if (mine !== undefined) entry.listeners.delete(mine);
      mine = undefined;
      entry.users--;
      if (entry.users > 0) return;
      if (shared === entry) shared = undefined;
      if (entry.gone) return;
      entry.gone = true;
      gpu.destroy();
    },
  };
}

/** Testing: destroy the page's device as a driver reset would, so every figure on it sees a lost device. */
export async function loseSharedDevice(): Promise<void> {
  const entry = shared;
  if (entry === undefined) return;
  const gpu = await entry.opening;
  gpu.destroy();
}
