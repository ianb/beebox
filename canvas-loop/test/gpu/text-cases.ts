// Text on the GPU, run by gpu.test.ts: labels against today's Skia render of
// the same calls. Glyph rasterisation may differ by eye; where each label's ink
// sits and how big it is must match (within a pixel), and `v.text` must return
// today's bounds.
import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import type { TextBox, TextOptions } from "../../src/core/paint.js";
import type { TextMeasurer } from "../../src/core/text/measure.js";
import type { GpuHandle } from "../../src/device/open.js";
import { teaView } from "../helpers.js";
import { parity, premultiplied } from "./compare.js";
import { renderOnce } from "./render.js";

const LABELS: readonly (readonly [string, TextBox, TextOptions])[] = [
  ["Hello world", { x: 20, y: 20 }, { size: 12 }],
  ["Centred label", { x: 320, y: 50 }, { size: 18, align: "center" }],
  ["Right, middle", { x: 620, y: 100 }, { size: 14, align: "right", valign: "middle" }],
  ["Baseline Ag", { x: 20, y: 150 }, { size: 24, valign: "baseline" }],
  ["Bottom edge", { x: 220, y: 150 }, { size: 16, valign: "bottom" }],
  ["Wrapped text in a box that wraps over several lines", { x: 20, y: 180, w: 200, h: 90 }, { size: 14 }],
  ["Bold teal", { x: 330, y: 190 }, { size: 20, style: "bold", fill: "#2a9d8f" }],
  ["Halo", { x: 330, y: 250 }, { size: 28, fill: "#ffffff", halo: "#1d3557" }],
  ["Italic serif", { x: 20, y: 300 }, { size: 18, font: "serif", style: "italic" }],
  ["0123456789 small", { x: 330, y: 320 }, { size: 10 }],
  ["Centred in a box", { x: 400, y: 360, w: 200, h: 60 }, { size: 16, align: "center", valign: "middle" }],
];

const BG = "#fdfcf8";

/** The box of pixels inside `rect` that differ from the ground by more than 40 luminance levels. */
function inkBox(d: Uint8Array, at: { width: number; rect: readonly [number, number, number, number] }): readonly [number, number, number, number] | undefined {
  const [rx, ry, rw, rh] = at.rect;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let y = Math.max(0, ry); y < ry + rh; y++) {
    for (let x = Math.max(0, rx); x < Math.min(at.width, rx + rw); x++) {
      const i = (y * at.width + x) * 4;
      const l = 0.2126 * (d[i] ?? 0) + 0.7152 * (d[i + 1] ?? 0) + 0.0722 * (d[i + 2] ?? 0);
      if (Math.abs(l - 252) <= 40) continue;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  }
  return Number.isFinite(x0) ? [x0, y0, x1, y1] : undefined;
}

export async function textParity(handle: GpuHandle, a: { t: TestContext; text: TextMeasurer }): Promise<void> {
  const size = { width: 640, height: 440 };
  const ref = teaView(size);
  ref.v.background(BG);
  const refBounds = LABELS.map(([s, box, o]) => ref.v.text(s, box, o));
  const sceneBounds: unknown[] = [];
  const gpu = await renderOnce(handle, { size, text: a.text, draw: (v) => {
    v.background(BG);
    for (const [s, box, o] of LABELS) sceneBounds.push(v.text(s, box, o));
  } });
  assert.deepEqual(sceneBounds, refBounds, "v.text returns today's bounds");
  const refPx = premultiplied(ref.pixels());
  const worst = { shift: 0, size: 0 };
  for (const [i, b] of refBounds.entries()) {
    const rect = [Math.floor(b.x) - 6, Math.floor(b.y) - 6, Math.ceil(b.w) + 12, Math.ceil(b.h) + 12] as const;
    const r = inkBox(refPx, { width: size.width, rect });
    const g = inkBox(gpu.data, { width: size.width, rect });
    assert.ok(r !== undefined && g !== undefined, `label ${i} has ink in both`);
    const shift = Math.max(Math.abs(r[0] - g[0]), Math.abs(r[1] - g[1]));
    const grow = Math.max(Math.abs(r[2] - r[0] - (g[2] - g[0])), Math.abs(r[3] - r[1] - (g[3] - g[1])));
    worst.shift = Math.max(worst.shift, shift);
    worst.size = Math.max(worst.size, grow);
    const p = parity({ ref: refPx, gpu: gpu.data }, { ...size, rect });
    a.t.diagnostic(`${JSON.stringify(LABELS[i]?.[0]).padEnd(56)} ink box ref ${r.join(",")} gpu ${g.join(",")}; flat ${p.flat}% edge ${p.edgeMean} max ${p.maxFlat}`);
  }
  const whole = parity({ ref: refPx, gpu: gpu.data }, { ...size, rect: [0, 0, size.width, size.height] });
  a.t.diagnostic(`whole sheet: flat ${whole.flat}% edge ${whole.edgeMean}; worst ink-box shift ${worst.shift} px, worst size difference ${worst.size} px`);
  assert.ok(worst.shift <= 1 && worst.size <= 1, `labels sit where today's do, at today's size (shift ${worst.shift}, size ${worst.size})`);
}

export async function rotatedText(handle: GpuHandle, text: TextMeasurer): Promise<void> {
  const size = { width: 120, height: 80 };
  const px = await renderOnce(handle, { size, text, ratio: 2, draw: (v) => {
    v.background(BG);
    v.at({ translate: [20, 20], rotate: 0.5 }, () => v.text("turned", { x: 0, y: 0 }, { size: 16 }));
  } });
  const box = inkBox(px.data, { width: px.width, rect: [0, 0, px.width, px.height] });
  assert.ok(box !== undefined && box[3] - box[1] > 40, "rotated text draws, its ink running downhill");
}
