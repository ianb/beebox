// Lit groups on the GPU (R8), run by gpu.test.ts: shadows by casting amount
// (partial alpha and erase) and by caster and light height, nesting, lights
// in placed pictures, a placement's material, materials ignored outside a lit
// group, and exposure with the tone curve.
import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import type { Light, Lighting, Material, View } from "../../src/scene-draft/scene-api.js";
import type { GpuHandle } from "../../src/scene-spike/device.js";
import type { Pixels } from "../../src/scene-spike/gpu/renderer.js";
import { GpuRenderer } from "../../src/scene-spike/gpu/renderer.js";
import { SceneRecorder } from "../../src/scene-spike/recorder/view.js";
import { renderOnce, rgbaAt } from "./gpu-render.js";
import { sceneOutline } from "../../src/scene-spike/outline.js";

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
  // Soft shadows march through casters blurred by 3 px; this point's ray passes well clear of the erased strip.
  assert.ok(Math.abs(linear(erased, [140, 24]) - linear(full, [140, 24])) < 0.03 * u, "behind the rest of the caster it is in shadow");
  assert.ok(linear(full, [80, 60]) > 0.2 * u, "a caster does not shadow itself");
}

/** Where the floor along y = 60, right of x0, is first lit again (over 80% of the open floor), or the width. */
function shadowEnd(pair: { lit: Pixels; open: Pixels }, x0: number): number {
  for (let x = x0; x < pair.lit.width; x++) if (linear(pair.lit, [x, 60]) > 0.8 * linear(pair.open, [x, 60])) return x;
  return pair.lit.width;
}

/**
 * A caster's height and the light's height set its shadow's length: from a lamp at x 30 and
 * height H, a caster whose far side is at x 80 and height h shadows the floor to about
 * 80 + 50·h / (H − h).
 */
export async function casterHeights(handle: GpuHandle, t: TestContext): Promise<void> {
  const wide = { width: 320, height: 120 };
  const scene = (a: { h: number | true | undefined; lamp: number }) => (v: View): void => v.group({ lighting: { ambient: "#202020", shadows: "hard" } }, () => {
    v.rect(0, 0, 320, 120, { fill: "#a0a0a0" });
    if (a.h !== undefined) v.rect(74, 40, 6, 40, { fill: "#606060", material: { castsShadow: a.h } });
    v.light({ kind: "point", at: [30, 60], height: a.lamp, energy: 2, reach: 900 });
  });
  const end = async (h: number | true, lamp: number): Promise<number> => {
    const open = await renderOnce(handle, { size: wide, draw: scene({ h: undefined, lamp }) });
    return shadowEnd({ lit: await renderOnce(handle, { size: wide, draw: scene({ h, lamp }) }), open }, 81);
  };
  const [low, high, tall, byDefault, lowLamp] = [await end(20, 60), await end(40, 60), await end(40, 80), await end(true, 60), await end(20, 40)];
  t.diagnostic(`shadow ends at x: h 20 lamp 60 → ${low}, h 40 lamp 60 → ${high}, h 40 lamp 80 → ${tall}, true (32) lamp 60 → ${byDefault}, h 20 lamp 40 → ${lowLamp}`);
  const expect = (h: number, lamp: number): number => 80 + (50 * h) / (lamp - h);
  for (const [got, h, lamp] of [[low, 20, 60], [high, 40, 60], [tall, 40, 80], [byDefault, 32, 60], [lowLamp, 20, 40]] as const) {
    assert.ok(Math.abs(got - expect(h, lamp)) <= 10, `h ${h}, lamp ${lamp}: the shadow ends near x ${expect(h, lamp).toFixed(0)} (got ${got})`);
  }
  assert.ok(low < byDefault && byDefault < high, "a taller caster casts a longer shadow; true stands 32 tall");
  assert.ok(tall < high && lowLamp > low, "a higher lamp shortens the shadow, a lower one lengthens it");
}

/** A pixel on a caster sits at its height: a shorter caster in front does not shadow it, a taller one does. */
export async function casterOnCaster(handle: GpuHandle): Promise<void> {
  const scene = (front: number) => (v: View): void => v.group({ lighting: { ambient: "#202020", shadows: "hard" } }, () => {
    v.rect(0, 0, 200, 120, { fill: "#a0a0a0" });
    v.rect(100, 20, 60, 80, { fill: "#a0a0a0", material: { castsShadow: 30 } });
    v.rect(70, 40, 6, 40, { fill: "#606060", material: { castsShadow: front } });
    v.light({ kind: "point", at: [30, 60], height: 120, energy: 2, reach: 900 });
  });
  const shorter = await renderOnce(handle, { size, draw: scene(20) });
  const taller = await renderOnce(handle, { size, draw: scene(80) });
  const p = [104, 60] as const;
  assert.ok(linear(taller, p) < 0.5 * linear(shorter, p), "the taller caster shadows the top of the one behind it; the shorter does not");
}

/** The material layer, exposure and tone curve are deterministic: a second render and a fresh renderer agree, at ratio 1 and 2. */
export async function litRepeats(handle: GpuHandle): Promise<void> {
  const draw = (v: View): void => v.group({ lighting: { ambient: "#202030", shadows: "soft", exposure: 0.7, toneCurve: 0.8 } }, () => {
    v.rect(0, 0, 200, 120, { fill: "#a08f80" });
    v.roundRect(60, 30, 40, 60, 8, { fill: "#6b2e2a", material: { bevel: 6, shine: 0.3, castsShadow: 45 } });
    v.circle(140, 70, 14, { fill: "#4f78a8", material: { castsShadow: true } });
    v.light({ kind: "point", at: [30, 50], height: 70, color: "#ffd0a0", energy: 2.5, reach: 300 });
  });
  const renderer = new GpuRenderer(handle);
  try {
    const scene = new SceneRecorder(size).record(draw).scene;
    for (const ratio of [1, 2]) {
      const a = await renderer.render(scene, ratio);
      const b = await renderer.render(scene, ratio);
      assert.ok(Buffer.from(a.data).equals(Buffer.from(b.data)), `ratio ${ratio}: a second frame is byte-identical`);
      assert.ok(Buffer.from(a.data).equals(Buffer.from((await renderOnce(handle, { size, draw, ratio })).data)), `ratio ${ratio}: a fresh renderer gives the same bytes`);
    }
  } finally {
    renderer.destroy();
  }
}

/**
 * The tone curve is monotonic at every strength: along a floor lit by one lamp, brightness falls
 * steadily with distance. At full strength, highlights that clip without it stay below white,
 * and the darkest floor goes deeper.
 */
export async function toneCurve(handle: GpuHandle, t: TestContext): Promise<void> {
  const wide = { width: 300, height: 90 };
  const curves = [0, 0.5, 1];
  const px = await renderOnce(handle, { size: wide, draw: (v) => {
    for (const [k, curve] of curves.entries()) {
      v.group({ lighting: { ambient: "#000000", exposure: 1, toneCurve: curve } }, () => {
        v.rect(0, k * 30, 300, 30, { fill: "#c0c0c0" });
        v.light({ kind: "point", at: [0, k * 30 + 15], height: 20, energy: 3, reach: 320 });
      });
    }
  } });
  const row = (k: number): number[] => Array.from({ length: 300 }, (_, x) => rgbaAt(px, [x, k * 30 + 15])[1] ?? 0);
  const [clip = [], half = [], film = []] = curves.map((_, k) => row(k));
  for (const [k, r] of [clip, half, film].entries()) {
    const rises = r.findIndex((g, x) => x > 0 && g > (r[x - 1] ?? 0));
    assert.equal(rises, -1, `tone curve ${curves[k]}: brightness never rises away from the lamp (at x ${rises})`);
  }
  const clipped = clip.filter((g) => g === 255).length;
  const filmWhite = film.filter((g) => g === 255).length;
  t.diagnostic(`pixels at white: clip ${clipped}, film ${filmWhite}; at x 280: clip ${clip[280]}, film ${film[280]}`);
  assert.ok(clipped > 20 && filmWhite < clipped / 4, "highlights that clip roll off below white");
  assert.ok((film[280] ?? 0) < (clip[280] ?? 0), "the darkest floor goes deeper");
}

/** Linear green at `at` relative to the same pixel of `open`. */
const rel = (pair: { px: Pixels; open: Pixels }, at: readonly [number, number]): number => linear(pair.px, at) / linear(pair.open, at);

/** `castsShadow: 0` casts nothing: a zero-height floor still receives another caster's shadow. */
export async function zeroHeightFloor(handle: GpuHandle): Promise<void> {
  const draw = (caster: boolean) => (v: View): void => v.group({ lighting: { ambient: "#202020", shadows: "hard" } }, () => {
    v.rect(0, 0, 200, 120, { fill: "#a0a0a0", material: { castsShadow: 0 } });
    if (caster) v.rect(70, 30, 10, 60, { fill: "#606060", material: { castsShadow: 30 } });
    v.light({ kind: "point", at: [30, 60], height: 60, energy: 2, reach: 900 });
  });
  const open = await renderOnce(handle, { size, draw: draw(false) });
  const lit = await renderOnce(handle, { size, draw: draw(true) });
  assert.ok(rel({ px: lit, open }, [100, 60]) < 0.3, `the floor behind the caster is in shadow (${rel({ px: lit, open }, [100, 60]).toFixed(3)} of open)`);
}

/** A taller caster touching a shorter one shadows its top without a gap between them; the shorter one never shadows itself. */
export async function touchingCasters(handle: GpuHandle): Promise<void> {
  const draw = (front: number) => (v: View): void => v.group({ lighting: { ambient: "#202020", shadows: "hard" } }, () => {
    v.rect(0, 0, 200, 120, { fill: "#a0a0a0" });
    v.rect(100, 20, 60, 80, { fill: "#a0a0a0", material: { castsShadow: 30 } });
    v.rect(90, 40, 10, 40, { fill: "#606060", material: { castsShadow: front } });
    v.light({ kind: "point", at: [30, 60], height: 120, energy: 2, reach: 900 });
  });
  const short = await renderOnce(handle, { size, draw: draw(20) });
  const tall = await renderOnce(handle, { size, draw: draw(80) });
  const p = [110, 60] as const;
  assert.ok(linear(tall, p) < 0.5 * linear(short, p), "an 80-high caster against a 30-high one shadows its top");
  assert.ok(linear(short, [150, 30]) > 0.9 * linear(tall, [150, 30]), "away from the tall caster's shadow the receiver is lit: it does not shadow itself");
}

/** A thin, very tall caster under a low directional light shadows the floor far beyond it: the march does not skip it. */
export async function thinTallCaster(handle: GpuHandle): Promise<void> {
  const wide = { width: 400, height: 120 };
  const draw = (caster: boolean) => (v: View): void => v.group({ lighting: { ambient: "#202020", shadows: "hard" } }, () => {
    v.rect(0, 0, 400, 120, { fill: "#a0a0a0" });
    if (caster) v.rect(100, 20, 6, 80, { fill: "#606060", material: { castsShadow: 1024 } });
    v.light({ kind: "directional", direction: 0, height: 30, energy: 2 });
  });
  const open = await renderOnce(handle, { size: wide, draw: draw(false) });
  const lit = await renderOnce(handle, { size: wide, draw: draw(true) });
  for (const y of [40, 60, 80]) assert.ok(rel({ px: lit, open }, [246, y]) < 0.3, `the floor 140 px past the caster is in shadow at y ${y} (${rel({ px: lit, open }, [246, y]).toFixed(3)} of open)`);
}

/** Hard shadows read casters as drawn: across a shadow's side, almost no pixel is part-lit; soft shadows blur it. */
export async function hardEdges(handle: GpuHandle, t: TestContext): Promise<void> {
  const draw = (shadows: "hard" | "soft" | "none") => (v: View): void => v.group({ lighting: { ambient: "#202020", shadows } }, () => {
    v.rect(0, 0, 200, 120, { fill: "#a0a0a0" });
    v.rect(70, 30, 10, 60, { fill: "#606060", material: { castsShadow: 30 } });
    v.light({ kind: "point", at: [30, 60], height: 60, energy: 2, reach: 900 });
  });
  const open = await renderOnce(handle, { size, draw: draw("none") });
  const between = async (shadows: "hard" | "soft"): Promise<number> => {
    const px = await renderOnce(handle, { size, draw: draw(shadows) });
    let n = 0;
    for (let y = 0; y < 120; y++) {
      const r = rel({ px, open }, [95, y]);
      if (r > 0.1 && r < 0.9) n++;
    }
    return n;
  };
  const hard = await between("hard");
  const soft = await between("soft");
  t.diagnostic(`part-lit pixels down x 95: hard ${hard}, soft ${soft}`);
  // Hard sides step by sample spacing (2 px), so a few pixels each side are part-lit.
  assert.ok(hard <= 8, "a hard shadow's sides are sharp");
  assert.ok(soft > 4 * hard, "a soft shadow's sides are not");
}

/** A caster made taller than 1024 by a transform keeps its full height: 800 under scale 2 stands 1600. */
export async function scaledTallCaster(handle: GpuHandle, t: TestContext): Promise<void> {
  const wide = { width: 320, height: 120 };
  const draw = (caster: boolean) => (v: View): void => v.group({ lighting: { ambient: "#202020", shadows: "hard" } }, () => {
    v.rect(0, 0, 320, 120, { fill: "#a0a0a0" });
    if (caster) v.at({ scale: 2 }, () => v.rect(37, 20, 3, 20, { fill: "#606060", material: { castsShadow: 800 } }));
    v.light({ kind: "point", at: [30, 60], height: 2000, energy: 20, reach: 4000 });
  });
  const open = await renderOnce(handle, { size: wide, draw: draw(false) });
  const end = shadowEnd({ lit: await renderOnce(handle, { size: wide, draw: draw(true) }), open }, 81);
  t.diagnostic(`shadow ends at x ${end} (1600 tall: 280; clamped to 1024: 132)`);
  assert.ok(Math.abs(end - 280) <= 10, `the shadow ends near x 280 (got ${end})`);
}

/** Shadow grain is keyed to canvas pixels: a far-off shape that moves the lit layer's bounds leaves shadows unchanged. */
export async function stableShadowGrain(handle: GpuHandle): Promise<void> {
  const draw = (extra: boolean) => (v: View): void => v.group({ lighting: { ambient: "#202020", shadows: "soft" } }, () => {
    v.rect(60, 0, 140, 120, { fill: "#a0a0a0" });
    if (extra) v.rect(0, 0, 4, 4, { fill: "#a0a0a0" });
    v.rect(90, 30, 10, 60, { fill: "#606060", material: { castsShadow: 30 } });
    v.light({ kind: "point", at: [70, 60], height: 60, energy: 2, reach: 900 });
  });
  for (const ratio of [1, 2]) {
    const a = await renderOnce(handle, { size, draw: draw(false), ratio });
    const b = await renderOnce(handle, { size, draw: draw(true), ratio });
    let differ = 0;
    for (let y = 0; y < 120 * ratio; y++) {
      for (let x = 60 * ratio; x < 200 * ratio; x++) {
        const i = (y * a.width + x) * 4;
        for (let k = 0; k < 4; k++) if (a.data[i + k] !== b.data[i + k]) differ++;
      }
    }
    assert.equal(differ, 0, `ratio ${ratio}: the shadow is unchanged by a shape far away`);
  }
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

/**
 * Drawing-round finding 3: `--scene` reports each light's peak, where it is, and what a white floor there shows.
 * The report must agree with the renderer: at the place it names, and beyond every light's reach. A narrow spot
 * peaks beside the light on its beam, and adds nothing behind it.
 */
export async function lightPeaks(handle: GpuHandle, t: TestContext): Promise<void> {
  const lighting: Lighting = { ambient: "#2e3448", exposure: 0.3, toneCurve: 0.6 };
  const cases = [
    { light: { kind: "point", at: [50, 60], height: 40, color: "#ffd8a0", energy: 0.6, reach: 60 }, peak: [50, 60], place: /below \(50,60\)/ },
    { light: { kind: "spot", at: [50, 60], height: 40, color: "#ffd8a0", energy: 0.6, reach: 60, direction: 0, cone: 0.25 }, peak: [52, 60], behind: [47, 60], place: /beside \(50,60\) on its beam, toward 0 rad/ },
  ] satisfies { light: Light; peak: [number, number]; behind?: [number, number]; place: RegExp }[];
  for (const c of cases) {
    const scene = new SceneRecorder({ width: 200, height: 120 }).record((v) => v.group({ lighting }, () => {
      v.rect(0, 0, 200, 120, { fill: "#ffffff" });
      v.light(c.light);
    })).scene;
    const line = sceneOutline(scene, handle.colors).split("\n").find((l) => l.includes(`light ${c.light.kind}`)) ?? "";
    t.diagnostic(line.trim());
    assert.match(line, c.place);
    const m = /peak \+([\d.]+) .*, over ambient ([\d.]+) \(a white floor there: ([\d.]+) → ([\d.]+)\)$/.exec(line);
    assert.ok(m !== null, `the light's line reports its peak: ${line}`);
    const renderer = new GpuRenderer(handle);
    try {
      const px = await renderer.render(scene, 1);
      const grey = (at: readonly [number, number]): number => {
        const [r = 0, g = 0, b = 0] = rgbaAt(px, at);
        return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      };
      const peak = grey(c.peak);
      const away = grey([180, 60]);
      t.diagnostic(`${c.light.kind}: rendered ${away.toFixed(3)} beyond its reach, ${peak.toFixed(3)} at its peak`);
      assert.ok(Math.abs(away - Number(m[3])) < 0.02, `ambient alone: reported ${m[3]}, rendered ${away.toFixed(3)}`);
      assert.ok(Math.abs(peak - Number(m[4])) < 0.02, `at the peak: reported ${m[4]}, rendered ${peak.toFixed(3)}`);
      if ("behind" in c) assert.ok(Math.abs(grey(c.behind) - away) < 0.01, "behind the spot: ambient only");
    } finally {
      renderer.destroy();
    }
  }
}

/** Mean |luminance − mean of its 3×3 neighbourhood| over the pixels `where` picks: pixel-scale noise. */
function pixelNoise(px: Pixels, where: (x: number, y: number) => boolean): { noise: number; count: number } {
  const lum = (x: number, y: number): number => {
    const [r = 0, g = 0, b = 0] = rgbaAt(px, [x, y]);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  let sum = 0;
  let count = 0;
  for (let y = 1; y < px.height - 1; y++) {
    for (let x = 1; x < px.width - 1; x++) {
      if (!where(x, y)) continue;
      let m = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) m += lum(x + dx, y + dy);
      sum += Math.abs(lum(x, y) - m / 9);
      count++;
    }
  }
  return { noise: sum / count, count };
}

/** Checkpoint 4 visual read, B1: a soft shadow's penumbra is smooth, not speckled by the march's sampling. */
export async function smoothPenumbra(handle: GpuHandle, t: TestContext): Promise<void> {
  const draw = (v: View): void => v.group({ lighting: { ambient: "#303030", shadows: "soft" } }, () => {
    v.rect(0, 0, 200, 120, { fill: "#c0b090" });
    v.rect(70, 30, 30, 50, { fill: "#604030", material: { castsShadow: 40 } });
    v.light({ kind: "point", at: [40, 55], height: 70, energy: 2.5, reach: 600 });
  });
  for (const ratio of [1, 2]) {
    const px = await renderOnce(handle, { size, draw, ratio });
    // The floor right of the caster, away from its outline: the shadow and its soft sides.
    const { noise, count } = pixelNoise(px, (x, y) => x > 104 * ratio && x < 190 * ratio && y > 4 * ratio && y < 116 * ratio);
    t.diagnostic(`ratio ${ratio}: pixel noise ${noise.toFixed(3)} over ${count} floor pixels`);
    assert.ok(noise < 1.2, `ratio ${ratio}: the shadow and its penumbra are smooth (noise ${noise.toFixed(3)})`);
  }
}

/**
 * Checkpoint 4 visual read, B2: a caster's outline pixel on its shadowed side is partly the floor below, which the
 * caster shadows, so it is never brighter than both the caster and the shadowed floor beside it.
 */
export async function casterOutlineFringe(handle: GpuHandle, t: TestContext): Promise<void> {
  const draw = (v: View): void => v.group({ lighting: { ambient: "#303030", shadows: "soft" } }, () => {
    v.rect(0, 0, 200, 120, { fill: "#d8c8a8" });
    // A slanted right side, so its outline pixels take every coverage.
    v.polygon([[60, 20], [100, 20], [112, 100], [60, 100]], { fill: "#3a4658", material: { bevel: 7, castsShadow: 70 } });
    v.light({ kind: "point", at: [20, 60], height: 150, energy: 3, reach: 600 });
  });
  for (const ratio of [1, 2]) {
    const px = await renderOnce(handle, { size, draw, ratio });
    const lum = (x: number, y: number): number => {
      const [r = 0, g = 0, b = 0] = rgbaAt(px, [x, y]);
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    let bright = 0;
    let worst = 0;
    for (let y = 25 * ratio; y < 95 * ratio; y++) {
      // The outline's x on this row, then its two pixels against the caster 3 px in and the floor 3 px out.
      const edge = (100 + (12 * (y / ratio - 20)) / 80) * ratio;
      for (const x of [Math.floor(edge), Math.floor(edge) + 1]) {
        const over = lum(x, y) - Math.max(lum(x - 3 * ratio, y), lum(x + 3 * ratio, y));
        worst = Math.max(worst, over);
        if (over > 4) bright++;
      }
    }
    t.diagnostic(`ratio ${ratio}: ${bright} outline pixels brighter than both sides, worst by ${worst.toFixed(1)}`);
    assert.equal(bright, 0, `ratio ${ratio}: no bright fringe along the shadowed side`);
  }
}
