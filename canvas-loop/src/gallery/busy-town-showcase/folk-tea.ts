// The townsfolk of Thimble Quay and their vehicles, each drawn facing right in a
// small box, in a few poses. The live layer records each pose once as a picture
// and places it wherever the folk are.
import type { Drawing, Vec2, View } from "@ianbicking/canvas-loop";
import { INK, blob, ellipsePts, ink, rectPts, shade, stroke } from "./ink-tea.js";

/** Every walker's picture is this size, feet at (FOOT_X, FOOT_Y). */
export const FOLK_W = 70;
export const FOLK_H = 104;
export const FOOT_X = 35;
export const FOOT_Y = 100;

export type Kind = "heron" | "hedgehog" | "mouse" | "mole" | "goose" | "badger" | "otter";
export type Carry = "none" | "umbrella" | "balloon";

const LINE = 1.3;

function part(v: View, pts: readonly Vec2[], fill: string, seed: number, curve = true): Drawing {
  return blob(v, pts, { fill, dark: shade(fill, -0.25), seed, line: LINE, amp: 0.5, curve });
}

/** Two legs swinging with the walk; `phase` 0..3. */
function legs(v: View, a: { hip: Vec2; len: number; phase: number; colour: string; width: number; shoe: string; seed: number; thin?: boolean }): Drawing {
  const swing = Math.sin((a.phase / 4) * Math.PI * 2) * 0.42;
  return [1, -1].map((s, k) => {
    const ang = swing * s;
    const foot: Vec2 = [a.hip[0] + Math.sin(ang) * a.len, a.hip[1] + Math.cos(ang) * a.len];
    const knee: Vec2 = [a.hip[0] + Math.sin(ang) * a.len * 0.5 + 1.5, a.hip[1] + Math.cos(ang) * a.len * 0.5];
    const col = k === 0 ? shade(a.colour, -0.2) : a.colour;
    return [
      a.thin === true
        ? v.curve([a.hip, knee, foot], false, { stroke: col, weight: a.width, brush: "ink", gesture: { seed: a.seed + k, pressure: "even" } })
        : v.path(v.tube([a.hip, knee, foot], { width: a.width }), { fill: col, ...ink(a.seed + k, LINE) }),
      part(v, ellipsePts(foot[0] + 3, foot[1] - 1.5, a.width * 0.75 + 1.5, 2.6, 10), a.shoe, a.seed + 10 + k),
    ];
  });
}

function arm(v: View, a: { shoulder: Vec2; len: number; phase: number; colour: string; width: number; seed: number; back?: boolean; reach?: number | undefined }): Drawing {
  const swing = a.reach ?? Math.sin((a.phase / 4) * Math.PI * 2) * 0.5 * (a.back === true ? 1 : -1);
  const hand: Vec2 = [a.shoulder[0] + Math.sin(swing) * a.len, a.shoulder[1] + Math.cos(swing) * a.len];
  const elbow: Vec2 = [a.shoulder[0] + Math.sin(swing) * a.len * 0.5 - 1, a.shoulder[1] + Math.cos(swing) * a.len * 0.5];
  return v.path(v.tube([a.shoulder, elbow, hand], { width: a.width, profile: [[0, 1], [1, 0.8]] }), { fill: a.back === true ? shade(a.colour, -0.2) : a.colour, ...ink(a.seed, LINE) });
}

function eye(v: View, x: number, y: number, r = 1.6): Drawing {
  return [v.circle(x, y, r, { fill: "#1c1414" }), v.circle(x + r * 0.35, y - r * 0.4, r * 0.35, { fill: "#ffffff" })];
}

function umbrellaOver(v: View, x: number, y: number, colour: string): Drawing {
  const canopy: Vec2[] = [[x - 26, y], [x - 20, y - 12], [x - 6, y - 19], [x + 8, y - 19], [x + 21, y - 12], [x + 26, y], [x + 17, y - 3], [x + 8, y], [x - 1, y - 3], [x - 9, y], [x - 18, y - 3]];
  return [
    stroke(v, [[x, y - 18], [x, y + 26], [x - 3, y + 30]], { seed: 801, weight: 1.4, amp: 0 }),
    blob(v, canopy, { fill: colour, light: shade(colour, 0.3), seed: 802, line: LINE, amp: 0.4 }),
  ];
}

const SH = "#3a2a24";

function heron(v: View, phase: number): Drawing {
  const hip: Vec2 = [FOOT_X - 2, FOOT_Y - 34];
  return [
    legs(v, { hip, len: 33, phase, colour: "#d9a04a", width: 2.2, shoe: "#c58a3a", seed: 1, thin: true }),
    // A blue postal coat over a grey body.
    part(v, [[20, 70], [22, 52], [34, 44], [46, 48], [50, 62], [44, 74], [30, 76]], "#4c6fa8", 2),
    part(v, [[44, 74], [52, 78], [48, 70]], "#9fb0c0", 3),
    // A satchel on a strap.
    stroke(v, [[38, 46], [26, 70]], { seed: 4, weight: 1.2, amp: 0 }),
    part(v, rectPts(18, 64, 14, 12), "#9b5a32", 5, false),
    v.rect(21, 67, 9, 6, { fill: "#f4e4c0" }),
    v.path([["move", 21, 67], ["line", 25.5, 70.5], ["line", 30, 67]], { stroke: "#9b5a32", weight: 0.8 }),
    // A long neck and a small head with a long beak.
    v.path(v.tube([[38, 48], [34, 34], [40, 22], [44, 16]], { width: 6, profile: [[0, 1.3], [1, 0.9]] }), { fill: "#c7d0d8", ...ink(6, LINE) }),
    part(v, ellipsePts(46, 14, 7, 5.5, 12), "#d6dde3", 7),
    v.polygon([[51, 12], [68, 16], [51, 17]], { fill: "#e3b34a", ...ink(8, 1) }),
    eye(v, 48, 12.5, 1.4),
    // A postal cap.
    part(v, [[39, 10], [41, 4], [50, 4], [52, 9]], "#2f4a7a", 9, false),
    v.rect(48, 8, 7, 2, { fill: "#2f4a7a" }),
    arm(v, { shoulder: [40, 52], len: 16, phase, colour: "#4c6fa8", width: 5, seed: 10 }),
  ];
}

function hedgehog(v: View, phase: number): Drawing {
  const hip: Vec2 = [FOOT_X, FOOT_Y - 12];
  const spines = Array.from({ length: 13 }, (_, i): Drawing => {
    const a = Math.PI * (0.55 + (i / 12) * 0.95);
    const cx = 32, cy = 70;
    return v.line(cx + Math.cos(a) * 12, cy - Math.sin(a) * 13, cx + Math.cos(a) * 22, cy - Math.sin(a) * 23, { stroke: i % 2 === 0 ? "#5a3e2a" : "#7a5a3a", weight: 4, brush: { preset: "bristle", bristles: 5, load: 0.8 }, gesture: { seed: 20 + i, pressure: "taper-out" } });
  });
  return [
    // The broom, behind.
    stroke(v, [[54, 52], [22, 98]], { seed: 21, weight: 2.2, colour: "#8a5a32", amp: 0 }),
    v.polygon([[14, 92], [28, 92], [26, 101], [12, 101]], { fill: "#d9b05a", ...ink(22, 1) }),
    legs(v, { hip, len: 11, phase, colour: "#8a6a4a", width: 5, shoe: SH, seed: 23 }),
    spines,
    part(v, ellipsePts(34, 74, 17, 15, 14), "#a7845e", 24),
    part(v, [[24, 66], [44, 64], [48, 84], [22, 86]], "#5f8f58", 25),
    part(v, [[40, 60], [48, 56], [58, 64], [52, 70], [42, 70]], "#dcc0a0", 26),
    v.circle(58, 64, 2, { fill: "#2a1a14" }),
    eye(v, 49, 61),
    arm(v, { shoulder: [42, 72], len: 10, phase, colour: "#dcc0a0", width: 4, seed: 27, reach: 1.0 }),
  ];
}

function mouse(v: View, phase: number, carry: Carry): Drawing {
  const hip: Vec2 = [FOOT_X, FOOT_Y - 12];
  return [
    stroke(v, [[26, 84], [14, 88], [8, 80], [4, 82]], { seed: 30, weight: 1.6, colour: "#c79a8a", amp: 0 }),
    legs(v, { hip, len: 11, phase, colour: "#b7aaa4", width: 3.2, shoe: "#b8423a", seed: 31 }),
    part(v, [[26, 90], [30, 70], [40, 70], [44, 90]], "#d6453c", 32),
    part(v, ellipsePts(36, 60, 11, 10, 14), "#c2b6b0", 33),
    part(v, ellipsePts(28, 49, 6.5, 6.5, 12), "#c2b6b0", 34),
    part(v, ellipsePts(41, 48, 6.5, 6.5, 12), "#c2b6b0", 35),
    v.circle(28, 49, 3.5, { fill: "#e8a8a8" }),
    v.circle(41, 48, 3.5, { fill: "#e8a8a8" }),
    v.circle(47, 62, 1.8, { fill: "#3a2020" }),
    eye(v, 41, 58),
    arm(v, { shoulder: [36, 72], len: 10, phase, colour: "#c2b6b0", width: 3, seed: 36, reach: carry === "balloon" ? Math.PI * 0.85 : undefined }),
  ];
}

function mole(v: View, phase: number): Drawing {
  const hip: Vec2 = [FOOT_X, FOOT_Y - 14];
  return [
    legs(v, { hip, len: 13, phase, colour: "#3c3440", width: 4.5, shoe: SH, seed: 40 }),
    part(v, [[20, 88], [22, 62], [34, 54], [46, 60], [50, 88]], "#e8c23a", 41),
    v.line(35, 60, 35, 88, { stroke: "#b8922a", weight: 1 }),
    part(v, ellipsePts(36, 48, 12, 11, 14), "#4a4250", 42),
    part(v, ellipsePts(50, 50, 4, 3, 10), "#f0a0b0", 43),
    v.circle(42, 45, 3.6, { stroke: "#c8a040", weight: 1.2 }),
    v.circle(42, 45, 1.2, { fill: "#1c1414" }),
    // A rolled newspaper under the arm.
    part(v, rectPts(36, 66, 18, 7), "#efeadc", 44, false),
    arm(v, { shoulder: [36, 62], len: 13, phase, colour: "#e8c23a", width: 5, seed: 45, reach: 0.9 }),
  ];
}

function goose(v: View, phase: number): Drawing {
  const hip: Vec2 = [FOOT_X - 2, FOOT_Y - 16];
  return [
    legs(v, { hip, len: 15, phase, colour: "#e89a3a", width: 2.4, shoe: "#e08a2a", seed: 50, thin: true }),
    part(v, [[14, 74], [20, 60], [36, 56], [50, 62], [52, 78], [40, 88], [24, 86]], "#f6f3ec", 51),
    // A plum shawl and a shopping basket.
    part(v, [[22, 62], [36, 56], [50, 62], [46, 72], [30, 74]], "#7a3a6a", 52),
    v.path(v.tube([[42, 60], [42, 44], [46, 30]], { width: 7 }), { fill: "#f6f3ec", ...ink(53, LINE) }),
    part(v, ellipsePts(48, 27, 7.5, 6.5, 12), "#f6f3ec", 54),
    v.polygon([[54, 25], [63, 28], [54, 31]], { fill: "#e89a3a", ...ink(55, 1) }),
    eye(v, 50, 25, 1.5),
    part(v, [[38, 22], [44, 15], [56, 16], [58, 21]], "#3f6a8a", 56),
    v.circle(53, 15, 2.5, { fill: "#e2504a" }),
    stroke(v, [[48, 66], [50, 76]], { seed: 57, weight: 1.2, amp: 0 }),
    part(v, [[42, 76], [58, 76], [55, 88], [45, 88]], "#c8954a", 58, false),
    v.circle(46, 74, 3, { fill: "#d0443a" }),
    v.circle(52, 74, 3, { fill: "#6aa04a" }),
  ];
}

function badger(v: View, phase: number): Drawing {
  const hip: Vec2 = [FOOT_X, FOOT_Y - 16];
  return [
    legs(v, { hip, len: 15, phase, colour: "#3a3a3e", width: 6, shoe: SH, seed: 60 }),
    part(v, [[16, 86], [18, 60], [34, 52], [50, 58], [52, 86]], "#8e8e96", 61),
    part(v, [[22, 86], [24, 62], [46, 62], [48, 86]], "#c94a3a", 62),
    part(v, ellipsePts(38, 46, 13, 11, 14), "#f2efe8", 63),
    v.clip(v.curvePath(ellipsePts(38, 46, 13, 11, 14), true), [v.rect(28, 34, 5, 24, { fill: "#2a2a2e" }), v.rect(41, 34, 5, 24, { fill: "#2a2a2e" })]),
    v.circle(51, 48, 2, { fill: "#1c1414" }),
    eye(v, 44, 45, 1.3),
    // A flat cap.
    part(v, [[26, 38], [30, 31], [46, 31], [54, 36]], "#4f6a3a", 64),
    arm(v, { shoulder: [36, 62], len: 14, phase, colour: "#8e8e96", width: 6, seed: 65 }),
  ];
}

function otter(v: View, phase: number): Drawing {
  const hip: Vec2 = [FOOT_X, FOOT_Y - 16];
  return [
    stroke(v, [[24, 82], [12, 92], [6, 98]], { seed: 70, weight: 4, colour: "#7a5236", amp: 0 }),
    legs(v, { hip, len: 15, phase, colour: "#7a5236", width: 4.5, shoe: SH, seed: 71 }),
    part(v, [[22, 86], [22, 58], [36, 48], [48, 58], [48, 86]], "#f6f1e6", 72),
    part(v, [[22, 86], [24, 70], [48, 70], [48, 86]], "#1e1e24", 73),
    v.polygon([[33, 52], [37, 56], [41, 52], [37, 50]], { fill: "#1e1e24" }),
    part(v, ellipsePts(38, 40, 11, 10, 14), "#8a6040", 74),
    part(v, ellipsePts(45, 44, 6, 4.5, 10), "#d8c2a6", 75),
    v.circle(50, 42, 1.8, { fill: "#1c1414" }),
    eye(v, 42, 37, 1.3),
    // A tray held high with a teapot.
    arm(v, { shoulder: [40, 58], len: 14, phase, colour: "#f6f1e6", width: 4.5, seed: 76, reach: Math.PI * 0.8 }),
    v.rect(42, 28, 22, 3, { fill: "#b8b8c0", ...ink(77, 1) }),
    part(v, ellipsePts(53, 22, 6, 5, 10), "#e8f0f6", 78),
  ];
}

export function paintFolk(v: View, kind: Kind, phase: number, carry: Carry): Drawing {
  const body = ((): Drawing => {
    switch (kind) {
      case "heron": return heron(v, phase);
      case "hedgehog": return hedgehog(v, phase);
      case "mouse": return mouse(v, phase, carry);
      case "mole": return mole(v, phase);
      case "goose": return goose(v, phase);
      case "badger": return badger(v, phase);
      case "otter": return otter(v, phase);
    }
  })();
  const tall = kind === "heron" ? 4 : kind === "goose" ? 16 : 34;
  return [
    v.ellipse(FOOT_X + 2, FOOT_Y, 16, 3, { fill: "rgba(40,30,30,0.22)" }),
    body,
    carry === "umbrella" && umbrellaOver(v, FOOT_X - 4, tall, kind === "mole" ? "#3f6aa8" : "#c9413a"),
  ];
}

// --- Specials -------------------------------------------------------------------

/** The baker, a badger in an apron, holding a tray of buns. Box 70x104. */
export function paintBaker(v: View): Drawing {
  return [
    v.ellipse(FOOT_X, FOOT_Y, 18, 3, { fill: "rgba(40,30,30,0.22)" }),
    legs(v, { hip: [FOOT_X, FOOT_Y - 16], len: 15, phase: 0, colour: "#3a3a3e", width: 6, shoe: SH, seed: 90 }),
    part(v, [[14, 88], [16, 58], [34, 50], [52, 58], [54, 88]], "#8e8e96", 91),
    part(v, [[20, 92], [22, 60], [46, 60], [48, 92]], "#fbf8f0", 92),
    part(v, ellipsePts(35, 42, 13, 11, 14), "#f2efe8", 93),
    v.clip(v.curvePath(ellipsePts(35, 42, 13, 11, 14), true), [v.rect(25, 30, 5, 24, { fill: "#2a2a2e" }), v.rect(38, 30, 5, 24, { fill: "#2a2a2e" })]),
    v.circle(44, 46, 2, { fill: "#1c1414" }),
    eye(v, 40, 41, 1.3),
    eye(v, 31, 41, 1.3),
    v.curve([[31, 49], [35, 52], [39, 49]], false, ink(94, 1)),
    // A tall white hat.
    part(v, [[23, 34], [21, 20], [27, 12], [35, 16], [43, 12], [49, 20], [47, 34]], "#ffffff", 95),
    // The tray, held out in front.
    arm(v, { shoulder: [22, 60], len: 14, phase: 0, colour: "#8e8e96", width: 6, seed: 96, reach: 1.4 }),
    arm(v, { shoulder: [46, 60], len: 14, phase: 0, colour: "#8e8e96", width: 6, seed: 97, reach: -1.4 }),
    v.rect(10, 62, 52, 4, { fill: "#a8a8b0", ...ink(98, 1) }),
    [16, 26, 36, 46, 56].map((x, i) => part(v, ellipsePts(x, 58, 5, 3.6, 10), i % 2 === 0 ? "#c98a4a" : "#e0aa5e", 99 + i)),
  ];
}

/** A cat, sitting or trotting. Box 40x36, feet at (20, 34). */
export function paintCat(v: View, pose: "sit" | "trot"): Drawing {
  const fur = "#e08a3a";
  if (pose === "sit") {
    return [
      stroke(v, [[26, 32], [34, 30], [36, 22]], { seed: 110, weight: 3, colour: fur, amp: 0 }),
      part(v, [[10, 34], [12, 20], [20, 14], [28, 20], [30, 34]], fur, 111),
      part(v, ellipsePts(20, 12, 8, 7, 12), fur, 112),
      v.triangle(13, 8, 14, 1, 19, 6, { fill: fur, ...ink(113, 1) }),
      v.triangle(21, 6, 26, 1, 27, 8, { fill: fur, ...ink(114, 1) }),
      eye(v, 17, 11, 1.1),
      eye(v, 23, 11, 1.1),
    ];
  }
  return [
    stroke(v, [[6, 18], [2, 10], [4, 4]], { seed: 115, weight: 3, colour: fur, amp: 0 }),
    [10, 14, 26, 30].map((x, i) => stroke(v, [[x, 24], [x + (i % 2 === 0 ? 3 : -2), 34]], { seed: 116 + i, weight: 2.6, colour: fur, amp: 0 })),
    part(v, ellipsePts(19, 21, 13, 6, 12), fur, 120),
    part(v, ellipsePts(33, 14, 7, 6, 12), fur, 121),
    v.triangle(29, 9, 30, 3, 34, 8, { fill: fur, ...ink(122, 1) }),
    v.triangle(35, 8, 39, 3, 39, 10, { fill: fur, ...ink(123, 1) }),
    eye(v, 36, 13, 1.1),
  ];
}

/** A pigeon. Box 30x24. */
export function paintPigeon(v: View, pose: "sit" | "up" | "down"): Drawing {
  const grey = "#8f97a6";
  const wing: readonly Vec2[] = pose === "up" ? [[12, 12], [6, 0], [18, 10]] : pose === "down" ? [[12, 12], [8, 22], [18, 14]] : [[10, 12], [20, 10], [16, 16]];
  return [
    part(v, ellipsePts(14, 14, 9, 5.5, 12), grey, 130),
    part(v, ellipsePts(22, 9, 4.5, 4, 10), "#7a8294", 131),
    v.triangle(26, 8, 30, 10, 26, 11, { fill: "#e0a040" }),
    v.circle(23, 8, 0.9, { fill: "#1c1414" }),
    v.polygon([[6, 13], [0, 11], [2, 17]], { fill: grey, ...ink(132, 1) }),
    v.polygon(wing, { fill: "#a9b0bd", ...ink(133, 1) }),
    pose === "sit" && [v.line(12, 19, 12, 22, { stroke: "#d06a6a", weight: 1.2 }), v.line(16, 19, 16, 22, { stroke: "#d06a6a", weight: 1.2 })],
  ];
}

/** A duck swimming or flapping. Box 34x26, waterline at y 18. */
export function paintDuck(v: View, pose: "swim" | "flap", drake: boolean): Drawing {
  const body = drake ? "#c8b49a" : "#b89a76";
  return [
    part(v, [[2, 14], [10, 10], [24, 12], [28, 18], [6, 20]], body, 140),
    part(v, ellipsePts(25, 8, 5, 4.5, 10), drake ? "#2f7a4a" : "#9a7a5a", 141),
    v.polygon([[29, 7], [34, 9], [29, 10]], { fill: "#e8a03a", ...ink(142, 0.8) }),
    v.circle(26, 7, 0.9, { fill: "#1c1414" }),
    pose === "flap" ? v.polygon([[12, 12], [6, 0], [20, 10]], { fill: shade(body, 0.2), ...ink(143, 1) }) : v.curve([[10, 14], [16, 12], [22, 15]], false, ink(144, 1)),
    v.line(0, 19, 32, 19, { stroke: "rgba(230,245,245,0.7)", weight: 1.5 }),
  ];
}

/** The goat on her bicycle with a basket of loaves. Box 90x80, wheels on y 76. */
export function paintCyclist(v: View, phase: number): Drawing {
  const spokes = (cx: number): Drawing => [0, 1, 2].map((k) => {
    const a = (phase / 4) * (Math.PI / 3) + (k * Math.PI) / 3;
    return v.line(cx - Math.cos(a) * 12, 64 - Math.sin(a) * 12, cx + Math.cos(a) * 12, 64 + Math.sin(a) * 12, { stroke: "#5a5a60", weight: 0.8 });
  });
  const ped = (phase / 4) * Math.PI * 2;
  const pedal: Vec2 = [44 + Math.cos(ped) * 6, 66 + Math.sin(ped) * 6];
  return [
    v.ellipse(46, 77, 36, 3, { fill: "rgba(40,30,30,0.22)" }),
    [18, 72].map((cx, i) => [v.circle(cx, 64, 13, ink(150 + i, 2.2, "#26262a")), spokes(cx)]),
    v.polygon([[18, 64], [44, 66], [64, 44], [36, 44]], { stroke: "#2f6a8a", weight: 2.4 }),
    v.line(64, 44, 72, 64, { stroke: "#2f6a8a", weight: 2.4 }),
    v.line(36, 44, 34, 38, { stroke: "#2f6a8a", weight: 2 }),
    v.line(64, 44, 66, 34, { stroke: "#2f6a8a", weight: 2 }),
    // Basket of loaves.
    blob(v, rectPts(68, 34, 18, 12), { fill: "#b88a4a", seed: 152, line: 1.2, amp: 0.5 }),
    [70, 76, 82].map((x) => v.ellipse(x + 2, 32, 3, 7, { fill: "#d9a05a", stroke: "#6b3d1e", weight: 1 })),
    // The goat: a leg on the pedal, a green jacket, horns and a beard.
    v.path(v.tube([[38, 38], [44, 52], pedal], { width: 5 }), { fill: "#e9e2d2", ...ink(153, LINE) }),
    part(v, [[28, 40], [30, 22], [42, 16], [52, 22], [50, 42]], "#4f8a5a", 154),
    part(v, ellipsePts(54, 12, 9, 7.5, 12), "#efe8d8", 155),
    v.polygon([[58, 18], [62, 26], [56, 20]], { fill: "#efe8d8", ...ink(156, 1) }),
    v.curve([[48, 6], [44, -2], [38, 0]], false, ink(157, 2.2, "#8a7a5a")),
    eye(v, 57, 10, 1.3),
    part(v, [[44, 6], [40, 2], [46, 5]], "#efe8d8", 158),
    v.path(v.tube([[46, 24], [58, 32], [66, 34]], { width: 4.5 }), { fill: "#4f8a5a", ...ink(159, LINE) }),
  ];
}

/** The tortoise pushing a cart of vegetables. Box 100x60, wheels on y 56. */
export function paintCart(v: View, phase: number): Drawing {
  const step = phase % 2 === 0 ? 0 : 2;
  return [
    v.ellipse(46, 57, 44, 3, { fill: "rgba(40,30,30,0.22)" }),
    // The cart.
    blob(v, [[46, 24], [96, 24], [92, 44], [50, 44]], { fill: "#7a9a4a", dark: "#5a7a3a", seed: 170, line: 1.4, amp: 0.4 }),
    [54, 62, 70, 78, 86].map((x, i) => v.circle(x, 21 - (i % 2) * 2, 5, { fill: ["#e2504a", "#f2a03a", "#6aa04a", "#e2504a", "#9b6fd0"][i] ?? "#e2504a", stroke: INK, weight: 0.8 })),
    v.circle(84, 50, 7, ink(171, 1.8, "#3a2a24")),
    v.circle(84, 50, 2, { fill: "#3a2a24" }),
    stroke(v, [[46, 30], [36, 34]], { seed: 172, weight: 2, amp: 0, colour: "#5a3a2a" }),
    // The tortoise.
    [12 + step, 30 - step].map((x, i) => part(v, ellipsePts(x, 52, 4, 4.5, 10), "#8aa060", 173 + i)),
    part(v, [[4, 50], [8, 34], [22, 26], [34, 32], [38, 50]], "#8a6a3a", 175),
    v.clip(v.curvePath([[4, 50], [8, 34], [22, 26], [34, 32], [38, 50]], true), [
      ([[14, 40], [26, 36], [20, 46]] as const).map(([x, y]) => v.circle(x, y, 5, { stroke: "#5a4220", weight: 1.4 })),
    ]),
    v.path(v.tube([[30, 38], [36, 32], [40, 28]], { width: 6 }), { fill: "#9ab070", ...ink(176, LINE) }),
    part(v, ellipsePts(42, 26, 6.5, 5.5, 10), "#9ab070", 177),
    eye(v, 45, 24, 1.2),
    v.path(v.tube([[32, 40], [40, 34], [44, 32]], { width: 3.5 }), { fill: "#9ab070", ...ink(178, LINE) }),
  ];
}

/** The frog rowing his boat. Box 120x60, waterline at y 44. */
export function paintBoat(v: View, pose: number): Drawing {
  const oar = pose === 0 ? 0.5 : -0.4;
  return [
    // The frog.
    part(v, [[44, 32], [46, 16], [58, 12], [66, 18], [66, 32]], "#6aa04a", 180),
    part(v, ellipsePts(58, 10, 10, 7, 12), "#7ab85a", 181),
    v.circle(53, 4, 4, { fill: "#7ab85a", ...ink(182, 1) }),
    v.circle(63, 4, 4, { fill: "#7ab85a", ...ink(183, 1) }),
    eye(v, 54, 4, 1.5),
    eye(v, 64, 4, 1.5),
    v.curve([[54, 13], [59, 15], [64, 13]], false, ink(184, 1)),
    part(v, [[48, 18], [58, 16], [68, 20], [58, 24]], "#e8c23a", 185),
    v.line(56 + Math.sin(oar) * 22, 22 - 6, 56 - Math.sin(oar) * 30, 50, { stroke: "#8a5a32", weight: 2.4 }),
    // The boat.
    blob(v, [[4, 28], [116, 26], [104, 46], [18, 46]], { fill: "#b8503a", light: "#d8704a", seed: 186, line: 1.8, amp: 0.6 }),
    v.line(10, 32, 112, 31, { stroke: "#f2e4c4", weight: 2.5 }),
    v.text("Lily", { x: 84, y: 39 }, { size: 8, font: "Georgia, serif", style: "italic", fill: "#f2e4c4", align: "center", valign: "middle" }),
  ];
}

/** The tram: cream and green, with riders at the windows. Box 214x74 (layout's TRAM_W x TRAM_H), wheels on y 72. */
export function paintTram(v: View, lit: boolean): Drawing {
  const glass = lit ? "#f6d488" : "#3a4a62";
  const riders = [44, 78, 112, 146];
  return [
    v.ellipse(107, 72, 100, 4, { fill: "rgba(40,30,30,0.3)" }),
    blob(v, [[8, 66], [6, 22], [14, 12], [200, 12], [208, 22], [206, 66]], { fill: "#efe2c2", light: "#fbf3df", dark: "#d4c39c", seed: 190, line: 2 }),
    blob(v, rectPts(6, 46, 202, 20), { fill: "#3f7a5a", light: "#5a9a74", seed: 191, line: 1.8, amp: 0.6 }),
    blob(v, [[14, 12], [30, 4], [184, 4], [200, 12]], { fill: "#3f7a5a", seed: 192, line: 1.8, amp: 0.6 }),
    [28, 62, 96, 130, 164].map((x, i) => blob(v, rectPts(x, 18, 26, 22), { fill: glass, seed: 193 + i, line: 1.4, amp: 0.5 })),
    riders.map((x, i) => [
      v.circle(x + 6, 32, 6, { fill: lit ? "#6a4a3a" : ["#c2b6b0", "#8e8e96", "#f6f3ec", "#e8c23a"][i] ?? "#888" }),
      v.rect(x, 36, 12, 6, { fill: lit ? "#6a4a3a" : "#7a3a6a" }),
    ]),
    blob(v, rectPts(186, 18, 14, 40), { fill: "#2f5a44", seed: 198, line: 1.4, amp: 0.5 }),
    v.text("7  QUAYSIDE", { x: 100, y: 55.5 }, { size: 10, font: "Georgia, serif", style: "bold", fill: "#f6ecd0", align: "center", valign: "middle" }),
    v.circle(204, 30, 3.4, { fill: lit ? "#fff2b0" : "#e8e0c0", stroke: INK, weight: 1 }),
    [36, 60, 154, 178].map((x) => [v.circle(x, 68, 6, { fill: "#2f3438" }), v.circle(x, 68, 2, { fill: "#8a8a90" })]),
    // The pole up to the wire.
    stroke(v, [[100, 4], [124, -62]], { seed: 199, weight: 2, amp: 0 }),
  ];
}
