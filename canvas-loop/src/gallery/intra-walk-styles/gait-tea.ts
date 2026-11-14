// A body moved by motion capture (clips-tea.ts): segment angles from a real take,
// body proportions from anthropometry, feet planted by rolling the body over the
// lowest point of a foot, and flight (in a run) added from the take.
//
// Gaits blend: every clip's curves line up at the same phase, so a mix of two
// clips' coefficients is a walk in between (60% sad, 40% normal).
import { CLIPS } from "./clips-tea.js";
import type { Clip, ClipName } from "./clips-tea.js";

export type Vec = readonly [number, number];

const H = 1.65;
export const BODY = {
  height: H,
  thigh: 0.245 * H,
  shank: 0.246 * H,
  ankleHigh: 0.039 * H,
  heelBack: 0.045,
  ball: 0.15,
  toe: 0.2,
  torso: (0.818 - 0.53) * H,
  upperArm: 0.186 * H,
  forearm: 0.146 * H,
  hand: 0.08,
  neck: 0.06,
  head: 0.13 * H,
};

/** Clip weights, e.g. [["sad", 0.6], ["normal", 0.4]]. */
export type Gait = readonly (readonly [ClipName, number])[];

type Channel = Exclude<keyof Clip, "take" | "cadence">;

function fourier(c: readonly number[], p: number): number {
  let y = c[0] ?? 0;
  for (let k = 1; 2 * k < c.length; k++) {
    const w = 2 * Math.PI * k * p;
    y += (c[2 * k - 1] ?? 0) * Math.cos(w) + (c[2 * k] ?? 0) * Math.sin(w);
  }
  return y;
}
function value(g: Gait, ch: Channel, p: number): number {
  let y = 0, total = 0;
  for (const [name, w] of g) {
    y += fourier(CLIPS[name][ch], p) * w;
    total += w;
  }
  return y / (total || 1);
}
export function cadence(g: Gait): number {
  let y = 0, total = 0;
  for (const [name, w] of g) {
    y += CLIPS[name].cadence * w;
    total += w;
  }
  return y / (total || 1);
}

const RAD = Math.PI / 180;
const HEAD_NEUTRAL = CLIPS.normal.head[0] ?? 0;
/** The foot angle at which the sole lies flat: the normal walk at mid-stance. */
const FLAT = fourier(CLIPS.normal.footL, 0.3);
const down = (a: number): Vec => [Math.sin(a), -Math.cos(a)];

export interface Leg {
  hip: Vec;
  knee: Vec;
  ankle: Vec;
  heel: Vec;
  ball: Vec;
  toe: Vec;
}
export interface Arm {
  shoulder: Vec;
  elbow: Vec;
  wrist: Vec;
  hand: Vec;
}
export interface Pose {
  near: Leg;
  far: Leg;
  nearArm: Arm;
  farArm: Arm;
  pelvis: Vec;
  /** Trunk lean (radians, forward +) and the point between the shoulders. */
  lean: number;
  shoulder: Vec;
  neck: Vec;
  head: Vec;
  /** Head tilt in radians, positive looks down. */
  nod: number;
}

function leg(g: Gait, p: number, side: "L" | "R"): Leg {
  const tt = value(g, side === "L" ? "thighL" : "thighR", p) * RAD;
  const ts = value(g, side === "L" ? "shankL" : "shankR", p) * RAD;
  const f = (value(g, side === "L" ? "footL" : "footR", p) - FLAT) * RAD;
  const kd = down(tt), sd = down(ts);
  const knee: Vec = [BODY.thigh * kd[0], BODY.thigh * kd[1]];
  const ankle: Vec = [knee[0] + BODY.shank * sd[0], knee[1] + BODY.shank * sd[1]];
  const dir: Vec = [Math.cos(f), Math.sin(f)];
  const dn: Vec = [Math.sin(f), -Math.cos(f)];
  const sole = (d: number): Vec => [ankle[0] + dn[0] * BODY.ankleHigh + dir[0] * d, ankle[1] + dn[1] * BODY.ankleHigh + dir[1] * d];
  const ball = sole(BODY.ball);
  const toeLen = BODY.toe - BODY.ball;
  // Toes bend at the ball: when the heel is up they stay along the floor.
  const toe: Vec = dir[1] < 0 ? [ball[0] + toeLen * Math.max(0.3, Math.cos(f * 0.4)), ball[1] + toeLen * Math.sin(f * 0.4)] : [ball[0] + dir[0] * toeLen, ball[1] + dir[1] * toeLen];
  return { hip: [0, 0], knee, ankle, heel: sole(-BODY.heelBack), ball, toe };
}

function arm(g: Gait, p: number, side: "L" | "R", shoulder: Vec): Arm {
  const a = value(g, side === "L" ? "armL" : "armR", p) * RAD;
  const f = value(g, side === "L" ? "foreL" : "foreR", p) * RAD;
  const ad = down(a), fd = down(f);
  const elbow: Vec = [shoulder[0] + BODY.upperArm * ad[0], shoulder[1] + BODY.upperArm * ad[1]];
  const wrist: Vec = [elbow[0] + BODY.forearm * fd[0], elbow[1] + BODY.forearm * fd[1]];
  const hand: Vec = [wrist[0] + BODY.hand * fd[0], wrist[1] + BODY.hand * fd[1]];
  return { shoulder, elbow, wrist, hand };
}

type Raw = Omit<Pose, "pelvis">;
function raw(g: Gait, p: number): Raw {
  const lean = value(g, "trunk", p) * RAD;
  const shoulder: Vec = [BODY.torso * Math.sin(lean), BODY.torso * Math.cos(lean)];
  const neck: Vec = [shoulder[0] + BODY.neck * Math.sin(lean * 1.3), shoulder[1] + BODY.neck * Math.cos(lean * 1.3)];
  const nod = (value(g, "head", p) - HEAD_NEUTRAL) * RAD;
  const r = BODY.head * 0.45;
  const head: Vec = [neck[0] + r * Math.sin(nod * 0.6) + 0.03, neck[1] + r * Math.cos(nod * 0.6)];
  return { near: leg(g, p, "L"), far: leg(g, p, "R"), nearArm: arm(g, p, "L", shoulder), farArm: arm(g, p, "R", shoulder), lean, shoulder, neck, head, nod };
}

const contacts = (o: Raw): Vec[] => [o.near.heel, o.near.ball, o.far.heel, o.far.ball];

/** The planted point: the lowest one that is moving back (a foot sliding forward
 * along the floor, as a dragged bad leg does, is not carrying the body). */
function planted(cs: readonly Vec[], was: readonly Vec[]): { at: number; lo: number } {
  let lo = Infinity;
  for (const c of cs) lo = Math.min(lo, c[1]);
  let at = -1;
  for (const [j, c] of cs.entries()) {
    const back = c[0] <= (was[j]?.[0] ?? 0) + 1e-6;
    if (back && c[1] < lo + 0.015 && (at < 0 || c[1] < (cs[at]?.[1] ?? 0))) at = j;
  }
  if (at < 0) at = cs.findIndex((c) => c[1] === lo);
  return { at, lo };
}

interface Table {
  lift: number[];
  travel: number[];
  stride: number;
}
const N = 240;
const tables = new Map<string, Table>();
const key = (g: Gait): string => g.map(([n, w]) => `${n}:${w}`).join(",");

/** Roll the body over the lowest point of either foot (no skating); when the take
 * says both feet are off the floor, rise by that much and coast. */
function table(g: Gait): Table {
  const hit = tables.get(key(g));
  if (hit) return hit;
  const lift: number[] = [], travel: number[] = [];
  let x = 0, v = 0;
  let prev = raw(g, 0);
  for (let i = 0; i <= N; i++) {
    const o = raw(g, i / N);
    const cs = contacts(o);
    const was = contacts(prev);
    const { at, lo } = planted(cs, i === 0 ? cs : was);
    const air = Math.max(0, value(g, "air", i / N) - 0.02);
    if (i > 0) {
      if (air > 0.004) x += v;
      else {
        v = (was[at]?.[0] ?? 0) - (cs[at]?.[0] ?? 0);
        x += v;
      }
    }
    lift.push(-lo + air);
    travel.push(x);
    prev = o;
  }
  // Close the loop: spread any jump in lift over the stride.
  const gap = (lift[N] ?? 0) - (lift[0] ?? 0);
  for (let i = 0; i <= N; i++) lift[i] = (lift[i] ?? 0) - (gap * i) / N;
  const t = { lift, travel, stride: x };
  tables.set(key(g), t);
  return t;
}

function sample(a: readonly number[], p: number): number {
  const f = p * N, i = Math.floor(f), k = f - i;
  return (a[i] ?? 0) * (1 - k) + (a[i + 1] ?? 0) * k;
}

export function strideLength(g: Gait): number {
  return table(g).stride;
}

/** Metres walked after `sec` seconds, and the stride phase there. */
export function progress(g: Gait, sec: number): { x: number; phase: number } {
  const strides = sec * cadence(g);
  const c = Math.floor(strides), p = strides - c;
  const tb = table(g);
  return { x: c * tb.stride + sample(tb.travel, p), phase: p };
}

/** The whole body at stride phase p, feet on y = 0, pelvis above x = 0. */
export function pose(g: Gait, p: number): Pose {
  const q = ((p % 1) + 1) % 1;
  const o = raw(g, q);
  const up = sample(table(g).lift, q);
  const L = (v: Vec): Vec => [v[0], v[1] + up];
  const leg2 = (l: Leg): Leg => ({ hip: L(l.hip), knee: L(l.knee), ankle: L(l.ankle), heel: L(l.heel), ball: L(l.ball), toe: L(l.toe) });
  const arm2 = (a: Arm): Arm => ({ shoulder: L(a.shoulder), elbow: L(a.elbow), wrist: L(a.wrist), hand: L(a.hand) });
  return { near: leg2(o.near), far: leg2(o.far), nearArm: arm2(o.nearArm), farArm: arm2(o.farArm), pelvis: [0, up], lean: o.lean, shoulder: L(o.shoulder), neck: L(o.neck), head: L(o.head), nod: o.nod };
}
