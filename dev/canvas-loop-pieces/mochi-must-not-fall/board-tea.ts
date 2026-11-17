// The still parts, painted once: the scroll's paper with misty hills and a red
// sun, the five lanes of the garden, the New Year mochi on its stand, the cat
// asleep beside it, the scroll's wooden roller, and the cards along the top.
import type { Drawing, Vec2, View } from "@ianbicking/canvas-loop";
import { GREY, INK, OCHRE, PALE, PAPER, SAGE, VERMILION, blob, dryStyle, ellipsePts, eye, groundShadow, hash, inkStyle, rectPts, rgba, stroke, tone } from "./brush-tea.js";
import { CARD_H, CARD_W, CH, COLS, CW, GX, GY, H, ROWS, W, rowFeet } from "./rules-tea.js";

export const MOCHI_AT: Vec2 = [56, rowFeet(2)];
export const CAT_AT: Vec2 = [58, rowFeet(4) + 2];
export const ROLLER_X = 902;

function paperFibres(v: View): Drawing {
  return Array.from({ length: 70 }, (_, i): Drawing => {
    const x = hash(i, 1, 3) * W, y = hash(i, 2, 3) * H, a = hash(i, 3, 3) * Math.PI;
    const len = 10 + hash(i, 4, 3) * 26;
    return v.curve([[x, y], [x + Math.cos(a) * len * 0.5, y + Math.sin(a) * len * 0.5 + 2], [x + Math.cos(a) * len, y + Math.sin(a) * len]], false, { stroke: "#cdbf9e", weight: 1, brush: { preset: "pencil", opacity: 0.5 }, gesture: { seed: 500 + i, faint: true } });
  });
}

function hills(v: View): Drawing {
  const far: Vec2[] = [[0, 120], [90, 92], [170, 112], [260, 70], [330, 98], [420, 84], [520, 110], [620, 64], [700, 96], [800, 80], [900, 104], [W, 90], [W, 170], [0, 170]];
  const near: Vec2[] = [[0, 150], [120, 128], [240, 146], [380, 120], [520, 142], [660, 118], [780, 140], [W, 126], [W, 175], [0, 175]];
  return [
    v.circle(842, 66, 34, { fill: rgba(VERMILION, 0.85) }),
    v.group({ effects: { wash: { edges: 0.6, blotch: 0.45, granulate: 0.6, bleed: 2 }, blur: 1.2 } }, [
      v.curve(far, false, { fill: tone(GREY, 0.62) }),
      v.curve(near, false, { fill: tone(GREY, 0.45) }),
    ]),
    // Mist across the feet of the hills.
    [0, 1, 2].map((i) => v.line(-40, 128 + i * 14, W + 40, 134 + i * 12, { stroke: PAPER, weight: 18, brush: { preset: "airbrush", opacity: 0.7 }, gesture: { seed: 520 + i, wobble: 6, faint: true } })),
    // A few birds.
    [[700, 40], [722, 52], [748, 36]].map(([x, y], i) => stroke(v, [[(x ?? 0) - 7, (y ?? 0) - 3], [x ?? 0, y ?? 0], [(x ?? 0) + 8, (y ?? 0) - 4]], { seed: 530 + i, weight: 1.6, amp: 0 })),
  ];
}

function lanes(v: View): Drawing {
  // Each square is one broad stroke of pale ink wash, a little different from its neighbours.
  const cells = Array.from({ length: ROWS * COLS }, (_, i): Drawing => {
    const r = Math.floor(i / COLS), c = i % COLS;
    const even = (r + c) % 2 === 0;
    const x = GX + c * CW, y = GY + r * CH + CH / 2;
    return v.line(x + 10, y + (hash(i, 1, 5) - 0.5) * 4, x + CW - 10, y + (hash(i, 2, 5) - 0.5) * 4, { stroke: even ? "#8f9a7a" : "#b4b496", weight: CH - 14, brush: { preset: "wash", opacity: even ? 0.5 : 0.36 }, gesture: { seed: 600 + i, wobble: 2, pressure: [[0, 0.85], [0.2, 1], [0.8, 1], [1, 0.8]] } });
  });
  const tufts = Array.from({ length: 64 }, (_, i): Drawing => {
    const r = i % ROWS;
    const x = GX + 10 + hash(i, 5, 9) * (COLS * CW - 20), y = GY + (r + 1) * CH - 4 - hash(i, 6, 9) * 6;
    return [-1, 0, 1].map((k) => v.line(x + k * 3, y, x + k * 6, y - 8 - hash(i, k, 4) * 7, { stroke: k === 0 ? INK : tone(SAGE, -0.45), weight: 2.2, brush: "ink", gesture: { seed: 700 + i * 3 + k, pressure: "taper-out" } }));
  });
  const pebbles = Array.from({ length: 26 }, (_, i): Drawing => {
    const x = GX + hash(i, 7, 9) * COLS * CW, y = GY + 20 + hash(i, 8, 9) * (ROWS * CH - 30);
    return v.ellipse(x, y, 3 + hash(i, 9, 9) * 3, 2, { fill: rgba(GREY, 0.3) });
  });
  return [
    v.group({ effects: { wash: { edges: 0.8, blotch: 0.45, granulate: 0.7 } } }, [cells]),
    // Dry ink strokes between the lanes, like the edges of raked beds.
    Array.from({ length: ROWS + 1 }, (_, r) => v.line(GX - 8, GY + r * CH + (r === 0 ? 2 : 0), GX + COLS * CW + 6, GY + r * CH + (hash(r, 3, 3) - 0.5) * 3, dryStyle(740 + r, r === 0 || r === ROWS ? 7 : 4, r === 0 || r === ROWS ? INK : GREY, 0.45))),
    pebbles,
    tufts,
    // Raked lines in the gravel path at the left, where the mochi sits.
    [0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => v.line(14 + i * 12, GY + 2, 16 + i * 12, GY + ROWS * CH - 4, { stroke: rgba(PALE, 0.8), weight: 1.4, brush: "pencil", gesture: { seed: 760 + i, wobble: 1.5, faint: true } })),
  ];
}

/** Bold ink at the corners: a pine bough across the sun, bamboo at the left edge. */
function framing(v: View): Drawing {
  const bough: Vec2[] = [[W + 10, 6], [900, 22], [840, 30], [780, 52], [740, 58]];
  const needles = Array.from({ length: 9 }, (_, i): Drawing => {
    const b = bough[1 + (i % 4)] ?? [0, 0];
    const cx = b[0] - 10 + hash(i, 1, 21) * 26, cy = b[1] + 4 + hash(i, 2, 21) * 10;
    return Array.from({ length: 7 }, (_n, k) => {
      const a = Math.PI * (0.05 + (k / 6) * 0.9);
      return v.line(cx, cy, cx + Math.cos(a) * 18 * (k % 2 === 0 ? 1 : -1), cy + Math.sin(a) * 9 - 10, { stroke: "#2c3a26", weight: 2.2, brush: "ink", gesture: { seed: 1000 + i * 9 + k, pressure: "taper-out" } });
    });
  });
  const stalks = [[10, 0.7], [26, 1]].map(([x, s], i): Drawing => {
    const xx = x ?? 0;
    return [
      Array.from({ length: 6 }, (_, k) => v.line(xx, H - k * 104, xx + 1, H - k * 104 - 96, { stroke: rgba(INK, 0.5 + (s ?? 1) * 0.3), weight: 9 * (s ?? 1), brush: { preset: "bristle", load: 0.7, bristles: 12 }, gesture: { seed: 1100 + i * 10 + k, pressure: "press" } })),
      Array.from({ length: 5 }, (_, k) => v.line(xx - 6, H - k * 104 - 98, xx + 7, H - k * 104 - 98, { stroke: INK, weight: 3, brush: "ink", gesture: { seed: 1150 + i * 10 + k } })),
    ];
  });
  const leaves = [[30, 236, 0.5], [34, 300, -0.3], [18, 450, 0.6], [32, 476, -0.4]].map(([x, y, a], i) => {
    const xx = x ?? 0, yy = y ?? 0, aa = a ?? 0;
    return v.line(xx, yy, xx + Math.cos(aa) * 40, yy + Math.sin(aa) * 40 + 8, { stroke: INK, weight: 9, brush: "ink", gesture: { seed: 1200 + i, pressure: [[0, 0.2], [0.3, 1], [1, 0]] } });
  });
  return [
    v.curve(bough, false, { stroke: INK, weight: 12, brush: { preset: "bristle", load: 0.6, bristles: 18, spread: 0.6 }, gesture: { seed: 990, pressure: "press", wobble: 2 } }),
    v.curve([[860, 28], [830, 10], [810, 4]], false, dryStyle(991, 5, INK, 0.6)),
    needles,
    v.group({ opacity: 0.85 }, [stalks, leaves]),
  ];
}

/** Kagami mochi on a little stand: two white cakes and a bitter orange. */
export function paintMochi(v: View, bitten: boolean): Drawing {
  return [
    groundShadow(v, 0, 0, 36),
    blob(v, [[-32, -16], [32, -16], [26, 0], [-26, 0]], { fill: "#a4542e", light: "#c87a48", seed: 801, line: 2.4, sharp: true }),
    blob(v, rectPts(-30, -24, 60, 8), { fill: "#c16a38", seed: 802, line: 2.2, sharp: true }),
    v.rect(-10, -12, 20, 7, { fill: "#6a2a14" }),
    blob(v, [[-28, -24], [-30, -36], [-18, -46], [18, -46], [30, -36], [28, -24]], { fill: "#fbf7ee", dark: "#e4dccb", seed: 803, line: 2.4 }),
    blob(v, [[-20, -44], [-21, -54], [-12, -62], [12, -62], [21, -54], [20, -44]], { fill: "#fdfaf2", dark: "#e4dccb", seed: 804, line: 2.2 }),
    bitten
      ? blob(v, [[8, -62], [16, -64], [22, -58], [14, -52]], { fill: PAPER, seed: 805, line: 1.6 })
      : [blob(v, ellipsePts(2, -70, 9, 8, 12), { fill: "#ec8a2a", light: "#f6b25e", seed: 805, line: 2 }), v.curve([[2, -78], [8, -84], [14, -80]], false, { stroke: "#4a6a2a", weight: 4, brush: "ink", gesture: { seed: 806, pressure: "swell" } })],
  ];
}

/** The cat, curled up asleep, or awake and outraged. */
export function paintCat(v: View, awake: boolean): Drawing {
  const body = ellipsePts(0, -18, 40, 18, 18);
  return [
    groundShadow(v, 0, 0, 44),
    blob(v, ellipsePts(0, -8, 48, 10, 16), { fill: "#7a4a6a", light: "#a06a8a", seed: 820, line: 2.2 }),
    v.curve([[30, -12], [44, -20], [40, -34], [26, -32]], false, { stroke: tone(OCHRE, -0.2), weight: 9, brush: "ink", gesture: { seed: 821, pressure: "taper-out" } }),
    blob(v, body, { fill: "#f1e6cf", light: "#ffffff", dark: "#d8c8a8", seed: 822, line: 2.4 }),
    // Patches, in pale ochre and ink.
    v.clip(v.curvePath(body, true), [
      v.circle(14, -26, 12, { fill: rgba(OCHRE, 0.65) }),
      v.circle(-10, -10, 8, { fill: rgba(INK, 0.6) }),
    ]),
    awake
      ? [
        blob(v, ellipsePts(-28, -34, 15, 13, 14), { fill: "#f1e6cf", seed: 823, line: 2.4 }),
        v.triangle(-40, -42, -38, -58, -30, -46, { fill: "#f1e6cf", ...inkStyle(824, 2) }),
        v.triangle(-24, -46, -16, -58, -14, -42, { fill: "#f1e6cf", ...inkStyle(825, 2) }),
        eye(v, { x: -33, y: -36, r: 4.5, look: 1, seed: 826 }),
        eye(v, { x: -21, y: -36, r: 4.5, look: 1, seed: 827 }),
        v.line(-38, -44, -30, -41, inkStyle(828, 2)), v.line(-24, -41, -16, -44, inkStyle(829, 2)),
        blob(v, ellipsePts(-27, -26, 4, 3, 8), { fill: "#3a1c18", seed: 830, line: 1.4 }),
      ]
      : [
        blob(v, ellipsePts(-26, -22, 14, 11, 14), { fill: "#f1e6cf", seed: 823, line: 2.2 }),
        v.triangle(-38, -26, -36, -40, -28, -30, { fill: "#f1e6cf", ...inkStyle(824, 1.8) }),
        v.triangle(-22, -30, -14, -40, -14, -26, { fill: "#f1e6cf", ...inkStyle(825, 1.8) }),
        stroke(v, [[-34, -22], [-31, -20], [-28, -22]], { seed: 826, weight: 1.6, amp: 0 }),
        stroke(v, [[-24, -22], [-21, -20], [-18, -22]], { seed: 827, weight: 1.6, amp: 0 }),
      ],
  ];
}

/** The inkwell in the top-left corner, where collected ink goes. */
function inkwell(v: View): Drawing {
  return [
    groundShadow(v, 52, 78, 30),
    blob(v, [[26, 78], [24, 54], [34, 44], [70, 44], [80, 54], [78, 78]], { fill: "#3c3a40", light: "#66646c", seed: 840, line: 2.6 }),
    v.ellipse(52, 48, 18, 5, { fill: INK }),
    v.line(44, 47, 56, 46, { stroke: "rgba(255,255,255,0.6)", weight: 1.4 }),
    // A brush resting across it.
    v.line(22, 30, 88, 50, { stroke: "#8a6a3a", weight: 4, brush: "ink", gesture: { seed: 841, pressure: "even" } }),
    v.curve([[84, 48], [94, 52], [102, 58]], false, { stroke: INK, weight: 8, brush: "ink", gesture: { seed: 842, pressure: "taper-out" } }),
  ];
}

export function paintBoard(v: View): Drawing {
  return [
    v.rect(0, 0, W, H, { fill: PAPER }),
    paperFibres(v),
    hills(v),
    lanes(v),
    framing(v),
    inkwell(v),
  ];
}

/** The scroll's roller at the right, drawn over the foes as they come out from behind it. */
export function paintRoller(v: View): Drawing {
  return [
    v.rect(ROLLER_X + 30, 0, W - ROLLER_X, H, { fill: PAPER }),
    v.group({ effects: { shadow: { x: -4, y: 0, blur: 8, color: "rgba(40,30,20,0.35)" } } }, [
      blob(v, rectPts(ROLLER_X, GY - 30, 30, H - GY + 40), { fill: "#5a3420", light: "#8a5a38", seed: 860, line: 2.4, sharp: true }),
      blob(v, rectPts(ROLLER_X - 4, GY - 44, 38, 16), { fill: "#3a2418", seed: 861, line: 2, sharp: true }),
      v.line(ROLLER_X + 8, GY - 20, ROLLER_X + 10, H, { stroke: "rgba(255,230,190,0.35)", weight: 3, brush: "chalk", gesture: { seed: 862, faint: true } }),
    ]),
    // A strip of brocade along the scroll's edge.
    v.rect(ROLLER_X - 10, GY - 30, 10, H - GY + 30, { fill: "#2f4a6a" }),
    Array.from({ length: 16 }, (_, i) => v.circle(ROLLER_X - 5, GY - 20 + i * 28, 2.4, { fill: OCHRE })),
  ];
}

export type CardState = "ready" | "poor" | "picked";

/** A paper card: the defender's portrait and its price on a red seal. */
export function paintCard(v: View, a: { seed: number; state: CardState; price: number; label: string }, portrait: Drawing): Drawing {
  const picked = a.state === "picked";
  return [
    v.group({ effects: { shadow: { x: 2, y: 3, blur: 4, color: "rgba(40,30,20,0.3)" } } }, [
      blob(v, rectPts(0, 0, CARD_W, CARD_H), { fill: picked ? "#fbe9b8" : "#f8f1de", dark: "#e8dcc0", seed: a.seed, line: picked ? 3.4 : 2, lineColour: picked ? VERMILION : INK, sharp: true, amp: 0.8 }),
    ]),
    v.clip(rectPts(3, 3, CARD_W - 6, CARD_H - 36), [portrait]),
    v.text(a.label, { x: CARD_W / 2, y: CARD_H - 29 }, { size: 12, font: "Georgia, serif", style: "italic", fill: GREY, align: "center", valign: "middle" }),
    blob(v, rectPts(CARD_W / 2 - 18, CARD_H - 21, 36, 17), { fill: VERMILION, seed: a.seed + 1, line: 0, sharp: true, amp: 0.8 }),
    v.text(String(a.price), { x: CARD_W / 2, y: CARD_H - 12 }, { size: 13, font: "Georgia, serif", style: "bold", fill: "#fbf3e2", align: "center", valign: "middle" }),
    a.state === "poor" && v.rect(0, 0, CARD_W, CARD_H, { fill: "rgba(120,110,100,0.35)" }),
  ];
}

/** The brushed ribbon behind a banner's words. */
export function paintRibbon(v: View, w: number, seed: number): Drawing {
  return [
    v.line(10, 30, w - 10, 28, { stroke: INK, weight: 56, brush: { preset: "bristle", load: 0.7, bristles: 26, spread: 0.6 }, gesture: { seed, pressure: [[0, 0.6], [0.08, 1], [0.85, 0.95], [1, 0.4]], wobble: 2 } }),
    v.line(20, 30, w - 30, 29, dryStyle(seed + 1, 40, "#2a2420", 0.9)),
  ];
}
