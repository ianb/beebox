// The cast, painted in ink and pale colour. Each is drawn about its feet at
// (0, 0), y up negative: defenders face right, the haunted things face left.
// The live layer records each pose once as a picture.
import type { Drawing, Vec2, View } from "@ianbicking/canvas-loop";
import { INDIGO, INK, OCHRE, SAGE, VERMILION, blob, dryStyle, ellipsePts, eye, groundShadow, inkStyle, rectPts, rgba, stroke, tone } from "./brush-tea.js";
import type { DefKind, FoeKind } from "./rules-tea.js";

/** Every cast picture is this size with the feet at (FOOT_X, FOOT_Y). */
export const PIC_W = 120;
export const PIC_H = 130;
export const FOOT_X = 60;
export const FOOT_Y = 116;

export type DefPose = "idle" | "blink" | "act" | "pop0" | "pop1" | "pop2";
export type FoePose = "walk0" | "walk1" | "walk2" | "walk3" | "walk4" | "walk5" | "bite0" | "bite1" | "hit";

/** Squash and stretch for each pose, about the feet. */
function defSquash(p: DefPose): [number, number] {
  switch (p) {
    case "pop0": return [1.3, 0.55];
    case "pop1": return [0.82, 1.22];
    case "pop2": return [1.08, 0.94];
    case "act": return [1.06, 0.95];
    case "idle":
    case "blink": return [1, 1];
  }
}
function foeSquash(p: FoePose): [number, number] {
  switch (p) {
    case "walk0": return [1.16, 0.82];
    case "walk1": return [1, 1];
    case "walk2": return [0.9, 1.12];
    case "walk3": return [0.95, 1.06];
    case "walk4": return [1, 1];
    case "walk5": return [0.93, 1.08];
    case "bite0": return [1.1, 0.9];
    case "bite1": return [0.96, 1.04];
    case "hit": return [1.22, 0.78];
  }
}

// --- Defenders ---------------------------------------------------------------------

function inkstone(v: View, p: DefPose): Drawing {
  const happy = p === "act";
  return [
    groundShadow(v, 0, 0, 36),
    // The ink stick leaning on the back, with its gold label.
    blob(v, [[-34, -36], [-26, -80], [-15, -78], [-22, -34]], { fill: "#2b2523", seed: 11, line: 2, sharp: true }),
    v.polygon([[-28.5, -66], [-26.6, -74], [-17.6, -72.6], [-19.4, -64.4]], { fill: OCHRE }),
    // The stone: a slab with a sloped top and a well of wet ink.
    blob(v, [[-36, -4], [-35, -32], [-29, -38], [31, -38], [36, -32], [35, -4], [29, 0], [-30, 0]], { fill: "#4d4f5a", light: "#80848f", dark: "#30313a", seed: 12, line: 2.6 }),
    blob(v, [[-30, -37], [-22, -50], [27, -50], [32, -37]], { fill: "#686b78", seed: 13, line: 2, sharp: true }),
    v.ellipse(13, -44, 14, 4.2, { fill: INK }),
    v.line(5, -45.5, 16, -46.5, { stroke: "rgba(255,255,255,0.7)", weight: 1.4 }),
    happy && [v.circle(14, -62, 7, { fill: INK }), v.circle(11.5, -64.5, 2, { fill: "#ffffff" }), v.circle(8, -50, 3, { fill: INK })],
    // A small contented face on the front.
    v.circle(-17, -15, 4, { fill: rgba(VERMILION, 0.45) }),
    v.circle(13, -15, 4, { fill: rgba(VERMILION, 0.45) }),
    eye(v, { x: -10, y: -22, r: 4.6, look: 0.6, shut: p === "blink" || happy, seed: 14 }),
    eye(v, { x: 6, y: -22, r: 4.6, look: 0.6, shut: p === "blink" || happy, seed: 15 }),
    stroke(v, [[-6, -13], [-2, -10], [2, -13]], { seed: 16, weight: 1.6, colour: "#f2e9d3", amp: 0 }),
  ];
}

function crane(v: View, p: DefPose): Drawing {
  const shoot = p === "act";
  const bob = p === "blink" ? 3 : 0;
  const head: Vec2 = shoot ? [26, -80] : [14, -90 + bob];
  const neck: Vec2[] = shoot ? [[6, -54], [14, -66], [22, -76], head] : [[6, -54], [14, -70], [12, -82], head];
  return [
    groundShadow(v, 0, 0, 26),
    // Legs: one standing, one tucked.
    v.line(-4, -36, -3, 0, { stroke: INK, weight: 2.4, brush: "ink", gesture: { seed: 21, pressure: "even" } }),
    v.curve([[2, -36], [10, -26], [3, -21]], false, { stroke: INK, weight: 2.2, brush: "ink", gesture: { seed: 22, pressure: "even" } }),
    v.line(-10, 0, 6, 0, inkStyle(23, 2)),
    // Black tail feathers, in dry strokes.
    [0, 1, 2].map((i) => v.line(-18, -48 + i * 3, -42 + i * 2, -36 + i * 6, dryStyle(24 + i, 9 - i * 2))),
    blob(v, ellipsePts(-6, -47, 24, 13, 16), { fill: "#fbf8ef", dark: "#d9d2c2", seed: 27, line: 2.2 }),
    v.curve([[-24, -50], [-8, -58], [10, -52]], false, dryStyle(28, 6, GREYISH, 0.4)),
    // The neck: white below, black above, then the head with its red crown.
    v.path(v.tube(neck, { width: 8, profile: [[0, 1.3], [1, 0.8]] }), { fill: "#fbf8ef", ...inkStyle(29, 1.8) }),
    v.curve(neck.slice(1), false, dryStyle(30, 7, INK, 0.8)),
    blob(v, ellipsePts(head[0], head[1], 7.5, 6.5, 12), { fill: "#fbf8ef", seed: 31, line: 1.8 }),
    v.circle(head[0] - 1, head[1] - 6, 4.2, { fill: VERMILION }),
    eye(v, { x: head[0] + 2, y: head[1] - 1, r: 2.4, look: 1, seed: 32 }),
    shoot
      ? [
        v.polygon([[head[0] + 5, head[1] - 2], [head[0] + 24, head[1] - 7], [head[0] + 6, head[1] + 1]], { fill: "#8f8466", ...inkStyle(33, 1.2) }),
        v.polygon([[head[0] + 5, head[1] + 2], [head[0] + 22, head[1] + 8], [head[0] + 5, head[1] + 5]], { fill: "#8f8466", ...inkStyle(34, 1.2) }),
      ]
      : v.polygon([[head[0] + 5, head[1] - 2], [head[0] + 26, head[1] + 1], [head[0] + 5, head[1] + 3]], { fill: "#8f8466", ...inkStyle(33, 1.2) }),
  ];
}
const GREYISH = "#6d675e";

export type Wear = 0 | 1 | 2;

function screen(v: View, p: DefPose, wear: Wear): Drawing {
  const panels: Vec2[][] = [
    [[-40, -2], [-40, -80], [-14, -76], [-14, 2]],
    [[-14, 2], [-14, -76], [14, -80], [14, -2]],
    [[14, -2], [14, -80], [40, -76], [40, 2]],
  ];
  const gold = ["#d8b25a", "#e4c472", "#d8b25a"];
  return [
    groundShadow(v, 0, 2, 44),
    panels.map((pts, i) => blob(v, pts, { fill: gold[i] ?? OCHRE, light: "#f1dc9c", dark: "#b88c3a", seed: 40 + i, line: 3.4, sharp: true })),
    // An ink landscape across the panels: a far peak, a pine bough.
    v.clip(panels.flat(), [
      v.curve([[-40, -36], [-26, -54], [-12, -44], [4, -62], [22, -46], [40, -52]], false, { stroke: tone(INK, 0.55), weight: 9, brush: { preset: "wash", opacity: 0.5 }, gesture: { seed: 44, faint: true } }),
      v.curve([[-36, -18], [-12, -26], [10, -22], [36, -30]], false, dryStyle(45, 4, INK, 0.7)),
      [[-28, -24], [-8, -27], [12, -24], [30, -29]].map(([x, y]) => v.circle(x ?? 0, y ?? 0, 6, { fill: rgba(SAGE, 0.75) })),
    ]),
    // Worried eyes on the middle panel, watching the right.
    stroke(v, [[-10, -60], [-3, -57]], { seed: 46, weight: 1.8, amp: 0 }),
    stroke(v, [[4, -57], [11, -61]], { seed: 47, weight: 1.8, amp: 0 }),
    eye(v, { x: -6, y: -50, r: 4.8, look: 1, dizzy: wear === 2, shut: p === "blink", seed: 48 }),
    eye(v, { x: 7, y: -50, r: 4.8, look: 1, dizzy: wear === 2, shut: p === "blink", seed: 49 }),
    stroke(v, [[-4, -38], [0, -40], [4, -38], [8, -40]], { seed: 50, weight: 1.4, amp: 0 }),
    wear >= 1 && [
      v.polygon([[22, -66], [30, -58], [26, -48], [34, -40], [24, -36], [20, -50]], { fill: "#efe4c8", ...inkStyle(51, 1.6) }),
      stroke(v, [[16, -20], [24, -26], [20, -32], [28, -34]], { seed: 52, weight: 1.4 }),
    ],
    wear === 2 && [
      v.polygon([[-34, -70], [-22, -64], [-28, -52], [-18, -46], [-32, -42]], { fill: "#efe4c8", ...inkStyle(53, 1.6) }),
      v.polygon([[-4, -24], [6, -18], [0, -10], [-8, -14]], { fill: "#efe4c8", ...inkStyle(54, 1.4) }),
    ],
  ];
}

function tiger(v: View, p: DefPose): Drawing {
  const swipe = p === "act";
  const tail: Vec2[] = p === "blink" ? [[-28, -8], [-44, -18], [-40, -42], [-50, -56]] : [[-28, -8], [-46, -14], [-46, -38], [-36, -54]];
  const headDx = swipe ? 6 : 0;
  const hx = 10 + headDx, hy = swipe ? -60 : -62;
  return [
    groundShadow(v, 0, 0, 36),
    // The tail, striped.
    v.path(v.tube(tail, { width: 8, profile: [[0, 1], [1, 0.7]] }), { fill: "#e2a24c", ...inkStyle(60, 1.8) }),
    [0.35, 0.6, 0.85].map((u, i) => {
      const k = Math.min(tail.length - 2, Math.floor(u * (tail.length - 1)));
      const a = tail[k] ?? [0, 0], b = tail[k + 1] ?? a;
      const f = u * (tail.length - 1) - k;
      const x = a[0] + (b[0] - a[0]) * f, y = a[1] + (b[1] - a[1]) * f;
      return v.line(x - 5, y - 2, x + 5, y + 2, dryStyle(61 + i, 4, INK, 0.9));
    }),
    // The body: folded paper, in facets.
    blob(v, [[-32, 0], [-36, -24], [-24, -44], [0, -50], [14, -40], [18, -12], [24, 0]], { fill: "#e09a42", light: "#f2c27a", dark: "#b8702a", seed: 64, line: 2.6, sharp: true }),
    v.polygon([[-32, 0], [-36, -24], [-14, -18], [-8, 0]], { fill: rgba("#a2601f", 0.4) }),
    [[-26, -38, -18, -22], [-14, -46, -8, -28], [-2, -48, 4, -30], [-30, -16, -20, -4]].map(([x1, y1, x2, y2], i) => v.line(x1 ?? 0, y1 ?? 0, x2 ?? 0, y2 ?? 0, dryStyle(65 + i, 5, INK, 0.8))),
    // Front paws, one up for a swat.
    swipe
      ? [
        v.path(v.tube([[12, -36], [28, -42], [44, -48]], { width: 9 }), { fill: "#e09a42", ...inkStyle(70, 2) }),
        blob(v, ellipsePts(48, -49, 8, 7, 10), { fill: "#f6ecd8", seed: 71, line: 2 }),
        [0, 1, 2].map((i) => stroke(v, [[54, -54 + i * 4], [60, -56 + i * 5]], { seed: 72 + i, weight: 1.4, amp: 0 })),
      ]
      : blob(v, ellipsePts(16, -3, 8, 4.5, 10), { fill: "#f6ecd8", seed: 71, line: 2 }),
    blob(v, ellipsePts(4, -3, 7, 4, 10), { fill: "#f6ecd8", seed: 75, line: 2 }),
    // The head: big, round, a little silly.
    blob(v, [[hx - 2, -72 + hy + 62], [hx + 6, -84 + hy + 62], [hx + 20, -84 + hy + 62], [hx + 30, -72 + hy + 62], [hx + 30, -52 + hy + 62], [hx + 20, -42 + hy + 62], [hx + 2, -42 + hy + 62], [hx - 6, -54 + hy + 62]], { fill: "#e7a64c", light: "#f6cc84", seed: 76, line: 2.6, sharp: true }),
    v.triangle(hx, hy - 18, hx + 3, hy - 30, hx + 10, hy - 21, { fill: "#e7a64c", ...inkStyle(77, 2) }),
    v.triangle(hx + 18, hy - 22, hx + 26, hy - 30, hx + 28, hy - 16, { fill: "#e7a64c", ...inkStyle(78, 2) }),
    [[hx + 6, hy - 20, hx + 9, hy - 12], [hx + 14, hy - 21, hx + 14, hy - 13], [hx + 22, hy - 20, hx + 19, hy - 12]].map(([x1, y1, x2, y2], i) => v.line(x1 ?? 0, y1 ?? 0, x2 ?? 0, y2 ?? 0, dryStyle(79 + i, 3.5, INK, 0.9))),
    blob(v, ellipsePts(hx + 18, hy + 8, 11, 7, 12), { fill: "#f6ecd8", seed: 82, line: 1.8 }),
    eye(v, { x: hx + 8, y: hy - 4, r: 5.4, look: 1, seed: 83 }),
    eye(v, { x: hx + 22, y: hy - 4, r: 5.4, look: 1, seed: 84 }),
    v.ellipse(hx + 20, hy + 4, 3.4, 2.4, { fill: INK }),
    swipe
      ? blob(v, ellipsePts(hx + 20, hy + 12, 6, 4.5, 10), { fill: VERMILION, seed: 85, line: 1.8 })
      : stroke(v, [[hx + 14, hy + 10], [hx + 19, hy + 13], [hx + 24, hy + 10]], { seed: 85, weight: 1.6, amp: 0 }),
    [[-1, 0], [1, 0]].map(([s], i) => stroke(v, [[hx + 26, hy + 7 + (s ?? 0) * 2], [hx + 38, hy + 4 + (s ?? 0) * 5]], { seed: 86 + i, weight: 1, amp: 0 })),
  ];
}

function seal(v: View): Drawing {
  return [
    // A red stamp on a carved wooden handle.
    blob(v, rectPts(-30, -22, 60, 22), { fill: VERMILION, dark: "#9e2a18", seed: 90, line: 2.6, sharp: true }),
    blob(v, [[-24, -22], [-20, -40], [20, -40], [24, -22]], { fill: "#8a5a32", light: "#b07a48", seed: 91, line: 2.4, sharp: true }),
    blob(v, ellipsePts(0, -52, 15, 13, 14), { fill: "#9a6a3c", light: "#c08c58", seed: 92, line: 2.4 }),
    eye(v, { x: -5, y: -54, r: 3.6, look: 0, seed: 93 }),
    eye(v, { x: 6, y: -54, r: 3.6, look: 0, seed: 94 }),
    stroke(v, [[-4, -45], [1, -43], [6, -45]], { seed: 95, weight: 1.4, amp: 0 }),
  ];
}

/** The red mark a seal leaves on the paper, about its centre. */
export function paintStampMark(v: View, seed: number): Drawing {
  const s = 34;
  const cuts: Vec2[][] = [
    [[-20, -18], [-20, 20]], [[-20, -18], [-4, -18], [-4, 2], [-20, 2]], [[4, -18], [20, -18]], [[12, -18], [12, 20]], [[4, 2], [20, 2]], [[-14, 10], [-8, 18]], [[4, 20], [20, 20]],
  ];
  return [
    blob(v, rectPts(-s, -s, s * 2, s * 2), { fill: VERMILION, seed, line: 0, amp: 2.2, sharp: true }),
    cuts.map((c, i) => v.curve(c, false, { stroke: "#f6e7cf", weight: 4.5, brush: { preset: "chalk", grain: 0.5 }, gesture: { seed: seed + i, pressure: "even" } })),
  ];
}

export function paintDefender(v: View, kind: DefKind, p: DefPose, wear: Wear): Drawing {
  const [sx, sy] = defSquash(p);
  const body = ((): Drawing => {
    switch (kind) {
      case "inkstone": return inkstone(v, p);
      case "crane": return crane(v, p);
      case "screen": return screen(v, p, wear);
      case "tiger": return tiger(v, p);
      case "seal": return seal(v);
    }
  })();
  return v.at({ translate: [FOOT_X, FOOT_Y], scale: [sx, sy] }, body);
}

// --- The haunted things ---------------------------------------------------------------

function tongue(v: View, pts: readonly Vec2[], seed: number, width = 6): Drawing {
  return v.path(v.tube(pts, { width, profile: [[0, 0.8], [1, 1.1]] }), { fill: "#e0604a", ...inkStyle(seed, 1.6) });
}

function umbrella(v: View, p: FoePose): Drawing {
  const k = p.startsWith("walk") ? Number(p.slice(4)) : 0;
  const bite = p === "bite0";
  const lick = p.startsWith("walk") ? Math.sin((k / 6) * Math.PI * 2) * 6 : 0;
  const canopy: Vec2[] = [[0, -104], [9, -86], [20, -62], [26, -46], [12, -40], [0, -42], [-12, -40], [-26, -46], [-20, -62], [-9, -86]];
  return [
    groundShadow(v, 0, 0, 18),
    // One wooden leg in one geta.
    v.line(0, -42, 0, -8, { stroke: "#7a5232", weight: 4.5, brush: "ink", gesture: { seed: 101, pressure: "even" } }),
    blob(v, rectPts(-12, -9, 24, 5), { fill: "#c89a5a", seed: 102, line: 1.6, sharp: true }),
    v.rect(-9, -4, 4, 4, { fill: "#7a5232" }), v.rect(5, -4, 4, 4, { fill: "#7a5232" }),
    // The paper canopy, ribbed, with a red band.
    blob(v, canopy, { fill: "#5a7aa2", light: "#93acc8", dark: INDIGO, seed: 103, line: 2.6 }),
    v.clip(v.curvePath(canopy, true), [
      [-16, -8, 0, 8, 16].map((dx, i) => v.line(0, -104, dx * 1.5, -40, { stroke: rgba(INK, 0.5), weight: 1.2 + (i % 2) * 0.4, brush: "ink", gesture: { seed: 104 + i, pressure: "taper-in" } })),
      v.line(-30, -52, 30, -50, { stroke: VERMILION, weight: 6, brush: { preset: "bristle", load: 0.8, bristles: 10 }, gesture: { seed: 110, pressure: "even" } }),
    ]),
    eye(v, { x: -5, y: -70, r: 9.5, look: -1, dizzy: p === "hit", shut: false, seed: 111 }),
    // The mouth and the long lolling tongue.
    blob(v, [[-18, -56], [-6, -52], [-14, -46]], { fill: "#3a1c18", seed: 112, line: 1.6, sharp: true }),
    bite
      ? tongue(v, [[-12, -52], [-26, -54], [-36, -48]], 113, 7)
      : tongue(v, [[-12, -51], [-20, -44 + lick * 0.3], [-24, -34 + lick]], 113),
  ];
}

function sandal(v: View, p: FoePose): Drawing {
  const k = p.startsWith("walk") ? Number(p.slice(4)) : 0;
  const run = Math.sin((k / 6) * Math.PI * 2);
  const sole: Vec2[] = ellipsePts(0, -38, 15, 27, 16);
  return [
    groundShadow(v, 0, 0, 16),
    // Little running legs.
    v.curve([[-4, -14], [-8 - run * 6, -6], [-10 - run * 8, 0]], false, inkStyle(121, 2.2)),
    v.curve([[4, -14], [6 + run * 6, -6], [6 + run * 8, 0]], false, inkStyle(122, 2.2)),
    // The straw sole, standing up, woven.
    blob(v, sole, { fill: "#dcb873", light: "#efd6a2", dark: "#b88e48", seed: 123, line: 2.4 }),
    v.clip(v.curvePath(sole, true), [0, 1, 2, 3, 4, 5, 6].map((i) => v.line(-16, -62 + i * 7, 16, -60 + i * 7, { stroke: rgba("#8a6a32", 0.55), weight: 1.2, brush: "pencil", gesture: { seed: 124 + i, faint: true } }))),
    // The red thong, a V from the toe.
    v.curve([[-12, -44], [-2, -58], [10, -46]], false, { stroke: VERMILION, weight: 4.5, brush: "ink", gesture: { seed: 132, pressure: "even" } }),
    v.circle(-2, -58, 3, { fill: VERMILION }),
    eye(v, { x: -3, y: -36, r: 7.5, look: -1, dizzy: p === "hit", seed: 133 }),
    blob(v, [[-12, -22], [-2, -24], [-8, -16]], { fill: "#3a1c18", seed: 134, line: 1.4, sharp: true }),
    p === "bite0" ? tongue(v, [[-9, -21], [-20, -22], [-26, -18]], 135, 5) : tongue(v, [[-9, -20], [-14, -14], [-14, -8 + run * 2]], 135, 5),
  ];
}

function kettle(v: View, p: FoePose, hurt: boolean): Drawing {
  const k = p.startsWith("walk") ? Number(p.slice(4)) : 0;
  const step = Math.sin((k / 6) * Math.PI * 2) * 3;
  const pot = ellipsePts(0, -36, 32, 27, 20);
  const bumps = Array.from({ length: 18 }, (_, i): Vec2 => [-24 + (i % 6) * 9 + (Math.floor(i / 6) % 2) * 4, -50 + Math.floor(i / 6) * 9]);
  return [
    groundShadow(v, 0, 0, 34),
    // The tanuki tail behind, ringed.
    blob(v, [[22, -24], [40, -36], [50, -30], [46, -16], [30, -10]], { fill: "#8a6a4a", light: "#b08e6a", seed: 141, line: 2 }),
    v.line(36, -34, 34, -14, dryStyle(142, 4, INK, 0.8)),
    v.line(44, -32, 42, -15, dryStyle(143, 4, INK, 0.8)),
    // Stubby legs.
    [-18, -6, 8, 20].map((x, i) => blob(v, ellipsePts(x + (i % 2 === 0 ? step : -step), -4, 5.5, 6, 10), { fill: "#6a4e36", seed: 144 + i, line: 1.8 })),
    // The iron pot, hobnailed.
    blob(v, pot, { fill: "#3d3835", light: "#6b6560", dark: "#221e1c", seed: 150, line: 3 }),
    v.clip(v.curvePath(pot, true), bumps.map(([x, y]) => v.circle(x, y, 2.4, { fill: rgba("#8a827a", 0.55) }))),
    // The spout, the lid and the handle.
    v.path(v.tube([[-26, -34], [-38, -42], [-46, -54]], { width: 9, profile: [[0, 1.3], [1, 0.8]] }), { fill: "#3d3835", ...inkStyle(151, 2.4) }),
    hurt
      ? blob(v, ellipsePts(6, -64, 15, 4.5, 12), { fill: "#4a4440", seed: 152, line: 2 })
      : blob(v, ellipsePts(0, -62, 15, 4.5, 12), { fill: "#4a4440", seed: 152, line: 2 }),
    v.circle(hurt ? 8 : 0, hurt ? -70 : -68, 3.5, { fill: "#4a4440", ...inkStyle(153, 1.6) }),
    v.curve([[-22, -54], [-16, -84], [16, -84], [22, -54]], false, { stroke: INK, weight: 4.4, brush: "ink", gesture: { seed: 154, pressure: "even", wobble: 0.6 } }),
    hurt && stroke(v, [[10, -54], [4, -44], [12, -36], [6, -26]], { seed: 155, weight: 1.6, colour: "#d8cfc0" }),
    // A grumpy face.
    eye(v, { x: -16, y: -38, r: 6, look: -1, dizzy: p === "hit", seed: 156 }),
    eye(v, { x: 0, y: -38, r: 6, look: -1, dizzy: p === "hit", seed: 157 }),
    v.line(-24, -48, -12, -45, inkStyle(158, 2.6, "#d8cfc0")),
    v.line(-5, -45, 7, -48, inkStyle(159, 2.6, "#d8cfc0")),
    p === "bite0"
      ? blob(v, ellipsePts(-9, -22, 8, 5, 10), { fill: "#3a1c18", seed: 160, line: 1.8, lineColour: "#d8cfc0" })
      : stroke(v, [[-16, -22], [-9, -25], [-2, -22]], { seed: 160, weight: 2, colour: "#d8cfc0", amp: 0 }),
  ];
}

function lantern(v: View, p: FoePose): Drawing {
  const k = p.startsWith("walk") ? Number(p.slice(4)) : 0;
  const sway = Math.sin((k / 6) * Math.PI * 2);
  const body = ellipsePts(0, -66, 24, 30, 18);
  return [
    // A wisp of a tail instead of feet.
    v.curve([[2, -36], [8 + sway * 4, -24], [2 - sway * 4, -14], [10, -6]], false, { stroke: rgba(INK, 0.55), weight: 6, brush: { preset: "wash", opacity: 0.6 }, gesture: { seed: 170, pressure: "taper-out", faint: true } }),
    v.group({ effects: { glow: { blur: 12, color: "#ffab3a", strength: 2.2 } } }, [
      blob(v, body, { fill: "#f6cf78", light: "#fff0c2", dark: "#e09a42", seed: 171, line: 2.4 }),
    ]),
    v.clip(v.curvePath(body, true), [-24, -14, -4, 6, 16].map((dy, i) => v.curve([[-26, -66 + dy * 1.1], [0, -62 + dy * 1.1], [26, -66 + dy * 1.1]], false, { stroke: rgba("#8a5a22", 0.6), weight: 1.4, brush: "ink", gesture: { seed: 172 + i, pressure: "even" } }))),
    // Black lacquer caps.
    blob(v, rectPts(-11, -100, 22, 6), { fill: INK, seed: 178, line: 0, sharp: true }),
    blob(v, rectPts(-10, -38, 20, 5), { fill: INK, seed: 179, line: 0, sharp: true }),
    v.line(0, -100, 0, -108, inkStyle(180, 2)),
    // The torn seam is its mouth; one big eye above.
    blob(v, [[-25, -62], [-6, -56], [-10, -50], [-25, -52]], { fill: "#3a1c18", seed: 181, line: 1.8, sharp: true }),
    tongue(v, [[-14, -53], [-26 - sway * 3, -46], [-28, -36 + sway * 3]], 182, 6),
    eye(v, { x: -6, y: -76, r: 8.5, look: -1, dizzy: p === "hit", seed: 183 }),
    v.circle(10, -64, 4, { fill: rgba(VERMILION, 0.4) }),
  ];
}

export function paintFoe(v: View, kind: FoeKind, p: FoePose, hurt: boolean): Drawing {
  const [sx, sy] = foeSquash(p);
  const body = ((): Drawing => {
    switch (kind) {
      case "umbrella": return umbrella(v, p);
      case "sandal": return sandal(v, p);
      case "kettle": return kettle(v, p, hurt);
      case "lantern": return lantern(v, p);
    }
  })();
  return v.at({ translate: [FOOT_X, FOOT_Y], scale: [sx, sy] }, body);
}

/** An ink blot in flight: a glossy drop with a short dry trail. */
export function paintBlot(v: View): Drawing {
  return [
    v.line(4, 14, 22, 14, { stroke: rgba(INK, 0.6), weight: 7, brush: { preset: "bristle", load: 0.5, bristles: 8 }, gesture: { seed: 190, pressure: "taper-in" } }),
    blob(v, ellipsePts(26, 14, 8, 7, 12), { fill: INK, seed: 191, line: 0, amp: 1 }),
    v.circle(28, 11, 2, { fill: "rgba(255,255,255,0.75)" }),
  ];
}

/** A drop of ink to collect: glossy black with a gold rim, about its bottom. */
export function paintDrop(v: View): Drawing {
  const pts: Vec2[] = [[20, 4], [26, 16], [30, 26], [28, 34], [20, 39], [12, 34], [10, 26], [14, 16]];
  return [
    v.group({ effects: { glow: { blur: 8, color: "#ffd88a", strength: 3 } } }, [v.curve(pts, true, { fill: INK })]),
    v.curve(pts, true, { stroke: OCHRE, weight: 2.2, brush: "ink", gesture: { seed: 192, pressure: "even" } }),
    v.ellipse(16, 24, 2.6, 5, { fill: "rgba(255,255,255,0.8)" }),
  ];
}
