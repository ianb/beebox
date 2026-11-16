// Each frame of Thimble Quay: the kept pictures placed in order, the folk and
// vehicles at their places, the happenings set off by clicks, the weather, the
// fall of night with its lit windows and lamps, fireworks, and the hover cue.
//
// Poses of one character live side by side in one sheet picture; a clip shows
// the current cell. A sheet is placed every frame, so its pixels are kept.
import type { DeepReadonly, Drawing, PathCommand, Picture, RootDrawing, TextOptions, View } from "@ianbicking/canvas-loop";
import { type Carry, FOLK_W, FOOT_X, type Kind, paintBaker, paintBoat, paintCart, paintCat, paintCyclist, paintDuck, paintFolk, paintPigeon, paintTram } from "./folk-tea.js";
import { INK, blob, clamp01, ellipsePts, hash, ink, mix, rectPts, rgba, type RGB } from "./ink-tea.js";
import { BACK_FEET, BASE, BOAT_Y, BUILDINGS, CANAL_TOP, CART_FEET, CLOCK, CYCLIST_FEET, H, HOT_AIR, LANE_SCALE, LAMPS, LAMP_H, LEDGE_Y, MILL, MOUSE, RAIL_Y, ROAD_BOT, ROAD_TOP, TOWER, TRAM_H, W, WALKERS, WINDOWS, boatX, cartX, cyclistX, duckHome, hotAirAt, shopWindow, tramX, walkerAt } from "./layout-tea.js";
import { CLIMB, LASTS, type Model, type Who, balloonHeld, duskOf, hitTest, lampLit, nightOf, windowLit } from "./model-tea.js";
import { occluders, paintCanal, paintCloud, paintFront, paintHills, paintSky, paintTown } from "./town-tea.js";

export interface Opts {
  readonly weather: "fair" | "rain" | "snow";
  readonly folk: number;
  readonly hints: boolean;
}

const since = (start: number | null, f: number, lasts: number): number | null => (start === null || f - start < 0 || f - start >= lasts ? null : f - start);

const CELL_H = 120;
const CELL_FOOT = 116;

/** A sheet of poses, `cells` wide, each cell `w` x `h`. */
function sheet(v: View, a: { key: string; w: number; h: number; cells: number; deps: readonly (string | number | boolean)[]; dy?: number }, paint: (k: number) => Drawing): Picture {
  return v.picture({ key: a.key, width: a.w * a.cells, height: a.h, deps: [...a.deps] }, () => Array.from({ length: a.cells }, (_, k) => v.clip(rectPts(k * a.w, 0, a.w, a.h), [v.at({ translate: [k * a.w, a.dy ?? 0] }, paint(k))])));
}
/** Cell `k` of a sheet with its top-left at (x, y) in the current coordinates. */
function cell(v: View, pic: Picture, a: { k: number; w: number; h: number; x: number; y: number }): Drawing {
  return v.clip(rectPts(a.x, a.y, a.w, a.h), [v.place(pic, a.x - a.k * a.w, a.y)]);
}
/** Something standing at (x, feet), scaled and facing `dir`. */
function standing(v: View, a: { x: number; feet: number; scale: number; dir: number }, child: Drawing): Drawing {
  return v.at({ translate: [Math.round(a.x), Math.round(a.feet)], scale: [a.dir * a.scale, a.scale] }, child);
}

// --- Folk on the pavements -------------------------------------------------------

function carryOf(kind: Kind, weather: Opts["weather"]): Carry {
  return weather === "rain" && kind !== "hedgehog" && kind !== "otter" ? "umbrella" : "none";
}
function folkSheet(v: View, kind: Kind, carry: Carry): Picture {
  return sheet(v, { key: "folk", w: FOLK_W, h: CELL_H, cells: 4, deps: [kind, carry], dy: CELL_FOOT - 100 }, (k) => paintFolk(v, kind, k, carry));
}
function folkAt(v: View, pic: Picture, a: { k: number; x: number; feet: number; scale: number; dir: number }): Drawing {
  return standing(v, a, cell(v, pic, { k: a.k, w: FOLK_W, h: CELL_H, x: -FOOT_X, y: -CELL_FOOT }));
}

/** How long ago `who` was clicked, while the reaction lasts. */
function reacting(model: DeepReadonly<Model>, who: Who): number | null {
  const r = model.reactions.find((x) => x.who === who);
  return r ? since(r.at, model.frame, LASTS.reaction) : null;
}
/** A happy hop at the start of a reaction. */
const hop = (t: number | null): number => (t !== null && t < 24 ? Math.sin((Math.PI * t) / 24) * 9 : 0);

const SAY: TextOptions = { overlay: true, size: 12, font: "Georgia, serif", style: "bold italic", fill: "#3a2418", halo: "rgba(255,248,228,0.95)", align: "center", valign: "bottom" };

function note(v: View, x: number, y: number, a: number): Drawing {
  const c = `rgba(58,36,24,${a.toFixed(3)})`;
  return [v.ellipse(x, y, 3.2, 2.4, { fill: c }), v.line(x + 3, y, x + 3, y - 11, { stroke: c, weight: 1.4 }), v.line(x + 3, y - 11, x + 7, y - 8, { stroke: c, weight: 1.4 })];
}
function heart(v: View, x: number, y: number, a: number): Drawing {
  const c = `rgba(220,60,70,${a.toFixed(3)})`;
  return [v.circle(x - 2.6, y, 3, { fill: c }), v.circle(x + 2.6, y, 3, { fill: c }), v.triangle(x - 5.4, y + 1, x + 5.4, y + 1, x, y + 7, { fill: c })];
}

/** The little show over someone's head when clicked: words, notes, hearts, letters, dust. */
function reaction(v: View, who: Who, t: number, at: { x: number; head: number; feet: number; dir: number }): Drawing {
  const a = clamp01((LASTS.reaction - t) / 25), rise = t * 0.35;
  const say = (words: string): Drawing => v.text(words, { x: at.x, y: at.head - 4 - rise * 0.5 }, { ...SAY, fill: rgba([58, 36, 24], a), halo: rgba([255, 248, 228], 0.95 * a) });
  switch (who) {
    case "heron":
      return [0, 1, 2].map((i) => {
        const s = Math.max(0, t - i * 6);
        const x = at.x + at.dir * (8 + s * 0.6) + Math.sin(s * 0.2 + i) * 6, y = at.head + 20 + s * 0.45;
        return v.at({ translate: [x, y], rotate: Math.sin(s * 0.15 + i) * 0.6 }, [v.rect(-5, -3.5, 10, 7, { fill: rgba([250, 244, 228], a), stroke: rgba([90, 60, 40], a), weight: 0.8 }), v.path([["move", -5, -3.5], ["line", 0, 0.5], ["line", 5, -3.5]], { stroke: rgba([90, 60, 40], a), weight: 0.7 })]);
      });
    case "goose": return say("Honk!");
    case "mole": return say("Extra! Extra!");
    case "badger": return [0, 1, 2].map((i) => note(v, at.x + i * 9 - 6 + Math.sin(t * 0.1 + i) * 4, at.head - 6 - Math.max(0, t - i * 9) * 0.4, a * (t >= i * 9 ? 1 : 0)));
    case "hedgehog":
      return [0, 1, 2, 3, 4].map((i) => {
        const s = (t + i * 7) % 40;
        return v.circle(at.x - at.dir * (6 + s * 0.5) + i * 3, at.feet - 2 - s * 0.25, 2 + s * 0.15, { fill: rgba([200, 186, 160], 0.6 * (1 - s / 40) * a) });
      });
    case "mouse": return [0, 1].map((i) => heart(v, at.x - 6 + i * 12 + Math.sin(t * 0.12 + i * 2) * 3, at.head - 6 - Math.max(0, t - i * 12) * 0.4, a * (t >= i * 12 ? 1 : 0)));
    case "otter": return say("Tea?");
    case "cyclist": return say("ring-a-ling!");
    case "cart": {
      // An apple jumps off the cart and rolls along ahead of it.
      const x = at.x + at.dir * (30 + t * 1.1), bounce = Math.abs(Math.sin(t * 0.18)) * Math.max(0, 14 - t * 0.2);
      return v.at({ translate: [x, at.feet - 4 - bounce] }, [v.circle(0, 0, 4, { fill: rgba([214, 64, 54], a), stroke: rgba([43, 32, 32], a), weight: 0.8 }), v.line(0, -4, 1, -7, { stroke: rgba([90, 60, 30], a), weight: 1 })]);
    }
  }
}

function walkers(v: View, model: DeepReadonly<Model>, lane: 0 | 1, o: Opts): Drawing {
  return WALKERS.slice(0, o.folk).filter((w) => w.lane === lane).map((w) => {
    const p = walkerAt(w, model.frame);
    const t = reacting(model, w.kind);
    const tall = (w.kind === "heron" || w.kind === "goose" ? 96 : w.kind === "mouse" || w.kind === "hedgehog" ? 62 : 78) * p.scale;
    return [
      folkAt(v, folkSheet(v, w.kind, carryOf(w.kind, o.weather)), { ...p, feet: p.feet - (p.k % 2 === 1 ? 1 : 0) - hop(t) }),
      t !== null && reaction(v, w.kind, t, { x: p.x, head: p.feet - tall, feet: p.feet, dir: p.dir }),
    ];
  });
}

function cyclist(v: View, model: DeepReadonly<Model>, o: Opts): Drawing {
  if (o.folk < 8) return null;
  const f = model.frame, x = cyclistX(f), t = reacting(model, "cyclist");
  const pic = sheet(v, { key: "cyclist", w: 96, h: 96, cells: 4, deps: [], dy: 16 }, (k) => paintCyclist(v, k));
  return [
    standing(v, { x, feet: CYCLIST_FEET - hop(t) * 0.5, scale: 0.72, dir: 1 }, cell(v, pic, { k: Math.floor(f / 5) % 4, w: 96, h: 96, x: -46, y: -92 })),
    t !== null && reaction(v, "cyclist", t, { x: x + 10, head: CYCLIST_FEET - 62, feet: CYCLIST_FEET, dir: 1 }),
  ];
}

function cart(v: View, model: DeepReadonly<Model>, o: Opts): Drawing {
  if (o.folk < 9) return null;
  const f = model.frame, x = cartX(f), t = reacting(model, "cart");
  const pic = sheet(v, { key: "cart", w: 104, h: 76, cells: 2, deps: [], dy: 16 }, (k) => paintCart(v, k));
  return [
    standing(v, { x, feet: CART_FEET - (t !== null && t < 10 ? 3 : 0), scale: 0.74, dir: -1 }, cell(v, pic, { k: Math.floor(f / 22) % 2, w: 104, h: 76, x: -46, y: -72 })),
    t !== null && reaction(v, "cart", t, { x: x - 30, head: CART_FEET - 50, feet: CART_FEET, dir: -1 }),
  ];
}

// --- Happenings ----------------------------------------------------------------


function pigeons(v: View, model: DeepReadonly<Model>): Drawing {
  const pic = sheet(v, { key: "pigeon", w: 32, h: 26, cells: 3, deps: [] }, (k) => paintPigeon(v, k === 0 ? "sit" : k === 1 ? "up" : "down"));
  const t = since(model.bell, model.frame, LASTS.bell);
  return [0, 1, 2, 3, 4].map((i) => {
    const hx = TOWER.x - 4 + i * 14, hy = LEDGE_Y - 1;
    if (t === null) return standing(v, { x: hx, feet: hy, scale: 0.8, dir: i % 2 === 0 ? 1 : -1 }, cell(v, pic, { k: 0, w: 32, h: 26, x: -16, y: -23 }));
    const u = t / LASTS.bell, k = Math.sin(Math.PI * Math.min(1, u * 1.15));
    const x = hx + Math.sin(t * 0.035 + i * 1.3) * 120 * k + (i - 2) * 24 * k;
    const y = hy - 120 * k - Math.cos(t * 0.05 + i) * 22 * k;
    const dir = Math.cos(t * 0.035 + i * 1.3) >= 0 ? 1 : -1;
    const pose = k < 0.04 ? 0 : (Math.floor(t / 5) + i) % 2 === 0 ? 1 : 2;
    return standing(v, { x, feet: y, scale: 0.8, dir }, cell(v, pic, { k: pose, w: 32, h: 26, x: -16, y: -23 }));
  });
}

function belfry(v: View, model: DeepReadonly<Model>, night: number): Drawing {
  const t = since(model.bell, model.frame, 600);
  const swing = t === null ? 0 : Math.sin(t * 0.22) * 0.55 * Math.exp(-t / 110);
  const bx = TOWER.x + TOWER.w / 2, by = TOWER.top + 22;
  const awake = t !== null;
  return [
    v.at({ translate: [bx, by], rotate: swing }, [
      v.polygon([[-9, 22], [-7, 6], [-4, 1], [4, 1], [7, 6], [9, 22]], { fill: "#c99a3a", stroke: INK, weight: 1.2 }),
      v.circle(0, 23, 2.5, { fill: "#7a5a2a" }),
    ]),
    // The owl wakes when the bell rings at night.
    night > 0.5 && [
      v.ellipse(bx + 16, by + 20, 6, 8, { fill: "#8a6a4a", stroke: INK, weight: 1 }),
      awake ? [v.circle(bx + 13.5, by + 17, 2.2, { fill: "#f6d24a" }), v.circle(bx + 18.5, by + 17, 2.2, { fill: "#f6d24a" }), v.circle(bx + 13.5, by + 17, 0.9, { fill: INK }), v.circle(bx + 18.5, by + 17, 0.9, { fill: INK })]
        : [v.line(bx + 12, by + 17, bx + 15, by + 17, { stroke: INK, weight: 1 }), v.line(bx + 17, by + 17, bx + 20, by + 17, { stroke: INK, weight: 1 })],
    ],
  ];
}

function clockHands(v: View, clock: number): Drawing {
  const h = ((clock % 12) / 12) * Math.PI * 2 - Math.PI / 2;
  const m = (clock % 1) * Math.PI * 2 - Math.PI / 2;
  const hand = { stroke: "#2a1a10", cap: "round" } as const;
  return [
    v.line(CLOCK.x, CLOCK.y, CLOCK.x + Math.cos(h) * 11, CLOCK.y + Math.sin(h) * 11, { ...hand, weight: 2.6 }),
    v.line(CLOCK.x, CLOCK.y, CLOCK.x + Math.cos(m) * 16, CLOCK.y + Math.sin(m) * 16, { ...hand, weight: 1.6 }),
    v.circle(CLOCK.x, CLOCK.y, 1.8, { fill: "#2a1a10" }),
  ];
}

const SAIL_STEPS = 24;
function sails(v: View, angle: number): Drawing {
  const quarter = Math.PI / 2;
  const k = Math.floor((((angle % quarter) + quarter) % quarter) / quarter * SAIL_STEPS) % SAIL_STEPS;
  const size = 96;
  const pic = sheet(v, { key: "sails", w: size, h: size, cells: SAIL_STEPS, deps: [] }, (s) => {
    const a0 = (s / SAIL_STEPS) * quarter;
    return [0, 1, 2, 3].map((j) => {
      const a = a0 + j * quarter;
      const ca = Math.cos(a), sa = Math.sin(a);
      const at = (r: number, side: number): [number, number] => [size / 2 + ca * r - sa * side, size / 2 + sa * r + ca * side];
      return [
        v.line(size / 2, size / 2, at(MILL.r, 0)[0], at(MILL.r, 0)[1], { stroke: "#5a4030", weight: 2 }),
        v.polygon([at(10, 1), at(MILL.r, 1), at(MILL.r, 9), at(12, 7)], { fill: "rgba(250,244,228,0.92)", ...ink(600 + j, 1.1) }),
      ];
    }).concat([v.circle(size / 2, size / 2, 3.5, { fill: "#5a4030" })]);
  });
  return cell(v, pic, { k, w: size, h: size, x: MILL.x - size / 2, y: MILL.y - size / 2 });
}

function smoke(v: View, f: number, busy: boolean): Drawing {
  const cx = BUILDINGS[0] ? BUILDINGS[0].x + BUILDINGS[0].w * 0.7 + 8 : 120, cy = (BUILDINGS[0]?.top ?? 196) - 52;
  const n = busy ? 9 : 5;
  return Array.from({ length: n }, (_, i) => {
    const period = busy ? 120 : 200;
    const t = (f + (i * period) / n) % period;
    const u = t / period;
    const x = cx + u * 40 + Math.sin(t * 0.05 + i) * 5, y = cy - u * 90;
    const r = 5 + u * 14;
    return v.circle(x, y, r, { fill: v.radialGradient(x, y, r, [[0, `rgba(236,232,226,${(0.55 * (1 - u)).toFixed(3)})`], [1, "rgba(236,232,226,0)"]]) });
  });
}

function bakery(v: View, model: DeepReadonly<Model>): Drawing {
  const f = model.frame;
  const t = since(model.bakery, f, LASTS.bakery);
  const b = BUILDINGS[0];
  const sill = WINDOWS[3];
  if (!b || !sill) return null;
  const doorX = b.x + b.w - 26 - 12;
  const catPic = sheet(v, { key: "cat", w: 42, h: 40, cells: 2, deps: [], dy: 2 }, (k) => paintCat(v, k === 0 ? "sit" : "trot"));
  const sillPos: [number, number] = [sill.x + sill.w / 2, sill.y + sill.h + 4];
  const ground: [number, number] = [doorX - 10, BACK_FEET];
  const catAt = (pos: readonly [number, number], k: number, dir: number): Drawing => standing(v, { x: pos[0], feet: pos[1], scale: 0.62, dir }, cell(v, catPic, { k, w: 42, h: 40, x: -21, y: -36 }));
  if (t === null) return catAt(sillPos, 0, 1);
  const out = clamp01(t / 40) * clamp01((LASTS.bakery - t) / 40);
  const bx = doorX + 13 - out * 34;
  const leap = (u: number, from: readonly [number, number], to: readonly [number, number]): [number, number] => [from[0] + (to[0] - from[0]) * u, from[1] + (to[1] - from[1]) * u - Math.sin(Math.PI * u) * 30];
  const catPos = t < 50 ? sillPos : t < 90 ? leap((t - 50) / 40, sillPos, ground) : t < LASTS.bakery - 80 ? ground : t < LASTS.bakery - 40 ? leap((t - (LASTS.bakery - 80)) / 40, ground, sillPos) : sillPos;
  const moving = (t >= 50 && t < 90) || (t >= LASTS.bakery - 80 && t < LASTS.bakery - 40);
  const baker = v.picture({ key: "baker", width: 70, height: CELL_H }, () => v.at({ translate: [0, CELL_FOOT - 100] }, paintBaker(v)));
  return [
    // The open door.
    v.rect(doorX + 2, BASE - 74, 22, 74, { fill: "#2a1a14" }),
    v.rect(doorX + 2, BASE - 74, 22, 74, { fill: "rgba(255,190,110,0.35)" }),
    standing(v, { x: bx, feet: BACK_FEET + 1, scale: 0.62, dir: 1 }, v.place(baker, -FOOT_X, -CELL_FOOT)),
    // Steam off the buns.
    out > 0.5 && [0, 1, 2].map((i) => {
      const u = ((f + i * 20) % 60) / 60;
      const x = bx - 2 + i * 6 + Math.sin(f * 0.1 + i) * 2, y = BACK_FEET - 40 - u * 22;
      return v.circle(x, y, 2 + u * 3, { fill: `rgba(255,255,255,${(0.6 * (1 - u)).toFixed(3)})` });
    }),
    catAt(catPos, moving ? 1 : 0, moving && t > 200 ? 1 : -1),
  ];
}

function cafe(v: View, model: DeepReadonly<Model>, o: Opts): Drawing {
  const f = model.frame;
  const t = since(model.cafe, f, LASTS.cafe);
  const tables = v.picture({ key: "tables", width: 200, height: 50 }, () => [470, 540].map((x) => [
    blob(v, ellipsePts(x - 400, 14, 18, 4, 12), { fill: "#f6f1e6", seed: x, line: 1.2, amp: 0.3 }),
    v.line(x - 400, 16, x - 400, 40, { stroke: INK, weight: 1.8 }),
    v.line(x - 410, 40, x - 390, 40, { stroke: INK, weight: 1.8 }),
    [-26, 26].map((dx) => [
      v.line(x - 400 + dx, 22, x - 400 + dx, 40, { stroke: "#5a3a2a", weight: 1.6 }),
      v.line(x - 400 + dx * 1.2, 4, x - 400 + dx * 1.2, 40, { stroke: "#5a3a2a", weight: 1.6 }),
      v.line(x - 400 + dx, 24, x - 400 + dx * 1.2, 24, { stroke: "#5a3a2a", weight: 2.2 }),
    ]),
  ]));
  const waiter = t !== null && folkAt(v, folkSheet(v, "otter", carryOf("otter", o.weather)), { k: 0, x: 506, feet: BACK_FEET - 2, scale: 0.6, dir: t > LASTS.cafe / 2 ? -1 : 1 });
  const cups = t !== null && t > 30 && [470, 540].map((x) => [
    v.rect(x - 4, BACK_FEET - 39, 7, 5, { fill: "#fbf8f0", stroke: INK, weight: 0.8 }),
    [0, 1].map((i) => {
      const u = ((f + i * 30) % 60) / 60;
      return v.circle(x + Math.sin(f * 0.08 + i * 2) * 2, BACK_FEET - 42 - u * 18, 1.5 + u * 2.5, { fill: `rgba(255,255,255,${(0.55 * (1 - u)).toFixed(3)})` });
    }),
  ]);
  return [v.place(tables, 400, BACK_FEET - 40), cups, waiter];
}

function balloon(v: View, model: DeepReadonly<Model>): Drawing {
  const f = model.frame;
  const scale = LANE_SCALE[0];
  const mousePic = folkSheet(v, "mouse", "balloon");
  const hand: [number, number] = [MOUSE.x + 5.5 * scale, BACK_FEET - 37 * scale];
  const pic = v.picture({ key: "balloon", width: 30, height: 36 }, () => [
    blob(v, ellipsePts(15, 15, 11, 13, 16), { fill: "#e0443a", light: "#f07a6a", seed: 700, line: 1.4, amp: 0.4, curve: true }),
    v.ellipse(11, 9, 3, 4.5, { fill: "rgba(255,255,255,0.6)" }),
    v.triangle(12, 30, 15, 27, 18, 30, { fill: "#c0342a" }),
  ]);
  const t = model.balloon === null ? null : f - model.balloon;
  const held = balloonHeld(model) || t === null;
  const bxy: [number, number] = held ? [hand[0] + 6 + Math.sin(f * 0.04) * 2, hand[1] - 46] : [hand[0] + 6 + Math.sin(t * 0.04) * 16 + t * 0.18, hand[1] - 46 - t * 1.1];
  const popped = t !== null && t >= LASTS.balloonPop;
  const popAt: [number, number] = [hand[0] + 6 + Math.sin(LASTS.balloonPop * 0.04) * 16 + LASTS.balloonPop * 0.18, hand[1] - 46 - LASTS.balloonPop * 1.1];
  const s = t === null ? 0 : t - LASTS.balloonPop;
  return [
    folkAt(v, mousePic, { k: 0, x: MOUSE.x, feet: BACK_FEET, scale, dir: 1 }),
    !popped && [
      v.curve(held ? [hand, [hand[0] + 4, hand[1] - 18], [bxy[0], bxy[1] + 14]] : [[bxy[0] - 4, bxy[1] + 50], [bxy[0] + Math.sin(f * 0.1) * 4, bxy[1] + 32], [bxy[0], bxy[1] + 14]], false, { stroke: "#4a3a3a", weight: 0.8 }),
      v.place(pic, Math.round(bxy[0] - 15), Math.round(bxy[1] - 15)),
    ],
    popped && s < 60 && Array.from({ length: 14 }, (_, i) => {
      const a = (i / 14) * Math.PI * 2;
      const d = s * 1.4;
      return v.rect(popAt[0] + Math.cos(a) * d, popAt[1] + Math.sin(a) * d + s * s * 0.01, 3, 2, { fill: ["#e0443a", "#f2c14e", "#4f8acb", "#6aa04a"][i % 4] ?? "#fff" });
    }),
  ];
}

const PETAL_COLOURS: readonly RGB[] = [[226, 80, 74], [242, 193, 78], [240, 143, 176], [255, 255, 255], [155, 111, 208]];

function petals(v: View, model: DeepReadonly<Model>): Drawing {
  const t = since(model.petals, model.frame, LASTS.petals);
  if (t === null) return null;
  return Array.from({ length: 34 }, (_, k) => {
    const s = t - k * 3;
    if (s < 0) return null;
    const sp = 1.6 + hash(k, 1, 91) * 1.6;
    const x = 880 - s * sp, y = 392 - s * 0.32 * hash(k, 2, 91) + Math.sin(s * 0.09 + k) * 14 + hash(k, 3, 91) * 30;
    if (x < -10) return null;
    const a = clamp01((LASTS.petals - t) / 60);
    return v.ellipse(x, y, 3, 1.6 + Math.abs(Math.sin(s * 0.2 + k)) * 1.4, { fill: rgba(PETAL_COLOURS[k % 5] ?? [255, 255, 255], 0.95 * a) });
  });
}

// --- The canal -----------------------------------------------------------------

function canal(v: View, model: DeepReadonly<Model>, night: number): Drawing {
  const f = model.frame;
  const bx = boatX(f);
  const rowing = since(model.rowing, f, LASTS.rowing);
  const boatPic = sheet(v, { key: "boat", w: 122, h: 64, cells: 2, deps: [], dy: 10 }, (k) => paintBoat(v, k));
  const pose = Math.floor(f / (rowing === null ? 34 : 9)) % 2;
  const dir = Math.cos(f / 520) >= 0 ? 1 : -1;
  const duckPic = sheet(v, { key: "duck", w: 36, h: 28, cells: 4, deps: [], dy: 2 }, (k) => paintDuck(v, k % 2 === 0 ? "swim" : "flap", k >= 2));
  const scared = since(model.ducks, f, LASTS.ducks);
  const ducks = [0, 1, 2, 3].map((i) => {
    const [hx, hy] = duckHome(i, f);
    const u = scared === null ? 0 : scared / LASTS.ducks;
    const k = scared === null ? 0 : Math.sin(Math.PI * u);
    const side = i % 2 === 0 ? -1 : 1;
    const x = hx + side * 150 * k, y = hy - 26 * k * (u < 0.5 ? 1 : 0.4);
    const flap = k > 0.1 && Math.floor(f / 4 + i) % 2 === 0;
    return standing(v, { x, feet: y, scale: 0.85, dir: scared !== null && u < 0.5 ? side : Math.cos(f / 140 + i * 2) >= 0 ? 1 : -1 }, cell(v, duckPic, { k: (flap ? 1 : 0) + (i === 1 ? 2 : 0), w: 36, h: 28, x: -17, y: -21 }));
  });
  const fishT = since(model.fish, f, LASTS.fish);
  const fish = fishT !== null && ((): Drawing => {
    const u = fishT / LASTS.fish;
    const x = 600 + u * 90, y = 566 - Math.sin(Math.PI * u) * 44;
    const ang = Math.atan2(-Math.cos(Math.PI * u) * 44 * Math.PI, 90);
    return v.at({ translate: [x, y], rotate: ang }, [
      v.ellipse(0, 0, 11, 4.5, { fill: "#9fb4c4", stroke: INK, weight: 1 }),
      v.triangle(-10, 0, -17, -5, -17, 5, { fill: "#9fb4c4", stroke: INK, weight: 1 }),
      v.circle(6, -1, 1, { fill: INK }),
    ]);
  })();
  const splash = (x: number, t: number): Drawing => t >= 0 && t < 30 && v.ellipse(x, 566, 6 + t * 0.8, 2 + t * 0.2, { stroke: `rgba(230,245,245,${(0.8 * (1 - t / 30)).toFixed(3)})`, weight: 1.4 });
  const glints: PathCommand[] = Array.from({ length: 22 }, (_, i): PathCommand[] => {
    const x = (hash(i, 1, 81) * W + f * (0.2 + hash(i, 2, 81) * 0.3)) % W;
    const y = CANAL_TOP + 10 + hash(i, 3, 81) * (H - CANAL_TOP - 14);
    const len = 6 + 10 * Math.abs(Math.sin(f * 0.02 + i));
    return [["move", x, y], ["line", x + len, y]];
  }).flat();
  return [
    v.path(glints, { stroke: night > 0.5 ? "rgba(160,190,220,0.35)" : "rgba(230,248,248,0.55)", weight: 1.4, cap: "round" }),
    ducks,
    // A wake behind the boat.
    [1, 2, 3].map((k) => v.line(bx - dir * (54 + k * 14), BOAT_Y + 2 + k, bx - dir * (66 + k * 18), BOAT_Y + 2 + k, { stroke: "rgba(230,248,248,0.5)", weight: 1.2 })),
    standing(v, { x: bx, feet: BOAT_Y + Math.round(Math.sin(f / 30) * 1.5), scale: 0.9, dir }, cell(v, boatPic, { k: pose, w: 122, h: 64, x: -61, y: -54 })),
    fish,
    fishT !== null && [splash(600, fishT), splash(690, fishT - LASTS.fish + 6)],
  ];
}

/** The shop fronts upside down in the water, blurred and broken by ripples. */
function reflection(v: View, town: Picture): Drawing {
  const mirror = CANAL_TOP + 420 - 6;
  return v.clip(rectPts(0, CANAL_TOP + 3, W, H - CANAL_TOP), [
    v.group({ opacity: 0.32, effects: { blur: 2.5 } }, Array.from({ length: 9 }, (_, i) => {
      const y0 = CANAL_TOP + 3 + i * 8;
      return v.clip(rectPts(0, y0, W, 8), [v.at({ translate: [Math.sin(i * 1.7) * 3, mirror], scale: [1, -1] }, v.place(town, 0, 0))]);
    })),
  ]);
}

// --- Weather --------------------------------------------------------------------

/** The weather on screen: which kind is falling (or leaving), how far the clouds
 * have come in (0..1), and how hard it falls (0..1). */
interface Weather {
  readonly kind: "rain" | "snow" | null;
  readonly t: number;
  readonly arriving: boolean;
  readonly amount: number;
}
function weatherOf(model: DeepReadonly<Model>): Weather {
  const { kind, prev, at } = model.sky;
  const t = model.frame - at;
  if (kind !== "fair") return { kind, t, arriving: true, amount: clamp01((t - 30) / 50) };
  if (prev !== "fair") return { kind: prev, t, arriving: false, amount: 1 - clamp01(t / 25) };
  return { kind: null, t, arriving: false, amount: 0 };
}

function precipitation(v: View, f: number, w: Weather, night: number): Drawing {
  if (w.kind === null || w.amount <= 0) return null;
  if (w.kind === "rain") {
    const streaks = (n: number, a: { salt: number; speed: number; len: number }): PathCommand[] => Array.from({ length: Math.round(n * w.amount) }, (_, i): PathCommand[] => {
      const x = (hash(i, 1, a.salt) * (W + 120) + f * a.speed * 0.3) % (W + 120) - 60;
      const y = (hash(i, 2, a.salt) * (H + 40) + f * a.speed * (1 + hash(i, 3, a.salt) * 0.3)) % (H + 40) - 20;
      return [["move", x, y], ["line", x - a.len * 0.3, y + a.len]];
    }).flat();
    const near = rgba(mix([60, 78, 112], [214, 226, 244], night), 0.8);
    const far = rgba(mix([86, 102, 132], [170, 186, 210], night), 0.55);
    const splashes: PathCommand[] = Array.from({ length: Math.round(36 * w.amount) }, (_, i): PathCommand[] => {
      const s = Math.floor((f + i * 3) / 7);
      const x = hash(i, s, 74) * W, y = i % 2 === 0 ? BASE + 4 + hash(i, s, 75) * 18 : ROAD_BOT + 4 + hash(i, s, 75) * 20;
      return [["move", x - 3, y - 2], ["line", x - 1, y], ["move", x + 3, y - 2], ["line", x + 1, y]];
    }).flat();
    const rings = Array.from({ length: Math.round(16 * w.amount) }, (_, i) => {
      const t = (f + i * 7) % 40;
      return v.ellipse(hash(i, Math.floor((f + i * 7) / 40), 72) * W, CANAL_TOP + 10 + hash(i, 5, 72) * 60, 2 + t * 0.35, 0.8 + t * 0.09, { stroke: `rgba(220,235,240,${(0.7 * (1 - t / 40)).toFixed(3)})`, weight: 1 });
    });
    return [
      v.path(streaks(240, { salt: 76, speed: 13, len: 14 }), { stroke: far, weight: 1.2, cap: "round" }),
      v.path(streaks(240, { salt: 71, speed: 19, len: 26 }), { stroke: near, weight: 2, cap: "round" }),
      v.path(splashes, { stroke: rgba(mix([120, 140, 170], [210, 225, 240], night), 0.8), weight: 1.1, cap: "round" }),
      rings,
    ];
  }
  const flakes: PathCommand[] = Array.from({ length: Math.round(170 * w.amount) }, (_, i): PathCommand[] => {
    const x = (hash(i, 1, 73) * W + Math.sin(f * 0.02 + i) * 14 + f * 0.3) % W;
    const y = (hash(i, 2, 73) * H + f * (0.6 + hash(i, 3, 73) * 0.8)) % H;
    return [["move", x, y], ["line", x + 0.1, y]];
  }).flat();
  return v.path(flakes, { stroke: "rgba(255,255,255,0.9)", weight: 3, cap: "round" });
}

/** Rain and snow clouds: they race in from both sides with a bounce, and race off again. */
function stormClouds(v: View, w: Weather): Drawing {
  if (w.kind === null) return null;
  const kind = w.kind;
  return [0, 1, 2, 3, 4, 5].map((j) => {
    const cw = 250 + hash(j, 1, 77) * 60;
    const to = -70 + j * 172 + hash(j, 2, 77) * 30, y = -26 + (j % 2) * 34 + hash(j, 3, 77) * 10;
    const from = j % 2 === 0 ? -cw - 40 - j * 30 : W + 40 + j * 30;
    const u = w.arriving ? clamp01((w.t - j * 6) / 44) : clamp01((w.t - j * 3) / 26);
    const x = w.arriving ? from + (to - from) * v.ease("out-back", u) : to + (from - to) * v.ease("in", u);
    if (!w.arriving && u >= 1) return null;
    const pic = v.picture({ key: "storm", width: cw, height: cw * 0.6, deps: [j, kind] }, () => v.group({ effects: { brightness: kind === "rain" ? 0.58 : 0.86, saturation: 0.3, paper: 0.4 } }, paintCloud(v, 20 + j, cw)));
    return v.place(pic, Math.round(x), Math.round(y));
  });
}

/** Lightning: two flashes and a bolt, before the thunder. */
function lightning(v: View, model: DeepReadonly<Model>): Drawing {
  const t = since(model.thunder, model.frame, 14);
  if (t === null || model.thunder === null) return null;
  const flash = t < 3 ? 0.42 : t >= 6 && t < 9 ? 0.28 : 0;
  const x0 = 180 + hash(model.thunder, 1, 79) * 600;
  const bolt: [number, number][] = Array.from({ length: 9 }, (_, i) => [x0 + (hash(model.thunder ?? 0, i, 80) - 0.5) * 40 + i * 3, i * 26]);
  return [
    flash > 0 && v.rect(0, 0, W, H, { fill: `rgba(235,240,255,${flash})`, blend: "add" }),
    (t < 3 || (t >= 6 && t < 9)) && v.group({ blend: "add", effects: { glow: { blur: 10, color: "#bcd4ff", strength: 3 } } }, [v.path(bolt.map(([x, y], i): PathCommand => [i === 0 ? "move" : "line", x, y]), { stroke: "#f4f8ff", weight: 2.4, join: "round" })]),
  ];
}

function snowcaps(v: View): Drawing {
  const white = { stroke: "#fbfbff", weight: 6, brush: { preset: "chalk", opacity: 0.95 }, gesture: { seed: 7 } } as const;
  return [
    BUILDINGS.map((b) => {
      if (b.roof === "gable" || b.roof === "steep") {
        const peak = b.roof === "gable" ? b.top - 54 : b.top - 78;
        return v.path([["move", b.x - 8, b.top], ["line", b.x + b.w / 2, peak], ["line", b.x + b.w + 8, b.top]], white);
      }
      const top = b.roof === "mansard" ? b.top - 16 : b.roof === "flat" ? b.top - 10 : b.top - 2;
      return v.line(b.x - 4, top, b.x + b.w + 4, top, white);
    }),
    v.path([["move", TOWER.x - 6, TOWER.top], ["line", TOWER.x + TOWER.w / 2, TOWER.top - TOWER.spire - 40], ["line", TOWER.x + TOWER.w + 6, TOWER.top]], white),
    WINDOWS.map((w) => v.line(w.x - 4, w.y + w.h, w.x + w.w + 4, w.y + w.h, { ...white, weight: 3 })),
    v.rect(0, BASE, W, ROAD_TOP - BASE, { fill: "rgba(250,250,255,0.6)" }),
    v.rect(0, ROAD_BOT, W, CANAL_TOP - ROAD_BOT - 6, { fill: "rgba(250,250,255,0.6)" }),
  ];
}

// --- Sky -------------------------------------------------------------------------

function skyline(x: number): number {
  let top = 250;
  for (const b of BUILDINGS) if (x >= b.x - 10 && x <= b.x + b.w + 10) top = Math.min(top, b.top - (b.roof === "steep" ? 80 : b.roof === "gable" ? 56 : 18));
  if (x >= TOWER.x - 8 && x <= TOWER.x + TOWER.w + 8) top = 0;
  return top;
}

function stars(v: View): Drawing {
  return [
    Array.from({ length: 120 }, (_, i): Drawing => {
      const x = hash(i, 1, 61) * W, y = hash(i, 2, 61) * 250;
      if (y > skyline(x) - 8) return null;
      const r = 0.6 + hash(i, 3, 61) * 1.3;
      return v.circle(x, y, r, { fill: "#fff8e0" });
    }),
    v.group({ effects: { glow: { blur: 22, color: "#fff0c0", strength: 2 } } }, [
      v.circle(770, 62, 17, { fill: "#fbf3d8" }),
      v.circle(762, 56, 4, { fill: "#e8dcb8" }),
      v.circle(776, 70, 3, { fill: "#e8dcb8" }),
    ]),
  ];
}

const DUSK_SKY = (v: View): Drawing => v.rect(0, 0, W, 360, { fill: v.linearGradient(0, 0, 0, 330, [[0, "#5a6fa8"], [0.45, "#d98a8a"], [0.8, "#f6b46a"], [1, "#ffd890"]]) });

function sun(v: View, clock: number): Drawing {
  if (clock < 5.5 || clock > 20) return null;
  const u = (clock - 5.5) / 14.5;
  const x = 60 + u * 860, y = 300 - Math.sin(Math.PI * u) * 250;
  const pic = v.picture({ key: "sun", width: 60, height: 60 }, () => v.circle(30, 30, 16, { fill: "#fff3c4", effects: { glow: { blur: 26, color: "#ffd27a", strength: 3 } } }));
  return v.place(pic, Math.round(x - 30), Math.round(y - 30));
}

const CLOUDS = [
  { x: 40, y: 40, w: 150, speed: 0.34, seed: 1 },
  { x: 420, y: 22, w: 190, speed: 0.24, seed: 2 },
  { x: 700, y: 92, w: 120, speed: 0.46, seed: 3 },
  { x: 260, y: 112, w: 100, speed: 0.58, seed: 4 },
] as const;

function clouds(v: View, f: number): Drawing {
  return CLOUDS.map((c) => {
    const pic = v.picture({ key: "cloud", width: c.w, height: c.w * 0.6, deps: [c.seed] }, () => v.group({ effects: { paper: 0.4 } }, paintCloud(v, c.seed, c.w)));
    const x = ((c.x + f * c.speed) % (W + c.w * 2)) - c.w;
    return v.place(pic, Math.round(x), c.y);
  });
}

const ENVELOPE: readonly [number, number][] = [[30, 3], [45, 7], [55, 20], [56, 34], [50, 48], [40, 60], [36, 66], [24, 66], [20, 60], [10, 48], [4, 34], [5, 20], [15, 7]];
/** Half the envelope's width at height y, for the gores. */
function envelopeHalf(y: number): number {
  const keys: readonly [number, number][] = [[3, 2], [8, 17], [20, 25], [34, 26], [48, 20], [60, 10], [66, 6]];
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1] ?? [0, 0], b = keys[i] ?? [0, 0];
    if (y <= b[0]) return a[1] + ((b[1] - a[1]) * (y - a[0])) / (b[0] - a[0]);
  }
  return 6;
}

function paintHotAir(v: View): Drawing {
  const ys = [3, 8, 14, 20, 27, 34, 41, 48, 54, 60, 66];
  const gore = (s: number): [number, number][] => ys.map((y): [number, number] => [30 + s * envelopeHalf(y), y]);
  return [
    // Ropes from the skirt to the basket.
    [[24, 66, 25, 80], [36, 66, 35, 80], [28, 66, 28.5, 80], [32, 66, 31.5, 80]].map(([x1 = 0, y1 = 0, x2 = 0, y2 = 0]) => v.line(x1, y1, x2, y2, { stroke: "#4a3a2a", weight: 0.8 })),
    v.curve([...ENVELOPE], true, { fill: "#f2c94c" }),
    v.clip(v.curvePath([...ENVELOPE], true), [
      [-0.78, -0.26, 0.26, 0.78].map((s, i) => v.curve(gore(s), false, { stroke: i % 2 === 0 ? "#d0443a" : "#3f6fb0", weight: 7, brush: { preset: "bristle", load: 0.9, lightJitter: 0.05 }, gesture: { seed: 730 + i, pressure: "even" } })),
      [-0.52, 0, 0.52].map((s, i) => v.curve(gore(s), false, { stroke: "rgba(90,50,30,0.45)", weight: 0.8, brush: "ink", gesture: { seed: 740 + i, pressure: "even", faint: true } })),
      // Light from the upper left, shade on the right.
      v.ellipse(20, 20, 12, 16, { fill: "rgba(255,255,240,0.35)" }),
      v.line(52, 10, 46, 60, { stroke: "rgba(60,30,40,0.3)", weight: 14, brush: { preset: "wash", opacity: 0.6 }, gesture: { seed: 745, faint: true } }),
    ]),
    v.curve([...ENVELOPE], true, ink(746, 1.5)),
    blob(v, rectPts(23, 64, 14, 4), { fill: "#8a3a2a", seed: 747, line: 1, amp: 0.2 }),
    // A wicker basket.
    blob(v, [[23, 80], [37, 80], [36, 92], [24, 92]], { fill: "#b07a42", dark: "#7a4e28", seed: 748, line: 1.3, amp: 0.3 }),
    v.path([["move", 24, 84], ["line", 36, 84], ["move", 24, 88], ["line", 36, 88], ["move", 27, 80], ["line", 27.5, 92], ["move", 31, 80], ["line", 31, 92], ["move", 34, 80], ["line", 33.5, 92]], { stroke: "#6a4220", weight: 0.7 }),
    blob(v, rectPts(22, 79, 16, 3), { fill: "#8a5a32", seed: 749, line: 1, amp: 0.2 }),
    v.circle(28, 77, 2.4, { fill: "#d8c2a6", stroke: INK, weight: 0.7 }),
  ];
}

function hotAir(v: View, model: DeepReadonly<Model>): Drawing {
  const [x, y] = hotAirAt(model.frame, model.hotAir);
  const pic = v.picture({ key: "hot-air", width: HOT_AIR.w, height: HOT_AIR.h }, () => paintHotAir(v));
  return v.place(pic, Math.round(x), Math.round(y));
}

/** The burner's flame: a roar when clicked, and at night a flare now and then. */
function burner(v: View, model: DeepReadonly<Model>, night: number): Drawing {
  const f = model.frame;
  const [hx, hy] = hotAirAt(f, model.hotAir);
  const fired = since(model.hotAir, f, 70);
  const idle = night > 0.3 ? night * (0.5 + 0.5 * Math.max(0, Math.sin(f * 0.05)) ** 4) : 0;
  const roar = fired === null ? 0 : (1 - fired / 70) * (0.8 + 0.2 * Math.sin(fired * 1.3));
  const k = Math.max(idle * 0.6, roar);
  if (k <= 0.02) return null;
  const x = hx + 30, y = hy + 72;
  return v.group({ blend: "screen", effects: { glow: { blur: 10 + roar * 10, color: "#ff9a30", strength: 2 + roar * 2 } } }, [
    v.ellipse(x, y - 4 * k, 2.5 + 2 * k, 4 + 9 * k, { fill: `rgba(255,170,60,${clamp01(k).toFixed(3)})` }),
    v.ellipse(x, y - 2 * k, 1.4 + k, 2 + 5 * k, { fill: `rgba(255,240,180,${clamp01(k).toFixed(3)})` }),
  ]);
}

// --- Night -----------------------------------------------------------------------

const CUT = { fill: "#000", erase: true } as const;

function litWindows(v: View, model: DeepReadonly<Model>): Drawing {
  const lit = WINDOWS.filter((w) => windowLit(model, w.i));
  const mask = WINDOWS.map((w) => (windowLit(model, w.i) ? "1" : "0")).join("");
  const shops = nightOf(model.clock) > 0.35;
  // The glass and its bars, drawn over the dark facade.
  const panes = v.picture({ key: "lit-panes", width: W, height: H, deps: [mask] }, () => lit.map((w) => {
    const someone = hash(w.i, 9, 3) < 0.4;
    return [
      v.rect(w.x, w.y, w.w, w.h, { fill: v.linearGradient(w.x, w.y, w.x, w.y + w.h, [[0, "#ffe9a8"], [1, "#f6b45a"]]) }),
      someone && v.clip(rectPts(w.x, w.y, w.w, w.h), [v.circle(w.x + w.w * 0.4, w.y + w.h * 0.55, w.w * 0.18, { fill: "rgba(90,50,40,0.75)" }), v.ellipse(w.x + w.w * 0.4, w.y + w.h, w.w * 0.32, w.h * 0.25, { fill: "rgba(90,50,40,0.75)" })]),
      v.line(w.x + w.w / 2, w.y, w.x + w.w / 2, w.y + w.h, { stroke: "#5a3a26", weight: 2 }),
      v.line(w.x, w.y + w.h * 0.45, w.x + w.w, w.y + w.h * 0.45, { stroke: "#5a3a26", weight: 2 }),
      v.rect(w.x - 3, w.y - 3, w.w + 6, w.h + 6, { stroke: "rgba(60,40,30,0.8)", weight: 3 }),
    ];
  }));
  // The light itself, screened onto the scene: haloes round the windows, the shop
  // windows aglow, and pools on the pavement. What hangs in front of a shop window
  // (awnings, bunting, lamp posts) is cut out, so the light stays behind it.
  const light = v.picture({ key: "window-light", width: W, height: H, deps: [mask, shops] }, () => v.group({}, [
    v.group({ effects: { glow: { blur: 8, color: "#ff9a30", strength: 1.2 } } }, lit.map((w) => v.rect(w.x, w.y, w.w, w.h, { fill: "rgba(255,200,120,0.35)" }))),
    shops && BUILDINGS.map((b) => {
      const sw = shopWindow(b);
      return sw && [
        v.rect(sw.x, sw.y, sw.w, sw.h, { fill: v.linearGradient(0, sw.y, 0, sw.y + sw.h, [[0, "rgba(255,176,86,0.62)"], [1, "rgba(240,130,60,0.5)"]]), effects: { glow: { blur: 9, color: "#ff9a30", strength: 1 } } }),
        v.ellipse(sw.x + sw.w / 2, BASE + 8, sw.w * 0.75, 16, { fill: v.ellipseGradient(sw.x + sw.w / 2, BASE + 8, sw.w * 0.75, 16, [[0, "rgba(255,180,100,0.5)"], [1, "rgba(255,180,100,0)"]]) }),
      ];
    }),
    occluders(v, CUT),
  ]));
  return [v.place(panes, 0, 0), v.place(light, 0, 0, { blend: "screen" })];
}

function lampLight(v: View, model: DeepReadonly<Model>, town: Picture): Drawing {
  const on = LAMPS.map((_, i) => lampLit(model, i));
  if (!on.some(Boolean)) return null;
  const pic = v.picture({ key: "lamp-light", width: W, height: H, deps: [on.map((b) => (b ? "1" : "0")).join("")] }, () => [
    // Real light: the lamps light the street and the shop fronts, from black.
    v.group({ lighting: { ambient: "#000000", shadows: "none" } }, [
      v.place(town, 0, 0),
      v.rect(0, ROAD_BOT, W, CANAL_TOP - ROAD_BOT, { fill: "#cfc3ae" }),
      LAMPS.map((l, i) => on[i] === true && v.light({ kind: "point", at: [l.x, l.foot - LAMP_H], height: 40, energy: 0.5, color: "#ffc77a", reach: 115 })),
    ]),
    // Their reflections in the canal.
    LAMPS.map((l, i) => on[i] === true && i >= 3 && v.ellipse(l.x, CANAL_TOP + 34, 8, 30, { fill: v.ellipseGradient(l.x, CANAL_TOP + 34, 8, 30, [[0, "rgba(255,200,120,0.55)"], [1, "rgba(255,200,120,0)"]]) })),
  ]);
  return v.place(pic, 0, 0, { blend: "screen" });
}

function lampHeads(v: View, model: DeepReadonly<Model>): Drawing {
  const on = LAMPS.map((_, i) => lampLit(model, i));
  if (!on.some(Boolean)) return null;
  const heads = v.picture({ key: "lamp-heads", width: W, height: H, deps: [on.map((b) => (b ? "1" : "0")).join("")] }, () => v.group({ effects: { glow: { blur: 14, color: "#ffb24a", strength: 3 } } }, LAMPS.map((l, i) => on[i] === true && v.polygon([[l.x - 6, l.foot - LAMP_H + 7], [l.x + 6, l.foot - LAMP_H + 7], [l.x + 4.5, l.foot - LAMP_H - 5], [l.x - 4.5, l.foot - LAMP_H - 5]], { fill: "#fff0b8" }))));
  return v.place(heads, 0, 0);
}

function tramLights(v: View, f: number, night: number): Drawing {
  if (night < 0.3) return null;
  const x = tramX(f), y = RAIL_Y + 4 - 72;
  return v.group({ opacity: clamp01((night - 0.3) * 2), effects: { glow: { blur: 10, color: "#ffb24a", strength: 2 } } }, [
    [28, 62, 96, 130, 164].map((wx) => v.rect(x + wx + 1, y + 19, 24, 20, { fill: "rgba(255,214,140,0.9)" })),
    v.circle(x + 204, y + 30, 3.4, { fill: "#fff6c0" }),
  ]);
}

function sparks(v: View, model: DeepReadonly<Model>): Drawing {
  const t = since(model.tram, model.frame, LASTS.tram);
  if (t === null) return null;
  const x = tramX(model.frame) + 124, y = RAIL_Y + 4 - 72 - 62;
  return v.group({ blend: "add", effects: { glow: { blur: 8, color: "#7ac8ff", strength: 3 } } }, Array.from({ length: 8 }, (_, i) => {
    const a = hash(i, t, 5) * Math.PI * 2, d = 4 + hash(i, t, 6) * 12;
    return v.line(x, y, x + Math.cos(a) * d, y + Math.sin(a) * d + 3, { stroke: "#d8f0ff", weight: 1.4 });
  }));
}

function hsl(h: number, l: number): RGB {
  const s = 0.9, c = (1 - Math.abs(2 * l - 1)) * s, hp = (h % 360) / 60, x = c * (1 - Math.abs((hp % 2) - 1));
  const [r, g, b] = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  const m = l - c / 2;
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

function fireworks(v: View, model: DeepReadonly<Model>): Drawing {
  const f = model.frame;
  const live = model.rockets.filter((r) => f >= r.at && f - r.at < LASTS.rocket);
  if (live.length === 0) return null;
  const flash = live.map((r) => {
    const s = f - r.at - CLIMB;
    return s >= 0 && s < 12 && v.rect(0, 0, W, H, { fill: rgba(hsl(r.hue, 0.6), 0.1 * (1 - s / 12)), blend: "add" });
  });
  const marks = live.map((r) => {
    const t = f - r.at;
    if (t < CLIMB) {
      const u = 1 - (1 - t / CLIMB) ** 2;
      const y = 330 + (r.y - 330) * u;
      return [v.line(r.x, y, r.x - 1, y + 14, { stroke: "rgba(255,220,170,0.8)", weight: 1.6 }), v.circle(r.x, y, 2, { fill: "#fff2d0" })];
    }
    const s = t - CLIMB, fade = 1 - s / (LASTS.rocket - CLIMB);
    const col = rgba(mix(hsl(r.hue, 0.65), [255, 255, 255], 0.3 * fade), fade);
    const cmds: PathCommand[] = Array.from({ length: 30 }, (_, k): PathCommand[] => {
      const a = (k / 30) * Math.PI * 2 + hash(k, r.at, 3) * 0.2;
      const sp = 1.8 + hash(k, r.at, 4) * 0.8;
      const d = (q: number): number => sp * 40 * (1 - Math.exp(-q / 30));
      const p0 = Math.max(0, s - 6);
      return [["move", r.x + Math.cos(a) * d(p0), r.y + Math.sin(a) * d(p0) + p0 * p0 * 0.006], ["line", r.x + Math.cos(a) * d(s), r.y + Math.sin(a) * d(s) + s * s * 0.006]];
    }).flat();
    return v.path(cmds, { stroke: col, weight: 2, cap: "round" });
  });
  return [flash, v.group({ blend: "add", effects: { glow: { blur: 10, color: "#ffffff", strength: 2 } } }, marks)];
}

// --- Hover and hints ---------------------------------------------------------------

function hover(v: View, model: DeepReadonly<Model>, o: Opts): Drawing {
  const m = model.mouse;
  const hit = m ? hitTest(model, m[0], m[1], o.folk) : null;
  v.cursor(hit && hit.hint !== "" ? "pointer" : "default");
  const pulse = Math.sin(model.frame * 0.15) * 2;
  const spots: readonly (readonly [number, number])[] = [[TOWER.x + TOWER.w / 2, TOWER.top - 12], [(BUILDINGS[0]?.x ?? 12) + 60, BASE - 104], [MOUSE.x + 12, BACK_FEET - 96], [boatX(model.frame), BOAT_Y - 64], [MILL.x + 40, MILL.y - 40]];
  const marks = o.hints && hit === null && spots.map(([x, y], i) => {
    const a = 0.35 + 0.35 * Math.sin(model.frame * 0.06 + i * 1.7);
    const r = 5 + pulse * 0.5;
    const star = Array.from({ length: 8 }, (_, k): [number, number] => {
      const ang = (k / 8) * Math.PI * 2 - Math.PI / 2, rr = k % 2 === 0 ? r : r * 0.42;
      return [x + Math.cos(ang) * rr, y + Math.sin(ang) * rr];
    });
    return v.polygon(star, { fill: `rgba(255,236,150,${a.toFixed(3)})`, stroke: `rgba(120,80,20,${(a * 0.8).toFixed(3)})`, weight: 0.8 });
  });
  if (!hit || hit.hint === "") return marks;
  return [
    marks,
    hit.r > 0 && v.circle(hit.x, hit.y, hit.r + pulse, { stroke: "rgba(255,240,170,0.95)", weight: 2.5, brush: { preset: "chalk", opacity: 0.9 }, gesture: { seed: 5 } }),
    o.hints && m && v.text(hit.hint, { x: m[0] + 16, y: m[1] + 14 }, { size: 14, font: "Georgia, serif", style: "italic", fill: "#3a2418", halo: "rgba(255,248,228,0.95)", keepInside: true, overlay: true }),
  ];
}

// --- The frame --------------------------------------------------------------------

export function paintScene(v: View, model: DeepReadonly<Model>, o: Opts): RootDrawing {
  const f = model.frame;
  const night = nightOf(model.clock), dusk = duskOf(model.clock);
  const wx = weatherOf(model);
  const wet = wx.kind === null ? 0 : wx.arriving ? clamp01(wx.t / 60) : 1 - clamp01(wx.t / 40);
  const full = { width: W, height: H };
  const town = v.picture({ key: "town", ...full }, () => paintTown(v));
  const dim = mix([255, 196, 150], [46, 60, 118], night);
  const shade = Math.max(dusk * 0.4, night * 0.86);
  // What moves is drawn after the lights, so it passes in front of lit windows;
  // it is darkened by an effect instead of the multiply the still town gets.
  const bright = 1 - Math.max(0.62 * night, 0.18 * dusk) - 0.14 * wet;
  const movers: Drawing = [
    bakery(v, model),
    cafe(v, model, o),
    walkers(v, model, 0, o),
    balloon(v, model),
    v.at({ translate: [Math.round(tramX(f)), RAIL_Y + 4 - TRAM_H] }, v.place(v.picture({ key: "tram", width: 214, height: TRAM_H + 70 }, () => v.at({ translate: [0, 70] }, paintTram(v, false))), 0, -70)),
    cyclist(v, model, o),
    walkers(v, model, 1, o),
    cart(v, model, o),
    v.place(v.picture({ key: "front", ...full }, () => paintFront(v)), 0, 0),
    canal(v, model, night),
    petals(v, model),
    pigeons(v, model),
    precipitation(v, f, wx, night),
  ];
  return v.paper({ scale: 3, contrast: 0.7 }, [
    v.place(v.picture({ key: "sky", ...full }, () => paintSky(v)), 0, 0),
    dusk > 0 && v.place(v.picture({ key: "dusk-sky", ...full }, () => DUSK_SKY(v)), 0, 0, { opacity: dusk * (1 - night * 0.5) }),
    night > 0 && v.place(v.picture({ key: "stars", ...full }, () => stars(v)), 0, 0, { opacity: night * (1 - wet), blend: "screen" }),
    sun(v, model.clock),
    clouds(v, f),
    wet > 0 && v.rect(0, 0, W, 360, { fill: `rgba(112,120,136,${(0.6 * wet).toFixed(3)})` }),
    hotAir(v, model),
    stormClouds(v, wx),
    v.place(v.picture({ key: "hills", ...full }, () => paintHills(v)), 0, 0),
    sails(v, model.millAngle),
    smoke(v, f, since(model.bakery, f, LASTS.bakery) !== null),
    v.place(town, 0, 0),
    model.sky.kind === "snow" && v.place(v.picture({ key: "snow", ...full }, () => snowcaps(v)), 0, 0),
    clockHands(v, model.clock),
    belfry(v, model, night),
    v.place(v.picture({ key: "canal", ...full }, () => paintCanal(v)), 0, 0),
    v.place(v.picture({ key: "reflection", ...full }, () => reflection(v, town)), 0, 0),
    // Evening and rain: the still town darkens, then its lights come on.
    shade > 0.01 && v.rect(0, 0, W, H, { fill: rgba(dim, shade), blend: "multiply" }),
    wet > 0 && v.rect(0, 0, W, H, { fill: `rgba(150,160,182,${(0.35 * wet).toFixed(3)})`, blend: "multiply" }),
    litWindows(v, model),
    lampLight(v, model, town),
    bright < 0.99 ? v.group({ effects: { brightness: bright, saturation: 1 - 0.35 * night } }, movers) : movers,
    lampHeads(v, model),
    tramLights(v, f, night),
    burner(v, model, night),
    sparks(v, model),
    lightning(v, model),
    fireworks(v, model),
    hover(v, model, o),
  ]);
}
