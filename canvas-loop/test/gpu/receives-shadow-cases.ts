// `material.receivesShadow: false` on the GPU (draft 2.9 section 21), run by
// renderer.gpu.test.ts: a backdrop that no shadow falls on, read per unit of
// material coverage through a third material layer that only groups holding
// the value draw.
import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import type { GpuHandle } from "../../src/device/open.js";
import type { Pixels } from "../../src/gpu/renderer.js";
import { GpuRenderer } from "../../src/gpu/renderer.js";
import type { Drawing, Material, View } from "../../src/core/tea.js";
import { SceneRecorder } from "../../src/scene/recorder/view.js";
import { renderOnce, rgbaAt } from "./render.js";

const size = { width: 200, height: 120 };
const SKY: Material = { receivesShadow: false };
const CASTER: Material = { castsShadow: true };
/** Behind the caster, as seen from the lamp. */
const BEHIND = [140, 60] as const;

/** A pixel's green channel in linear light. */
function linear(px: Pixels, at: readonly [number, number]): number {
  const c = (rgbaAt(px, at)[1] ?? 0) / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** A lit group with one low lamp at the left, hard shadows; `body` draws everything else. */
function lit(body: (v: View) => Drawing) {
  return (v: View): Drawing => v.group({ lighting: { ambient: "#202020", shadows: "hard" } }, [
    body(v),
    v.light({ kind: "point", at: [30, 60], height: 60, energy: 2, reach: 600 }),
  ]);
}

const caster = (v: View): Drawing => v.rect(70, 30, 20, 60, { fill: "#606060", material: CASTER });

/** A sky (upper part, non-receiving) over a floor (lower part, receiving), and a caster across both. */
export async function skyKeepsLight(handle: GpuHandle, t: TestContext): Promise<void> {
  const scene = (a: { sky: Material | undefined; caster: boolean }) => lit((v) => {
    const out: Drawing[] = [];
    out.push(v.rect(0, 0, 200, 60, { fill: "#a0a0a0", ...(a.sky === undefined ? {} : { material: a.sky }) }));
    out.push(v.rect(0, 60, 200, 60, { fill: "#a0a0a0" }));
    if (a.caster) out.push(caster(v));
    return out;
  });
  const open = await renderOnce(handle, { size, draw: scene({ sky: SKY, caster: false }) });
  const shaded = await renderOnce(handle, { size, draw: scene({ sky: undefined, caster: true }) });
  const kept = await renderOnce(handle, { size, draw: scene({ sky: SKY, caster: true }) });
  const sky = [140, 40] as const;
  const floor = [140, 80] as const;
  t.diagnostic(`sky behind the caster, linear: open ${linear(open, sky).toFixed(4)}, receiving ${linear(shaded, sky).toFixed(4)}, non-receiving ${linear(kept, sky).toFixed(4)}`);
  assert.ok(linear(shaded, sky) < 0.3 * linear(open, sky), "a receiving sky takes the caster's shadow");
  assert.deepEqual(rgbaAt(kept, sky), rgbaAt(open, sky), "a non-receiving sky keeps its lit pixels");
  for (let x = 92; x < 200; x++) {
    for (let y = 0; y < 58; y++) assert.deepEqual(rgbaAt(kept, [x, y]), rgbaAt(open, [x, y]), `no shadow on the sky at (${x},${y})`);
  }
  assert.ok(linear(kept, floor) < 0.3 * linear(open, floor), "the receiving floor below still takes the shadow");
}

/**
 * A half-transparent non-receiving disc alone (nothing under it in the group) receives no shadow on any pixel,
 * its antialiased edge included; the same disc receiving does.
 */
export async function translucentNonReceiver(handle: GpuHandle): Promise<void> {
  const scene = (a: { material: Material | undefined; caster: boolean }) => lit((v) => {
    const out: Drawing[] = [];
    out.push(v.circle(140, 60, 30.5, { fill: "rgba(160,160,160,0.5)", ...(a.material === undefined ? {} : { material: a.material }) }));
    if (a.caster) out.push(caster(v));
    return out;
  });
  const open = await renderOnce(handle, { size, draw: scene({ material: SKY, caster: false }) });
  const kept = await renderOnce(handle, { size, draw: scene({ material: SKY, caster: true }) });
  const shaded = await renderOnce(handle, { size, draw: scene({ material: undefined, caster: true }) });
  let edge = 0;
  for (let y = 26; y < 95; y++) {
    for (let x = 106; x < 175; x++) {
      const a = rgbaAt(open, [x, y]);
      if ((a[3] ?? 0) > 0 && (a[3] ?? 0) < 127) edge++;
      assert.deepEqual(rgbaAt(kept, [x, y]), a, `no shadow on the disc at (${x},${y})`);
    }
  }
  assert.ok(edge > 20, `the disc has an antialiased edge to test (${edge} pixels)`);
  assert.ok(linear(shaded, BEHIND) < 0.5 * linear(open, BEHIND), "the same disc, receiving, takes the shadow");
}

/** The same half-transparent non-receiving shape over an opaque receiving floor receives half the shadow. */
export async function halfOverReceiver(handle: GpuHandle, t: TestContext): Promise<void> {
  const scene = (a: { material: Material | undefined; caster: boolean }) => lit((v) => {
    const out: Drawing[] = [];
    out.push(v.rect(0, 0, 200, 120, { fill: "#a0a0a0" }));
    out.push(v.rect(110, 20, 60, 80, { fill: "rgba(160,160,160,0.5)", ...(a.material === undefined ? {} : { material: a.material }) }));
    if (a.caster) out.push(caster(v));
    return out;
  });
  const u = linear(await renderOnce(handle, { size, draw: scene({ material: SKY, caster: false }) }), BEHIND);
  const f = linear(await renderOnce(handle, { size, draw: scene({ material: undefined, caster: true }) }), BEHIND);
  const h = linear(await renderOnce(handle, { size, draw: scene({ material: SKY, caster: true }) }), BEHIND);
  t.diagnostic(`floor under a half-alpha overlay, linear: open ${u.toFixed(4)}, overlay receiving ${f.toFixed(4)}, overlay non-receiving ${h.toFixed(4)}`);
  assert.ok(f < 0.3 * u, "the caster shadows the floor and overlay");
  assert.ok(Math.abs(h - (u + f) / 2) < 0.05 * u, "half the pixel's material receives no shadow: half the shadow");
}

/** A placement's `material` supplies `receivesShadow` to the picture's shapes that have none. */
export async function placedNonReceiver(handle: GpuHandle): Promise<void> {
  const scene = (a: { material: Material | undefined; caster: boolean }) => lit((v) => {
    const out: Drawing[] = [];
    const sky = v.picture({ key: "sky", width: 200, height: 120 }, () => v.rect(0, 0, 200, 120, { fill: "#a0a0a0" }));
    out.push(v.place(sky, 0, 0, a.material === undefined ? {} : { material: a.material }));
    if (a.caster) out.push(caster(v));
    return out;
  });
  const open = await renderOnce(handle, { size, draw: scene({ material: SKY, caster: false }) });
  const kept = await renderOnce(handle, { size, draw: scene({ material: SKY, caster: true }) });
  const shaded = await renderOnce(handle, { size, draw: scene({ material: undefined, caster: true }) });
  assert.ok(linear(shaded, BEHIND) < 0.3 * linear(open, BEHIND), "placed without it, the picture takes the shadow");
  assert.deepEqual(rgbaAt(kept, BEHIND), rgbaAt(open, BEHIND), "placed with receivesShadow: false, it keeps its lit pixels");
}

/** A non-receiving caster still casts onto a receiving floor. */
export async function nonReceivingCaster(handle: GpuHandle): Promise<void> {
  const scene = (material: Material | undefined) => lit((v) => {
    const out: Drawing[] = [];
    out.push(v.rect(0, 0, 200, 120, { fill: "#a0a0a0" }));
    if (material !== undefined) out.push(v.rect(70, 30, 20, 60, { fill: "#606060", material }));
    return out;
  });
  const open = await renderOnce(handle, { size, draw: scene(undefined) });
  const casting = await renderOnce(handle, { size, draw: scene({ castsShadow: true, receivesShadow: false }) });
  assert.ok(linear(casting, BEHIND) < 0.3 * linear(open, BEHIND), "the non-receiving caster shadows the floor behind it");
}

/** A lit group without the value draws two material layers, as before; with it, a third. */
export async function materialLayerCount(handle: GpuHandle): Promise<void> {
  const jobs = async (material: Material | undefined): Promise<number> => {
    const renderer = new GpuRenderer(handle);
    try {
      const scene = new SceneRecorder(size).record(lit((v) => {
        return [
          v.rect(0, 0, 200, 120, { fill: "#a0a0a0", ...(material === undefined ? {} : { material }) }),
          caster(v),
        ];
      })).scene;
      await renderer.render(scene, 1);
      return renderer.stats.jobs;
    } finally {
      renderer.destroy();
    }
  };
  const plain = await jobs(undefined);
  const receiving = await jobs({ receivesShadow: true });
  const nonReceiving = await jobs(SKY);
  // The canvas, the lit group's colour layer, and its material layers.
  assert.equal(plain, 4, "without the value: the canvas, the group and two material layers");
  assert.equal(receiving, 4, "receivesShadow: true draws no third layer");
  assert.equal(nonReceiving, 5, "receivesShadow: false draws a third material layer");
}
