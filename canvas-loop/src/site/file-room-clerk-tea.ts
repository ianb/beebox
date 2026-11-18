// The bee: an upright little office clerk in a striped jumper, green eyeshade,
// bow tie and sleeve garters. They walk on two legs with knees that bend and
// feet that plant, climb ladders, stand on accordion stilts and hold things in
// two arms with elbows. Their pronoun is "they". Parts are cached pictures
// drawn in ink (head and torso, each leg pose, each arm pose to a tenth of a
// radian); a frame only places them. Drawn facing right with their feet at
// (0, 0); a negative x scale turns them, squashing through a few steps.
import type { Drawing, Picture, Vec2, View } from "@ianbicking/canvas-loop";
import { type Act, holdOffset } from "./file-room-act-tea.js";
import { INK, penLine } from "./file-room-ink-tea.js";
import { S, smooth } from "./file-room-layout-tea.js";
import { type BeeState, LOOP, TAU } from "./file-room-path-tea.js";

const FUR = "#f2b52b";
const FUR_DARK = "#c98f1c";
const BAND = "#2c1a0b";
const SHOE = "#2b1d12";
const PEN = { preset: "ink", thinning: 0.3 } as const;
const ARM = 34;
const SHOULDER: Vec2 = [4, -74];
/** Walking distance, in pixels, of one full step cycle. */
const STRIDE = 60 * S;
const LEG = 20;
const CARD_SCALE = 0.55;

const polar = (from: Vec2, arm: { len: number; angle: number }): Vec2 => [from[0] + arm.len * Math.sin(arm.angle), from[1] + arm.len * Math.cos(arm.angle)];

// ---- legs: two segments with a knee, in old-size units -----------------------------------

type LegPose = number | "stand" | "air" | "crouch" | "climbA" | "climbB";
interface Feet {
  hip: Vec2;
  a: Vec2;
  b: Vec2;
}
const WALK_PHASES = 12;
const REACH = 15;

/** Where a foot is at phase p of a step: planted and sliding back, then lifted and swung forward. */
function walkFoot(p: number): Vec2 {
  const q = ((p % 1) + 1) % 1;
  if (q < 0.5) return [REACH - (q / 0.5) * 2 * REACH, 0];
  const s = (q - 0.5) / 0.5;
  return [-REACH + 2 * REACH * smooth(s), -10 * Math.sin(Math.PI * s)];
}

function feetFor(pose: LegPose): Feet {
  if (typeof pose === "number") return { hip: [0, -37], a: walkFoot(pose / WALK_PHASES), b: walkFoot(pose / WALK_PHASES + 0.5) };
  switch (pose) {
    case "stand":
      return { hip: [0, -37], a: [-4, 0], b: [8, 0] };
    case "crouch":
      return { hip: [0, -24], a: [-9, 0], b: [11, 0] };
    case "air":
      return { hip: [0, -37], a: [-8, -9], b: [6, -13] };
    case "climbA":
      return { hip: [0, -37], a: [9, -22], b: [4, 0] };
    case "climbB":
      return { hip: [0, -37], a: [9, 0], b: [4, -22] };
  }
}

/** A knee for a two-segment leg from hip to foot, bending forward. */
function knee(hip: Vec2, foot: Vec2): Vec2 {
  const dx = foot[0] - hip[0];
  const dy = foot[1] - hip[1];
  const d = Math.min(Math.hypot(dx, dy), 2 * LEG - 0.5);
  const h = Math.sqrt(LEG * LEG - (d / 2) * (d / 2));
  const ux = dx / (Math.hypot(dx, dy) || 1);
  const uy = dy / (Math.hypot(dx, dy) || 1);
  return [hip[0] + ux * (d / 2) + uy * h, hip[1] + uy * (d / 2) - ux * h];
}

function legPicture(v: View, pose: LegPose): Picture {
  return v.picture({ key: `clerk-legs-${pose}`, paper: { scale: 3, contrast: 0.5, seed: 2 } }, () => {
    const { hip, a, b } = feetFor(pose);
    return [a, b].map((foot, i) => [
      v.curve([hip, knee(hip, foot), foot], false, { stroke: i === 0 ? "#8a5a12" : "#6e480e", weight: 5, brush: PEN, gesture: { pressure: "even", wobble: 0.4, seed: 20 + i } }),
      v.ellipse(foot[0] + 5, foot[1] - 2, 9, 4.5, { fill: SHOE, stroke: INK, weight: 1.5, brush: PEN, gesture: { wobble: 0.3, seed: 24 + i } }),
    ]);
  });
}

// ---- arms: two segments with an elbow ------------------------------------------------------

const STEP = 0.1;
const quant = (a: number): number => Math.round(a / STEP);
type Angles = readonly [number, number];

/** Upper-arm and forearm angles (from straight down, forward positive) that put the hand at `local`, elbow down. */
function reachAngles(local: Vec2): Angles {
  const vx = local[0] - SHOULDER[0];
  const vy = local[1] - SHOULDER[1];
  const d = Math.min(Math.max(Math.hypot(vx, vy), 6), 2 * ARM - 0.5);
  const a0 = Math.atan2(vx, vy);
  const alpha = Math.acos(d / (2 * ARM));
  return [a0 - alpha, a0 + alpha];
}

/** The hand's position (old-size units) for quantized arm angles. */
function handOf(angles: Angles): Vec2 {
  const e = polar(SHOULDER, { len: ARM, angle: quant(angles[0]) * STEP });
  return polar(e, { len: ARM, angle: quant(angles[1]) * STEP });
}

function armPicture(v: View, spec: { angles: Angles; near: boolean }): Picture {
  const [ui, fi] = [quant(spec.angles[0]), quant(spec.angles[1])];
  return v.picture({ key: `clerk-arm-${spec.near ? "n" : "f"}-${ui}-${fi}`, paper: { scale: 3, contrast: 0.5, seed: 3 } }, () => {
    const elbow = polar(SHOULDER, { len: ARM, angle: ui * STEP });
    const hand = polar(elbow, { len: ARM, angle: fi * STEP });
    const mid = polar(SHOULDER, { len: 14, angle: ui * STEP });
    const nx = Math.cos(ui * STEP) * 4.5;
    const ny = -Math.sin(ui * STEP) * 4.5;
    return [
      v.path(v.tube([SHOULDER, elbow, hand], { width: 9, profile: [[0, 1], [1, 0.8]] }), { fill: spec.near ? FUR : FUR_DARK, stroke: INK, weight: 2.2, brush: PEN, gesture: { pressure: "even", wobble: 0.5, seed: spec.near ? 31 : 32 } }),
      v.line(mid[0] - nx, mid[1] - ny, mid[0] + nx, mid[1] + ny, { stroke: "#8a2f2f", weight: 5, brush: PEN, gesture: { pressure: "even", seed: 33, faint: true } }),
      v.circle(hand[0], hand[1], 5.5, { fill: SHOE, stroke: INK, weight: 1.4, brush: PEN, gesture: { wobble: 0.3, seed: 34 } }),
    ];
  });
}

// ---- head and striped torso ------------------------------------------------------------------

const TORSO: Vec2[] = [[-14, -38], [10, -37], [18, -56], [15, -78], [-1, -84], [-15, -76], [-18, -56]];
const HEAD: Vec2 = [3, -100];

function headAndTorso(v: View): Drawing {
  return [
    v.curve(TORSO, true, { fill: FUR }),
    // a striped jumper: three dark bands across the body
    v.clip(v.curvePath(TORSO, true), [-42, -55, -68].map((y, i) => v.polygon([[-24, y - 5 + i], [24, y - 5.5], [24, y + 5], [-24, y + 5.5 - i]], { fill: BAND }))),
    v.curve(TORSO, true, { stroke: INK, weight: 2.6, brush: PEN, gesture: { wobble: 0.7, seed: 41 } }),
    v.polygon([[2, -84], [-8, -90], [-8, -80]], { fill: "#9a2a2a", stroke: INK, weight: 1.4, brush: PEN, gesture: { seed: 42, faint: true } }),
    v.polygon([[2, -84], [12, -90], [12, -80]], { fill: "#9a2a2a", stroke: INK, weight: 1.4, brush: PEN, gesture: { seed: 43, faint: true } }),
    v.circle(HEAD[0], HEAD[1], 17, { fill: "#f6c95a" }),
    v.circle(HEAD[0], HEAD[1], 17, { stroke: INK, weight: 2.6, brush: PEN, gesture: { wobble: 0.6, seed: 44 } }),
    [[3, -102], [14, -102]].map(([x, y], i) => [
      v.ellipse(x ?? 0, y ?? 0, 4.6, 5.8, { fill: "#fff8e6", stroke: INK, weight: 1.4, brush: PEN, gesture: { seed: 50 + i } }),
      v.circle((x ?? 0) + 1.4, (y ?? 0) + 0.6, 2.2, { fill: INK }),
    ]),
    v.path([["move", 5, -92], ["quad", 10, -88, 16, -93]], { stroke: INK, weight: 1.8, brush: PEN, gesture: { seed: 55 } }),
    v.circle(18, -94, 3, { fill: "rgba(220,90,80,0.5)" }),
    v.path([["move", -2, -115], ["quad", -8, -128, -14, -134]], { stroke: INK, weight: 2, brush: PEN, gesture: { seed: 56 } }),
    v.path([["move", 8, -116], ["quad", 14, -130, 22, -136]], { stroke: INK, weight: 2, brush: PEN, gesture: { seed: 57 } }),
    v.circle(-14, -134, 3, { fill: INK }),
    v.circle(22, -136, 3, { fill: INK }),
    v.polygon([[-15, -111], [20, -113], [34, -106], [31, -103], [18, -106], [-15, -106]], { fill: "rgba(52,140,92,0.92)", stroke: INK, weight: 1.8, brush: PEN, gesture: { wobble: 0.4, seed: 58 } }),
    penLine(v, { a: [-17, -108], b: [-5, -108], seed: 59, weight: 2 }),
  ];
}

const torsoPicture = (v: View): Picture => v.picture({ key: "clerk-torso", paper: { scale: 3, contrast: 0.5, seed: 4 } }, () => headAndTorso(v));

const CARD_EDGES: readonly (readonly [Vec2, Vec2])[] = [[[-20, -13], [20, -14]], [[20, -14], [21, 13]], [[21, 13], [-19, 14]], [[-19, 14], [-20, -13]]];

/** An index card with a red rule and pencil lines. Centred on (0, 0). */
export function cardPicture(v: View): Picture {
  return v.picture({ key: "card", paper: { scale: 3, contrast: 0.5, seed: 6 } }, () => [
    v.polygon([[-20, -13], [20, -14], [21, 13], [-19, 14]], { fill: "#eadfc2" }),
    CARD_EDGES.map(([a, b], i) => penLine(v, { a, b, seed: 60 + i, weight: 1.4 })),
    v.line(-15, -6, 15, -6, { stroke: "#c07a74", weight: 1.4, brush: { preset: "pencil", opacity: 0.9 }, gesture: { faint: true } }),
    [0, 1, 2].map((i) => v.line(-15, i * 5.5, 15 - i * 5, 1 + i * 5.5, { stroke: "#3a4468", weight: 1.3, brush: { preset: "pencil", opacity: 0.9 }, gesture: { wobble: 0.5, seed: 64 + i, faint: true } })),
  ]);
}

/** An accordion stilt `height` pixels tall: crossed scissor bars between a foot plate and a shoe plate. Bottom centre at (0, 0). */
function stiltPicture(v: View, height: number): Picture {
  return v.picture({ key: `stilt-${height}`, paper: { scale: 3, contrast: 0.5, seed: 7 } }, () => {
    const n = Math.max(1, Math.round(height / 13));
    const h = height / n;
    return [
      Array.from({ length: n }, (_, i) => {
        const y0 = -i * h;
        const y1 = -(i + 1) * h;
        return [penLine(v, { a: [-4.5, y0], b: [4.5, y1], seed: 120 + i, weight: 1.8 }), penLine(v, { a: [4.5, y0], b: [-4.5, y1], seed: 140 + i, weight: 1.8 }), v.circle(0, (y0 + y1) / 2, 1.6, { fill: BAND })];
      }),
      penLine(v, { a: [-7, 0], b: [7, 0], seed: 160, weight: 2.6 }),
      penLine(v, { a: [-7, -height], b: [7, -height], seed: 161, weight: 2.6 }),
    ];
  });
}

// ---- posing ---------------------------------------------------------------------------------------

export interface ClerkSpec {
  state: BeeState;
  act: Act;
  frame: number;
}

/** The squash steps a turning body passes through, so each stays a cached picture version. */
const TURN_STEPS = [-1, -0.5, -0.15, 0.15, 0.5, 1] as const;
const squash = (turn: number): number => TURN_STEPS.reduce((best, s) => (Math.abs(s - turn) < Math.abs(best - turn) ? s : best), 1);

function legPose(spec: ClerkSpec): LegPose {
  const { state, act } = spec;
  if (act.crouch > 1) return "crouch";
  if (state.kind === "climb") return ((state.walked / 30) % 1) * 2 < 1 ? "climbA" : "climbB";
  if (act.lift > 2) return act.stilts ? "stand" : "air";
  if (state.kind === "walk" && state.stall < 0) return Math.floor(((state.walked / STRIDE) % 1) * WALK_PHASES);
  return "stand";
}

/** Arm angles for a hand target, or a swing or climbing motion when there is none. */
function armAngles(spec: ClerkSpec & { near: boolean; origin: Vec2 }): Angles {
  const { state, act, near, origin } = spec;
  const target = near ? act.near : act.far;
  if (target !== null) return reachAngles([((target[0] - origin[0]) * state.dir) / S, (target[1] - origin[1]) / S]);
  const th = TAU * ((state.walked / STRIDE) % 1) + (near ? Math.PI : 0);
  if (state.kind === "climb") {
    const c = TAU * ((state.walked / 30) % 1) + (near ? 0 : Math.PI);
    return [2.5 + 0.4 * Math.sin(c), 2.8 + 0.4 * Math.sin(c)];
  }
  if (state.kind === "walk") return [0.5 * Math.sin(th), 0.5 * Math.sin(th) + 0.3 + 0.25 * Math.max(0, Math.sin(th))];
  return near ? [0.12, 0.25] : [-0.1, 0.05];
}

function wing(v: View, spec: { spin: number; far: boolean }): Drawing {
  return v.at({ translate: [spec.far ? -4 : -8, -72], rotate: -0.35 - 0.7 * spec.spin }, v.ellipse(0, -18, 8, 21, { fill: spec.far ? "rgba(214,230,255,0.4)" : "rgba(228,240,255,0.55)", stroke: "rgba(255,255,255,0.7)", weight: 1.3 }));
}

/** The clerk: shadow, stilts, then the body parts in order. */
export function clerk(v: View, spec: ClerkSpec): Drawing {
  const { state, act, frame } = spec;
  if (!state.visible) return null;
  const by = state.y - act.lift;
  const origin: Vec2 = [state.x, by + act.crouch];
  const flap = 0.5 + 0.5 * Math.sin((TAU * 600 * frame) / LOOP);
  const airborne = act.lift > 4 && !act.stilts;
  const spin = airborne ? flap : 0.2 + 0.1 * flap;
  const bob = state.kind === "walk" && state.stall < 0 ? 1.6 * Math.abs(Math.sin((TAU * state.walked) / STRIDE)) : 0;
  const near = armAngles({ ...spec, near: true, origin });
  const far = armAngles({ ...spec, near: false, origin });
  const sx = squash(state.turn);
  const hand = handOf(near);
  const handAt: Vec2 = [state.x + state.dir * S * hand[0], origin[1] + S * hand[1]];
  const card = act.card;
  const cardAt: Vec2 = card === null ? [0, 0] : card.mode === "hand" ? [handAt[0] + holdOffset(state.dir)[0], handAt[1] + holdOffset(state.dir)[1]] : [card.x, card.y];
  const stiltH = act.stilts ? Math.round(act.lift / 6) * 6 : 0;
  return [
    v.ellipse(state.x, state.y + 3, 24 - act.lift * 0.08, 4.5, { fill: "rgba(0,0,0,0.4)" }),
    stiltH > 5 && [-3, 5].map((off) => v.place(stiltPicture(v, stiltH), state.x + state.dir * off, state.y)),
    v.at({ translate: [state.x, by - bob], scale: [S * sx, S] }, v.place(legPicture(v, legPose(spec)), 0, 0)),
    v.at({ translate: [state.x, by + act.crouch - bob], scale: [S * sx, S] }, [
      wing(v, { spin, far: true }),
      v.place(armPicture(v, { angles: far, near: false }), 0, 0),
      wing(v, { spin: spin * 0.8 + 0.1, far: false }),
      v.place(torsoPicture(v), 0, 0),
      v.place(armPicture(v, { angles: near, near: true }), 0, 0),
    ]),
    card !== null && v.at({ translate: cardAt, rotate: Math.round(card.rot / 0.3) * 0.3, scale: [CARD_SCALE * (Math.round(card.sx * 2.5) / 2.5), CARD_SCALE] }, v.place(cardPicture(v), 0, 0)),
    act.mark !== null && v.text("!", { x: act.mark[0] + 8, y: act.mark[1] }, { size: 26, font: "Georgia, serif", style: "bold", fill: "#f4e7b8", halo: "#2a1d14", align: "center", valign: "middle" }),
  ];
}
