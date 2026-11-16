// Testing mode's faint-mark readback (gpu/peaks.ts): the peak-writing draw
// leaves colour output byte-identical, and the peaks it reads are the marks'
// resolved alpha times the opacity of the groups around them.
import assert from "node:assert/strict";
import type { GpuHandle } from "../../src/device/open.js";
import { GpuRenderer } from "../../src/gpu/renderer.js";
import type { MarkPeak, Pixels } from "../../src/gpu/renderer.js";
import type { View } from "../../src/core/tea.js";
import type { Scene } from "../../src/scene/nodes.js";
import { SceneRecorder } from "../../src/scene/recorder/view.js";

// Marks of every source the composite draw reads (ink coverage pieces, painted
// and tinted dabs, bristle runs), under blends that take the fixed and the
// backdrop pipelines, clipped, in groups and in a placed picture.
function marks(v: View): void {
  v.background("#f4efe6");
  v.line(10, 10, 150, 20, { stroke: "rgba(20,40,90,0.6)", weight: 6, brush: "ink" });
  v.line(10, 30, 150, 40, { stroke: "#b03a2e", weight: 8, brush: "pencil" });
  v.line(10, 50, 150, 60, { stroke: "#2a9d8f", weight: 10, brush: "chalk", blend: "multiply" });
  v.line(10, 70, 150, 80, { stroke: "#264653", weight: 12, brush: "bristle" });
  v.line(10, 90, 150, 100, { stroke: "#e9c46a", weight: 14, brush: "airbrush", blend: "screen" });
  v.group({ opacity: 0.5 }, () => v.clip([[50, 30], [110, 30], [110, 90], [50, 90]], () => v.line(40, 40, 120, 90, { stroke: "#000", weight: 9, brush: "marker" })));
  const tile = v.picture({ key: "tile", width: 40, height: 40 }, () => v.line(4, 4, 36, 36, { stroke: "#7a4", weight: 5, brush: "pencil" }));
  v.place(tile, 110, 70);
}

/** Render `scene`; each measured mark's peak by its line's first y, in increasing y. */
async function renderWith(handle: GpuHandle, a: { scene: Scene; peaks: boolean }): Promise<{ px: Pixels; peaks: readonly number[] }> {
  const renderer = new GpuRenderer(handle, { peaks: a.peaks });
  const yOf = (p: MarkPeak): number => (p.node.geom.kind === "poly" ? (p.node.geom.points[0]?.[1] ?? 0) : 0);
  try {
    const px = await renderer.render(a.scene, 2);
    return { px, peaks: renderer.peaks.toSorted((p, q) => yOf(p) - yOf(q)).map((p) => p.alpha) };
  } finally {
    renderer.destroy();
  }
}

export async function peakVariantSameBytes(handle: GpuHandle): Promise<void> {
  const scene = new SceneRecorder({ width: 160, height: 110 }).record(marks).scene;
  const plain = await renderWith(handle, { scene, peaks: false });
  const measured = await renderWith(handle, { scene, peaks: true });
  assert.deepEqual(plain.peaks, [], "a renderer made without peaks measures none");
  assert.equal(measured.peaks.length, 7, "every brushed mark drawn in colour has a peak");
  assert.ok(Buffer.from(measured.px.data).equals(Buffer.from(plain.px.data)), "the peak-writing draw leaves the colour output byte-identical");
}

export async function peaksMeasured(handle: GpuHandle): Promise<void> {
  const scene = new SceneRecorder({ width: 80, height: 60 }).record((v) => {
    v.line(5, 10, 70, 10, { stroke: "#000", weight: 6, brush: "marker" });
    v.line(5, 25, 70, 25, { stroke: "rgba(0,0,0,0.5)", weight: 6, brush: "ink" });
    v.group({ opacity: 0.25 }, () => v.group({ opacity: 0.5 }, () => v.line(5, 40, 70, 40, { stroke: "#000", weight: 6, brush: "ink" })));
    v.line(5, 50, 70, 50, { stroke: "#000", weight: 6, brush: "ink", erase: true });
  }).scene;
  const { peaks } = await renderWith(handle, { scene, peaks: true });
  const [marker, half, nested, ...rest] = peaks;
  assert.deepEqual(rest, [], "an erasing mark is not measured");
  assert.ok(marker !== undefined && Math.abs(marker - 0.7) < 0.01, `an opaque marker peaks at its preset's brush opacity, 0.7 (${String(marker)})`);
  assert.ok(half !== undefined && Math.abs(half - 0.5) < 0.02, `paint alpha 0.5 peaks at 0.5 (${String(half)})`);
  assert.ok(nested !== undefined && Math.abs(nested - 0.125) < 0.01, `nested group opacities multiply: 0.25 × 0.5 (${String(nested)})`);
}

// Review probe: a picture kept from an earlier frame, placed fainter, still has its marks judged (and is still reused).
export async function keptPictureFaint(handle: GpuHandle): Promise<void> {
  const recorder = new SceneRecorder({ width: 80, height: 60 });
  const frame = (opacity: number): Scene =>
    recorder.record((v) => {
      const sign = v.picture({ key: "sign", width: 60, height: 20 }, () => v.line(4, 10, 56, 10, { stroke: "#000", weight: 4, brush: "ink" }));
      v.place(sign, 10, 20, { opacity });
    }).scene;
  const renderer = new GpuRenderer(handle, { peaks: true });
  try {
    await renderer.render(frame(1), 1);
    const [first] = renderer.peaks;
    assert.ok(first !== undefined && first.alpha > 0.9, `drawn at full opacity, the ink peaks near 1 (${String(first?.alpha)})`);
    await renderer.render(frame(0.01), 1);
    assert.ok(renderer.stats.tileHits > 0, "the picture's tile is reused");
    assert.equal(renderer.stats.tilesDrawn, 0);
    const [again] = renderer.peaks;
    assert.ok(again !== undefined && again.node === first.node && Math.abs(again.alpha - 0.01) < 0.002, `reused at 1%, the kept peak times 0.01 (${String(again?.alpha)})`);
  } finally {
    renderer.destroy();
  }
}
