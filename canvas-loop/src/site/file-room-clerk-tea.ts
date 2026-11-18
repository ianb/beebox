// The bee: an upright little office clerk in a green eyeshade and sleeve
// garters. They walk on two legs, carry a card in both hands and open drawers
// with one arm. Their pronoun is "they". The head and torso, each leg pose and
// each arm pose are cached pictures drawn in ink; a frame only places them.
// Drawn facing right with their feet at (0, 0); a negative x scale turns them.
import type { Drawing, Picture, Vec2, View } from "@ianbicking/canvas-loop";
import { INK, penLine } from "./file-room-ink-tea.js";
import { type BeeState, GROUND, LOOP, TAU, lerp, smooth, stopAt } from "./file-room-layout-tea.js";

/** Scale of the clerk on the canvas: about 115 px from feet to antenna tips. */
export const S = 1;
const FUR = "#f2b52b";
const FUR_DARK = "#c98f1c";
const SHOE = "#2b1d12";
const PEN = { preset: "ink", thinning: 0.3 } as const;

const polar = (from: Vec2, arm: { len: number; angle: number }): Vec2 => [from[0] + arm.len * Math.sin(arm.angle), from[1] + arm.len * Math.cos(arm.angle)];

// ---- legs: eight walking phases, a stand and a hop ------------------------------

const HIP: Vec2 = [0, -40];

function legs(v: View, pose: number): Drawing {
  const swing = pose < 8 ? 0.55 * Math.sin((TAU * pose) / 8) : pose === 8 ? 0.1 : 0.45;
  const airborne = pose === 9;
  return [-1, 1].map((side, i) => {
    const a = swing * side;
    const knee = polar(HIP, { len: 20, angle: a });
    const foot = polar(knee, { len: 20, angle: airborne ? a * 0.2 - 0.6 * (side + 1) * 0.5 : a * 0.35 - 0.15 * (side > 0 ? 1 : 0) * Math.abs(Math.sin(a)) });
    return [
      v.curve([HIP, knee, foot], false, { stroke: i === 0 ? FUR_DARK : "#a87414", weight: 6.5, brush: PEN, gesture: { pressure: "even", wobble: 0.4, seed: 20 + i } }),
      v.ellipse(foot[0] + 5, foot[1] - 2, 9, 4.5, { fill: SHOE, stroke: INK, weight: 1.5, brush: PEN, gesture: { wobble: 0.3, seed: 24 + i } }),
    ];
  });
}

function legPicture(v: View, pose: number): Picture {
  return v.picture({ key: `clerk-legs-${pose}`, paper: { scale: 3, contrast: 0.5, seed: 2 } }, () => legs(v, pose));
}

// ---- arms ---------------------------------------------------------------------------

export type ArmPose = "rest" | "swingA" | "swingB" | "carry" | "reach";
const SHOULDER: Vec2 = [4, -74];
/** Upper-arm and forearm angles from straight down (forward is positive), near arm then far arm. */
const ARMS: Record<ArmPose, readonly [readonly [number, number], readonly [number, number]]> = {
  rest: [[0.12, 0.25], [-0.1, 0.05]],
  swingA: [[0.55, 0.95], [-0.5, -0.2]],
  swingB: [[-0.5, -0.2], [0.55, 0.95]],
  carry: [[0.5, 1.75], [0.35, 1.6]],
  reach: [[1.3, 1.45], [0.6, 1.7]],
};

function armPicture(v: View, spec: { pose: ArmPose; near: boolean }): Picture {
  const { pose, near } = spec;
  return v.picture({ key: `clerk-arm-${pose}-${near ? "near" : "far"}`, paper: { scale: 3, contrast: 0.5, seed: 3 } }, () => {
    const [upper, fore] = ARMS[pose][near ? 0 : 1];
    const elbow = polar(SHOULDER, { len: 28, angle: upper });
    const hand = polar(elbow, { len: 28, angle: fore });
    const mid = polar(SHOULDER, { len: 14, angle: upper });
    const nx = Math.cos(upper) * 4.5;
    const ny = -Math.sin(upper) * 4.5;
    return [
      v.path(v.tube([SHOULDER, elbow, hand], { width: 9, profile: [[0, 1], [1, 0.8]] }), { fill: near ? FUR : FUR_DARK, stroke: INK, weight: 2.2, brush: PEN, gesture: { pressure: "even", wobble: 0.5, seed: near ? 31 : 32 } }),
      // a striped sleeve garter on the upper arm
      v.line(mid[0] - nx, mid[1] - ny, mid[0] + nx, mid[1] + ny, { stroke: "#8a2f2f", weight: 5, brush: PEN, gesture: { pressure: "even", seed: 33 } }),
      v.circle(hand[0], hand[1], 5.5, { fill: SHOE, stroke: INK, weight: 1.4, brush: PEN, gesture: { wobble: 0.3, seed: 34 } }),
    ];
  });
}

// ---- head and torso -----------------------------------------------------------------

const TORSO: Vec2[] = [[-14, -38], [10, -37], [18, -56], [15, -78], [-1, -84], [-15, -76], [-18, -56]];
const HEAD: Vec2 = [3, -100];

function headAndTorso(v: View): Drawing {
  return [
    v.curve(TORSO, true, { fill: FUR }),
    v.clip(v.curvePath(TORSO, true), [
      [-46, -58, -70].map((y, i) => v.line(-24, y, 24, y + 1, { stroke: "#3a2511", weight: 8, brush: { preset: "bristle", load: 0.7, opacity: 0.9 }, gesture: { wobble: 0.8, seed: 40 + i } })),
    ]),
    v.curve(TORSO, true, { stroke: INK, weight: 2.6, brush: PEN, gesture: { wobble: 0.7, seed: 41 } }),
    // bow tie
    v.polygon([[2, -84], [-8, -90], [-8, -80]], { fill: "#9a2a2a", stroke: INK, weight: 1.4, brush: PEN, gesture: { seed: 42 } }),
    v.polygon([[2, -84], [12, -90], [12, -80]], { fill: "#9a2a2a", stroke: INK, weight: 1.4, brush: PEN, gesture: { seed: 43 } }),
    // head
    v.circle(HEAD[0], HEAD[1], 17, { fill: "#f6c95a" }),
    v.circle(HEAD[0], HEAD[1], 17, { stroke: INK, weight: 2.6, brush: PEN, gesture: { wobble: 0.6, seed: 44 } }),
    // two big eyes and a small smile, seen three-quarters
    [[3, -102], [14, -102]].map(([x, y], i) => [
      v.ellipse(x ?? 0, y ?? 0, 4.6, 5.8, { fill: "#fff8e6", stroke: INK, weight: 1.4, brush: PEN, gesture: { seed: 50 + i } }),
      v.circle((x ?? 0) + 1.4, (y ?? 0) + 0.6, 2.2, { fill: INK }),
    ]),
    v.path([["move", 5, -92], ["quad", 10, -88, 16, -93]], { stroke: INK, weight: 1.8, brush: PEN, gesture: { seed: 55 } }),
    v.circle(18, -94, 3, { fill: "rgba(220,90,80,0.5)" }),
    // antennae
    v.path([["move", -2, -115], ["quad", -8, -128, -14, -134]], { stroke: INK, weight: 2, brush: PEN, gesture: { seed: 56 } }),
    v.path([["move", 8, -116], ["quad", 14, -130, 22, -136]], { stroke: INK, weight: 2, brush: PEN, gesture: { seed: 57 } }),
    v.circle(-14, -134, 3, { fill: INK }),
    v.circle(22, -136, 3, { fill: INK }),
    // green eyeshade with its elastic band
    v.polygon([[-15, -111], [20, -113], [34, -106], [31, -103], [18, -106], [-15, -106]], { fill: "rgba(52,140,92,0.92)", stroke: INK, weight: 1.8, brush: PEN, gesture: { wobble: 0.4, seed: 58 } }),
    penLine(v, { a: [-17, -108], b: [-5, -108], seed: 59, weight: 2 }),
  ];
}

function torsoPicture(v: View): Picture {
  return v.picture({ key: "clerk-torso", paper: { scale: 3, contrast: 0.5, seed: 4 } }, () => headAndTorso(v));
}

/** An index card with a red rule and pencil lines. Centred on (0, 0). */
export function cardPicture(v: View): Picture {
  return v.picture({ key: "card", paper: { scale: 3, contrast: 0.5, seed: 6 } }, () => [
    v.polygon([[-20, -13], [20, -14], [21, 13], [-19, 14]], { fill: "#eadfc2" }),
    penLine(v, { a: [-20, -13], b: [20, -14], seed: 60, weight: 1.4 }),
    penLine(v, { a: [20, -14], b: [21, 13], seed: 61, weight: 1.4 }),
    penLine(v, { a: [21, 13], b: [-19, 14], seed: 62, weight: 1.4 }),
    penLine(v, { a: [-19, 14], b: [-20, -13], seed: 63, weight: 1.4 }),
    v.line(-15, -6, 15, -6, { stroke: "#c07a74", weight: 1.4, brush: { preset: "pencil", opacity: 0.9 } }),
    [0, 1, 2].map((i) => v.line(-15, 0 + i * 5.5, 15 - i * 5, 1 + i * 5.5, { stroke: "#3a4468", weight: 1.3, brush: { preset: "pencil", opacity: 0.9 }, gesture: { wobble: 0.5, seed: 64 + i } })),
  ]);
}

// ---- posing ---------------------------------------------------------------------------

const armPose = (state: BeeState): ArmPose => {
  if (state.stop < 0) {
    if (state.carrying) return "carry";
    return Math.floor(((state.walked / 56) % 1) * 2) === 0 ? "swingA" : "swingB";
  }
  const { act } = stopAt(state.stop);
  if (state.d < 25) return act === "file" ? "carry" : "rest";
  if (state.d < 200) return "reach";
  return act === "take" ? "carry" : "rest";
};

const legPose = (state: BeeState): number => {
  if (state.lift > 8) return 9;
  if (state.stop >= 0) return 8;
  return Math.floor(((state.walked / 56) % 1) * 8);
};

export interface BeeSpec {
  state: BeeState;
  frame: number;
}

/** The clerk on the ground (or hopping), with a small shadow and fluttering wings. */
export function clerk(v: View, spec: BeeSpec): Drawing {
  const { state, frame } = spec;
  if (!state.visible) return null;
  const flap = 0.5 + 0.5 * Math.sin((TAU * 600 * frame) / LOOP);
  const airborne = state.lift > 6;
  const bob = state.stop < 0 && !airborne ? 3 * Math.abs(Math.sin((TAU * state.walked) / 56)) : 0;
  const wingSpin = airborne ? flap : 0.25 + 0.1 * flap;
  const y = GROUND - state.lift - bob;
  const wing = (spin: number, far: boolean): Drawing =>
    v.at({ translate: [far ? -4 : -8, -72], rotate: -0.35 - 0.7 * spin }, v.ellipse(0, -18, 8, 21, { fill: far ? "rgba(214,230,255,0.4)" : "rgba(228,240,255,0.55)", stroke: "rgba(255,255,255,0.7)", weight: 1.3 }));
  return [
    v.ellipse(state.x, GROUND + 3, 34 - state.lift * 0.15, 6, { fill: "rgba(0,0,0,0.4)" }),
    v.at({ translate: [state.x, y], scale: [S * state.dir, S] }, [
      wing(wingSpin, true),
      v.place(armPicture(v, { pose: armPose(state), near: false }), 0, 0),
      v.place(legPicture(v, legPose(state)), 0, 0),
      wing(wingSpin * 0.8 + 0.1, false),
      v.place(torsoPicture(v), 0, 0),
      v.place(armPicture(v, { pose: armPose(state), near: true }), 0, 0),
    ]),
  ];
}

// ---- the card they carry ----------------------------------------------------------------

/** Where the carried card is (canvas coordinates), or null while it is inside a drawer. */
export function cardPlace(state: BeeState, slotHand: Vec2): Vec2 | null {
  const base = GROUND - state.lift;
  const chest: Vec2 = [state.x + state.dir * 38 * S, base - 58 * S];
  const hand: Vec2 = [state.x + state.dir * 60 * S, base - 63 * S];
  if (state.stop < 0) return state.carrying ? chest : null;
  const { d } = state;
  if (stopAt(state.stop).act === "take") {
    if (d < 75) return null;
    if (d < 200) return [lerp(slotHand[0], hand[0])(smooth((d - 75) / 50)), lerp(slotHand[1], hand[1])(smooth((d - 75) / 50))];
    const k = smooth((d - 200) / 30);
    return [lerp(hand[0], chest[0])(k), lerp(hand[1], chest[1])(k)];
  }
  if (d < 25) return chest;
  if (d < 75) return [lerp(chest[0], hand[0])(smooth((d - 25) / 50)), lerp(chest[1], hand[1])(smooth((d - 25) / 50))];
  if (d < 125) return [lerp(hand[0], slotHand[0])(smooth((d - 75) / 50)), lerp(hand[1], slotHand[1])(smooth((d - 75) / 50))];
  return null;
}
