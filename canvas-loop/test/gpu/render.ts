// Rendering helpers the GPU case files share (all run in renderer.gpu.test.ts, one Dawn device per process).
import type { TextMeasurer } from "../../src/core/text/measure.js";
import type { View } from "../../src/core/tea.js";
import type { GpuHandle } from "../../src/device/open.js";
import { GpuRenderer } from "../../src/gpu/renderer.js";
import type { Pixels } from "../../src/gpu/renderer.js";
import { SceneRecorder } from "../../src/scene/recorder/view.js";

export interface Size {
  readonly width: number;
  readonly height: number;
}

/** Record `draw` and render it once with a fresh renderer. */
export async function renderOnce(handle: GpuHandle, s: { size: Size; draw: (v: View) => void; ratio?: number; text?: TextMeasurer }): Promise<Pixels> {
  const renderer = new GpuRenderer(handle);
  try {
    const rec = new SceneRecorder(s.size, s.text === undefined ? {} : { text: s.text });
    return await renderer.render(rec.record(s.draw).scene, s.ratio ?? 1);
  } finally {
    renderer.destroy();
  }
}

export const alphaAt = (px: Pixels, at: readonly [number, number]): number => px.data[(at[1] * px.width + at[0]) * 4 + 3] ?? 0;
export const rgbaAt = (px: Pixels, at: readonly [number, number]): number[] => [...px.data.subarray((at[1] * px.width + at[0]) * 4, (at[1] * px.width + at[0]) * 4 + 4)];

/** Pixels of `a` inside `rect` that differ from `b` shifted by (dx, dy): count and largest channel difference. */
export function shiftedDiff(pair: { a: Pixels; b: Pixels }, at: { rect: readonly [number, number, number, number]; dx: number; dy: number }): { differ: number; max: number } {
  const { a, b } = pair;
  const [rx, ry, rw, rh] = at.rect;
  let differ = 0;
  let max = 0;
  for (let y = ry; y < ry + rh; y++) {
    for (let x = rx; x < rx + rw; x++) {
      const i = (y * a.width + x) * 4;
      const j = ((y + at.dy) * b.width + x + at.dx) * 4;
      let m = 0;
      for (let k = 0; k < 4; k++) m = Math.max(m, Math.abs((a.data[i + k] ?? 0) - (b.data[j + k] ?? 0)));
      if (m > 0) differ++;
      max = Math.max(max, m);
    }
  }
  return { differ, max };
}
