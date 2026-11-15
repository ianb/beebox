// Lit groups on the GPU (R8), run by gpu.test.ts: shadows by casting amount
// (partial alpha and erase), nesting, lights in placed pictures, a
// placement's material, and materials ignored outside a lit group.
import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import type { Lighting, Material, View } from "../../src/scene-draft/scene-api.js";
import type { GpuHandle } from "../../src/scene-spike/device.js";
import type { Pixels } from "../../src/scene-spike/gpu/renderer.js";
import { renderOnce, rgbaAt } from "./gpu-render.js";

const size = { width: 200, height: 120 };
const CASTER: Material = { castsShadow: true };

/** A pixel's green channel in linear light. */
function linear(px: Pixels, at: readonly [number, number]): number {
  const c = (rgbaAt(px, at)[1] ?? 0) / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** A grey floor lit by one low lamp at the left; `body` adds casters. */
function room(body: (v: View) => void) {
  const lighting: Lighting = { ambient: "#202020", shadows: "hard" };
  return (v: View): void => v.group({ lighting }, () => {
    v.rect(0, 0, 200, 120, { fill: "#a0a0a0" });
    body(v);
    v.light({ kind: "point", at: [30, 60], height: 60, energy: 2, reach: 600 });
  });
}

/** A caster at half alpha blocks half the light; an erased part of a caster casts no shadow. */
export async function castingAmount(handle: GpuHandle, t: TestContext): Promise<void> {
  const caster = (fill: string) => (v: View): void => v.rect(70, 30, 20, 60, { fill, material: CASTER });
  const open = await renderOnce(handle, { size, draw: room(() => {}) });
  const full = await renderOnce(handle, { size, draw: room(caster("#606060")) });
  const half = await renderOnce(handle, { size, draw: room(caster("rgba(96,96,96,0.5)")) });
  const p = [140, 60] as const;
  const u = linear(open, p);
  const f = linear(full, p);
  const h = linear(half, p);
  t.diagnostic(`floor behind the caster, linear: open ${u.toFixed(4)}, full caster ${f.toFixed(4)}, half-alpha caster ${h.toFixed(4)}`);
  assert.ok(f < 0.3 * u, "a caster shadows the floor behind it");
  assert.ok(Math.abs(h - (u + f) / 2) < 0.05 * u, "a caster at half alpha blocks half the light");
  const erased = await renderOnce(handle, { size, draw: room((v) => {
    caster("#606060")(v);
    v.rect(70, 52, 20, 16, { fill: "#000", erase: true });
  }) });
  assert.ok(Math.abs(linear(erased, p) - u) < 0.03 * u, "behind the erased strip the floor is lit");
  assert.ok(Math.abs(linear(erased, [140, 36]) - linear(full, [140, 36])) < 0.03 * u, "behind the rest of the caster it is in shadow");
  assert.ok(linear(full, [80, 60]) > 0.2 * u, "a caster does not shadow itself");
}

/** A lit group inside a lit group is lit only by its own lights; its result is not lit again. */
export async function nestedLighting(handle: GpuHandle): Promise<void> {
  const draw = (inner: boolean) => (v: View): void => v.group({ lighting: { ambient: "#202020" } }, () => {
    v.rect(0, 0, 200, 120, { fill: "#a0a0a0" });
    v.group({ lighting: { ambient: "#ffffff" } }, () => {
      v.rect(20, 20, 40, 40, { fill: "#ff0000" });
      if (inner) v.light({ kind: "point", at: [150, 60], height: 40, energy: 3 });
    });
  });
  const lit = await renderOnce(handle, { size, draw: draw(true) });
  const unlit = await renderOnce(handle, { size, draw: draw(false) });
  assert.deepEqual(rgbaAt(unlit, [40, 40]), [255, 0, 0, 255], "the inner result keeps its colour: it is not darkened by the outer ambient");
  assert.deepEqual(rgbaAt(lit, [150, 60]), rgbaAt(unlit, [150, 60]), "the inner group's light does not light the outer floor");
}

/** A light inside a placed picture lights the enclosing lit group wherever the picture is placed. */
export async function lightsInPictures(handle: GpuHandle, t: TestContext): Promise<void> {
  const brightest = (px: Pixels): number => {
    let best = 0;
    let at = 0;
    for (let x = 0; x < px.width; x++) {
      const g = rgbaAt(px, [x, 100])[1] ?? 0;
      if (g > best) [best, at] = [g, x];
    }
    return at;
  };
  const scene = (xs: readonly number[]) => (v: View): void => {
    const lamp = v.picture({ key: "lamp", width: 20, height: 20 }, () => v.light({ kind: "point", at: [10, 10], height: 30, reach: 120 }));
    v.group({ lighting: { ambient: "#000000" } }, () => {
      v.rect(0, 0, 400, 120, { fill: "#a0a0a0" });
      v.group({}, () => {
        for (const x of xs) v.place(lamp, x, 90);
      });
    });
  };
  const wide = { width: 400, height: 120 };
  const one = await renderOnce(handle, { size: wide, draw: scene([60]) });
  const moved = await renderOnce(handle, { size: wide, draw: scene([100]) });
  t.diagnostic(`brightest floor pixel at x ${brightest(one)}, then ${brightest(moved)}`);
  assert.equal(brightest(moved) - brightest(one), 40, "moving the placement moves its light");
  const two = await renderOnce(handle, { size: wide, draw: scene([60, 300]) });
  const g = (x: number): number => rgbaAt(two, [x, 100])[1] ?? 0;
  assert.ok(g(70) > 3 * g(190) && g(310) > 3 * g(190), "each placement brings its own light");
}

/** `place(…, { material })` gives the picture's shapes a material; materials outside a lit group change nothing. */
export async function materialScopes(handle: GpuHandle): Promise<void> {
  const card = (v: View): ReturnType<View["picture"]> => v.picture({ key: "card", width: 20, height: 60 }, () => v.rect(0, 0, 20, 60, { fill: "#606060" }));
  const placed = (material: Material | undefined) => room((v) => v.place(card(v), 70, 30, material === undefined ? {} : { material }));
  const plain = await renderOnce(handle, { size, draw: placed(undefined) });
  const casting = await renderOnce(handle, { size, draw: placed(CASTER) });
  assert.ok(linear(casting, [140, 60]) < 0.3 * linear(plain, [140, 60]), "the placement's material makes the picture cast a shadow");
  const shapes = (material: Material | undefined) => (v: View): void => {
    v.rect(10, 10, 80, 80, { fill: "#3b5d8a", ...(material === undefined ? {} : { material }) });
    v.place(card(v), 120, 20, material === undefined ? {} : { material });
  };
  const bare = await renderOnce(handle, { size, draw: shapes(undefined) });
  const ignored = await renderOnce(handle, { size, draw: shapes({ bevel: 8, emissive: 1, shine: 1, castsShadow: true }) });
  assert.ok(Buffer.from(bare.data).equals(Buffer.from(ignored.data)), "outside a lit group a material is ignored");
}

/** An emissive, unlit room: what a body draws shows its own colour, so coverage mistakes show as dark fringes. */
function dark(body: (v: View) => void) {
  return (v: View): void => v.group({ lighting: { ambient: "#000000" } }, () => body(v));
}
const GLOW: Material = { emissive: 1 };
/** Premultiplied red within 2 levels of alpha: a white or red pixel kept at full emissive strength. */
const fullRed = (px: Pixels, at: readonly [number, number]): boolean => {
  const [r = 0, , , a = 0] = rgbaAt(px, at);
  return a > 20 && Math.abs(r - a) <= 2;
};

/** Shading uses material per unit of coverage: a translucent emissive shape is not dimmed twice. */
export async function translucentMaterial(handle: GpuHandle): Promise<void> {
  const px = await renderOnce(handle, { size, draw: dark((v) => v.rect(20, 20, 60, 60, { fill: "rgba(255,0,0,0.5)", material: GLOW })) });
  const [r = 0, g = 0, b = 0, a = 0] = rgbaAt(px, [50, 50]);
  assert.ok(Math.abs(a - 128) <= 1 && Math.abs(r - a) <= 1 && g === 0 && b === 0, `half-alpha emissive red stays half-alpha red (got ${r},${g},${b},${a})`);
}

/** A feathered mask and a blurred nested lit group cut colour and material alike. */
export async function featheredCoverage(handle: GpuHandle): Promise<void> {
  const masked = await renderOnce(handle, { size, draw: dark((v) => v.mask(
    () => v.group({ effects: { blur: 6 } }, () => v.rect(50, 30, 60, 60, { fill: "#000" })),
    () => v.rect(0, 0, 200, 120, { fill: "#ff0000", material: GLOW }),
  )) });
  assert.ok(fullRed(masked, [46, 60]), `the mask's feather is lit as the body is (got ${rgbaAt(masked, [46, 60]).join(",")})`);
  const nested = await renderOnce(handle, { size, draw: dark((v) => v.group({ lighting: { ambient: "#ffffff" }, effects: { blur: 6 } }, () => v.rect(50, 30, 60, 60, { fill: "#ff0000" }))) });
  assert.ok(fullRed(nested, [46, 60]), `a nested lit group's blurred fringe is not darkened by the outer group (got ${rgbaAt(nested, [46, 60]).join(",")})`);
}

/** A spot whose cone is π lights every way, exactly as a point light. */
export async function fullCone(handle: GpuHandle): Promise<void> {
  const lamp = (spot: boolean) => (v: View): void => v.group({ lighting: { ambient: "#202020" } }, () => {
    v.rect(0, 0, 200, 120, { fill: "#a0a0a0" });
    v.light(spot ? { kind: "spot", at: [100, 60], height: 40, direction: 0, cone: Math.PI } : { kind: "point", at: [100, 60], height: 40 });
  });
  const spot = await renderOnce(handle, { size, draw: lamp(true) });
  const point = await renderOnce(handle, { size, draw: lamp(false) });
  assert.ok(Buffer.from(spot.data).equals(Buffer.from(point.data)), "a full-angle spot equals a point light");
}
