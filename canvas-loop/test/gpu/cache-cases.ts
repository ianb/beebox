// Cache equivalence (draft section 6), run by renderer.gpu.test.ts: the same recorded
// frames rendered by a renderer that keeps what it may (warm), by one that
// keeps nothing (caches off), and by a fresh renderer for each frame (cold, as
// after waking) give the same bytes. The frames move things by whole and by
// fractional device pixels, come back to earlier positions, and use every
// kept thing: coverage geometry, brush expansions, picture tiles, clip pages.
import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import type { TextMeasurer } from "../../src/core/text/measure.js";
import type { View } from "../../src/scene/api.js";
import type { GpuHandle } from "../../src/device/open.js";
import { GpuRenderer } from "../../src/gpu/renderer.js";
import { SceneRecorder } from "../../src/scene/recorder/view.js";
import type { Scene } from "../../src/scene/nodes.js";
import type { Vec2 } from "../../src/core/paint.js";
import { SeededRandom } from "../../src/core/prng.js";
import { TeaUtil } from "../../src/headless/tea-util.js";
import type { ParamsDecl } from "../../src/core/tea.js";

/** Render each scene warm, with caches off, and cold; assert equal bytes. Returns what the warm renderer reused. */
export async function sameWarmColdOff(handle: GpuHandle, a: { scenes: readonly Scene[]; ratio: number; what: string }): Promise<{ kept: number; tiles: number; strokes: number }> {
  const warm = new GpuRenderer(handle);
  const off = new GpuRenderer(handle, { caches: false });
  const used = { kept: 0, tiles: 0, strokes: 0 };
  try {
    for (const [i, scene] of a.scenes.entries()) {
      const w = await warm.render(scene, a.ratio);
      used.kept += warm.stats.keptHits;
      used.tiles += warm.stats.tileHits;
      used.strokes += warm.stats.cacheHits;
      const o = await off.render(scene, a.ratio);
      const fresh = new GpuRenderer(handle);
      let c;
      try {
        c = await fresh.render(scene, a.ratio);
      } finally {
        fresh.destroy();
      }
      assert.ok(Buffer.from(w.data).equals(Buffer.from(o.data)), `${a.what}, frame ${i}: warm and caches-off renders differ`);
      assert.ok(Buffer.from(w.data).equals(Buffer.from(c.data)), `${a.what}, frame ${i}: warm and cold renders differ`);
    }
  } finally {
    warm.destroy();
    off.destroy();
  }
  return used;
}

const star: Vec2[] = Array.from({ length: 10 }, (_, i): Vec2 => [40 + (i % 2 === 0 ? 30 : 12) * Math.cos(-Math.PI / 2 + (Math.PI * i) / 5), 40 + (i % 2 === 0 ? 30 : 12) * Math.sin(-Math.PI / 2 + (Math.PI * i) / 5)]);

/** A wide still picture: shapes, a gradient, brushes, a blurred group, a nested clip, text, a nested picture. */
function room(v: View, text: boolean): void {
  v.rect(0, 0, 1400, 220, { fill: v.linearGradient(0, 0, 1400, 0, [[0, "#e8dcc0"], [1, "#9ab0c8"]]) });
  for (let x = 20; x < 1400; x += 90) {
    v.roundRect(x, 40, 60, 120, 8, { fill: "#6a5040", stroke: "#2a1a10", weight: 2 });
    v.curve([[x, 175], [x + 30, 160], [x + 60, 178]], false, { stroke: "#1d2a44", weight: 3, brush: "ink" });
  }
  v.clip(v.curvePath(star, true), () => {
    v.rect(0, 0, 90, 90, { fill: "#c04a7a" });
    v.clip([[[20, 20], [60, 20], [60, 60], [20, 60]], [[50, 50], [80, 50], [80, 80], [50, 80]]], () => v.circle(45, 45, 40, { fill: "#2f6b3a" }));
  });
  v.group({ effects: { blur: 3, shadow: { x: 4, y: 4, blur: 3, color: "rgba(0,0,0,0.5)" } } }, () => v.circle(700, 100, 40, { fill: "#e0b02a" }));
  v.curve([[300, 200], [700, 190], [1100, 205]], false, { stroke: "#b0563a", weight: 10, brush: "chalk" });
  if (text) v.text("kept tiles", { x: 1000, y: 20 }, { size: 18, fill: "#1a1410", align: "left", valign: "top" });
  v.place(v.picture({ key: "badge", width: 40, height: 40 }, () => v.circle(20, 20, 16, { fill: "#3a6a9a", stroke: "#fff", weight: 3 })), 1200, 120);
}

/** A sketch-like sequence: a still room panned by whole and by fractional pixels and back, live shapes moving over it, a smudge in a clip. */
export function movingFrames(a: { text: TextMeasurer | undefined }): Scene[] {
  const size = { width: 400, height: 260 };
  const rec = new SceneRecorder(size, a.text === undefined ? {} : { text: a.text });
  const pans = [0, -3, -3, -3.25, -40, -0.5, -3.25, -3, -900, -900.5];
  return pans.map((pan, f) => rec.record((v) => {
    v.background("#20242a");
    const pic = v.picture({ key: "room", width: 1400, height: 220 }, () => room(v, a.text !== undefined));
    v.at({ translate: [pan, 20] }, () => v.place(pic, 0, 0));
    v.at({ translate: [100 + f * 7.5, 120] }, () => {
      v.circle(0, 0, 18, { fill: "#d8a070", stroke: "#1e1812", weight: 2 });
      v.curve([[-20, 30], [0, 50], [20, 30]], false, { stroke: "#1e1812", weight: 3, brush: "ink" });
    });
    v.line(10, 240, 10 + f * 30, 240, { stroke: "#e8b83a", weight: 4, brush: "pencil" });
    v.clip([[200, 150], [390, 150], [390, 250], [200, 250]], () => {
      v.rect(200, 150, 190, 100, { fill: "#3a7a7a" });
      v.rect(200, 180, 190, 20, { fill: "#e8d8b0" });
      v.curve([[210, 170], [300, 200], [380, 230]], false, { stroke: "#000", weight: 16, brush: "smudge", gesture: { pressure: "even", wobble: 0 } });
    });
  }).scene);
}

export async function cacheEquivalence(handle: GpuHandle, a: { t: TestContext; text: TextMeasurer | undefined }): Promise<void> {
  const scenes = movingFrames({ text: a.text });
  for (const ratio of [1, 2]) {
    const used = await sameWarmColdOff(handle, { scenes, ratio, what: `moving frames at ratio ${ratio}` });
    a.t.diagnostic(`ratio ${ratio}: warm renderer reused ${used.kept} geometry entries, ${used.tiles} picture tiles, ${used.strokes} brush expansions`);
    assert.ok(used.kept > 0 && used.tiles > 0 && used.strokes > 0, "the warm renderer reused geometry, tiles and expansions");
  }
}

interface PortModule {
  readonly canvas: { readonly width: number; readonly height: number };
  readonly params: ParamsDecl;
  init(...a: never[]): unknown;
  update(...a: never[]): unknown;
  draw(...a: never[]): void;
}

/** A ported sketch's frames `at` (ticks run for the frames between), recorded as the browser records them, with default params. */
export function portFrames(mod: PortModule, a: { at: readonly number[]; text: TextMeasurer }): Scene[] {
  const params: Record<string, number | boolean | string> = {};
  for (const [k, p] of Object.entries(mod.params)) if (p.type !== "trigger") params[k] = p.default;
  const where = { transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }, pixelRatio: 1, canvas: mod.canvas };
  const text = { width: a.text.width.bind(a.text), bounds: (...[content, box, options]: Parameters<TeaUtil<ParamsDecl>["textBounds"]>) => a.text.place(content, { box, options: options ?? {}, where }).bounds };
  const util = new TeaUtil({ random: new SeededRandom(42), getParams: () => params, onHandled: () => {}, log: () => {}, text });
  const rec = new SceneRecorder(mod.canvas, { text: a.text, seed: 42, params: { decl: mod.params, values: () => params } });
  const call = (n: "init" | "update" | "draw", args: unknown[]): unknown => Reflect.apply(mod[n], undefined, args);
  let model = call("init", [util]);
  const out: Scene[] = [];
  const last = Math.max(...a.at);
  for (let f = 0; f <= last; f++) {
    model = call("update", [model, { type: "tick", frame: f }, util]);
    const m = model;
    if (a.at.includes(f)) out.push(rec.record((v) => call("draw", [v, m, params])).scene);
  }
  return out;
}
