// A body moved by motion capture (clips-tea.ts): segment angles from a real take,
// body proportions from anthropometry, feet planted by rolling the body over the
// lowest point of a foot, and flight (in a run) added from the take.
//
// Gaits blend: every clip's curves line up at the same phase, so a mix of two
// clips' coefficients is a walk in between (60% sad, 40% normal).
import { CLIPS } from "./clips-tea.js";
import type { Clip, ClipName } from "./clips-tea.js";
import { REFERENCE } from "./body-tea.js";
import type { Build } from "./body-tea.js";

export type Vec = readonly [number, number];

export type { Build };

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
export function cadence(g: Gait, b: Build = REFERENCE): number {
  let y = 0, total = 0;
  for (const [name, w] of g) {
    y += CLIPS[name].cadence * w;
    total += w;
  }
  return (y / (total || 1)) * b.pace;
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

function leg(g: Gait, p: number, side: "L" | "R", b: Build): Leg {
  const tt = value(g, side === "L" ? "thighL" : "thighR", p) * RAD;
  const ts = value(g, side === "L" ? "shankL" : "shankR", p) * RAD;
  const f = (value(g, side === "L" ? "footL" : "footR", p) - FLAT) * RAD;
  const kd = down(tt), sd = down(ts);
  const knee: Vec = [b.thigh * kd[0], b.thigh * kd[1]];
  const ankle: Vec = [knee[0] + b.shank * sd[0], knee[1] + b.shank * sd[1]];
  const dir: Vec = [Math.cos(f), Math.sin(f)];
  const dn: Vec = [Math.sin(f), -Math.cos(f)];
  const sole = (d: number): Vec => [ankle[0] + dn[0] * b.ankleHigh + dir[0] * d, ankle[1] + dn[1] * b.ankleHigh + dir[1] * d];
  const ball = sole(b.ball);
  const toeLen = b.toe - b.ball;
  // Toes bend at the ball: when the heel is up they stay along the floor.
  const toe: Vec = dir[1] < 0 ? [ball[0] + toeLen * Math.max(0.3, Math.cos(f * 0.4)), ball[1] + toeLen * Math.sin(f * 0.4)] : [ball[0] + dir[0] * toeLen, ball[1] + dir[1] * toeLen];
  return { hip: [0, 0], knee, ankle, heel: sole(-b.heelBack), ball, toe };
}

function arm(g: Gait, p: number, side: "L" | "R", shoulder: Vec, b: Build): Arm {
  const a = value(g, side === "L" ? "armL" : "armR", p) * RAD;
  const f = value(g, side === "L" ? "foreL" : "foreR", p) * RAD;
  const ad = down(a), fd = down(f);
  const elbow: Vec = [shoulder[0] + b.upperArm * ad[0], shoulder[1] + b.upperArm * ad[1]];
  const wrist: Vec = [elbow[0] + b.forearm * fd[0], elbow[1] + b.forearm * fd[1]];
  const hand: Vec = [wrist[0] + b.hand * fd[0], wrist[1] + b.hand * fd[1]];
  return { shoulder, elbow, wrist, hand };
}

type Raw = Omit<Pose, "pelvis">;
function raw(g: Gait, p: number, b: Build): Raw {
  const lean = value(g, "trunk", p) * RAD;
  const shoulder: Vec = [b.torso * Math.sin(lean), b.torso * Math.cos(lean)];
  const neck: Vec = [shoulder[0] + b.neck * Math.sin(lean * 1.3), shoulder[1] + b.neck * Math.cos(lean * 1.3)];
  const nod = (value(g, "head", p) - HEAD_NEUTRAL) * RAD;
  const r = b.head * 0.45;
  const head: Vec = [neck[0] + r * Math.sin(nod * 0.6) + b.head * 0.14, neck[1] + r * Math.cos(nod * 0.6)];
  return { near: leg(g, p, "L", b), far: leg(g, p, "R", b), nearArm: arm(g, p, "L", shoulder, b), farArm: arm(g, p, "R", shoulder, b), lean, shoulder, neck, head, nod };
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
  travel: number[];
  stride: number;
}
const N = 240;
const tables = new Map<string, Table>();
const key = (g: Gait, b: Build): string => `${b.id}|${g.map(([n, w]) => `${n}:${w}`).join(",")}`;

/** Roll the body over the lowest point of either foot (no skating); when the take
 * says both feet are off the floor, rise by that much and coast. */
function table(g: Gait, b: Build): Table {
  const hit = tables.get(key(g, b));
  if (hit) return hit;
  const travel: number[] = [];
  let x = 0, v = 0;
  let prev = raw(g, 0, b);
  for (let i = 0; i <= N; i++) {
    const o = raw(g, i / N, b);
    const cs = contacts(o);
    const was = contacts(prev);
    const { at } = planted(cs, i === 0 ? cs : was);
    const air = Math.max(0, value(g, "air", i / N) - 0.02);
    if (i > 0) {
      if (air > 0.004) x += v;
      else {
        v = (was[at]?.[0] ?? 0) - (cs[at]?.[0] ?? 0);
        x += v;
      }
    }
    travel.push(x);
    prev = o;
  }
  const t = { travel, stride: x };
  tables.set(key(g, b), t);
  return t;
}

function sample(a: readonly number[], p: number): number {
  const f = p * N, i = Math.floor(f), k = f - i;
  return (a[i] ?? 0) * (1 - k) + (a[i + 1] ?? 0) * k;
}

export function strideLength(g: Gait, b: Build = REFERENCE): number {
  return table(g, b).stride;
}

/** Metres walked after `sec` seconds, and the stride phase there. */
export function progress(g: Gait, sec: number, b: Build = REFERENCE): { x: number; phase: number } {
  const strides = sec * cadence(g, b);
  const c = Math.floor(strides), p = strides - c;
  const tb = table(g, b);
  return { x: c * tb.stride + sample(tb.travel, p), phase: p };
}

/** The whole body at stride phase p, feet on y = 0, pelvis above x = 0. */
export function pose(g: Gait, p: number, b: Build = REFERENCE): Pose {
  const q = ((p % 1) + 1) % 1;
  const o = raw(g, q, b);
  // Lowest point of either foot on the floor, plus any flight from the take.
  let lo = Infinity;
  for (const c of contacts(o)) lo = Math.min(lo, c[1]);
  const up = -lo + Math.max(0, value(g, "air", q) - 0.02);
  const L = (v: Vec): Vec => [v[0], v[1] + up];
  const leg2 = (l: Leg): Leg => ({ hip: L(l.hip), knee: L(l.knee), ankle: L(l.ankle), heel: L(l.heel), ball: L(l.ball), toe: L(l.toe) });
  const arm2 = (a: Arm): Arm => ({ shoulder: L(a.shoulder), elbow: L(a.elbow), wrist: L(a.wrist), hand: L(a.hand) });
  return { near: leg2(o.near), far: leg2(o.far), nearArm: arm2(o.nearArm), farArm: arm2(o.farArm), pelvis: [0, up], lean: o.lean, shoulder: L(o.shoulder), neck: L(o.neck), head: L(o.head), nod: o.nod };
}

/** Where the four sole points (heels and balls) are, relative to the pelvis. */
export type Soles = readonly number[];

/** One live step for a controlled character whose gait changes as it goes: how
 * far the body moves this frame so that the planted foot stays put. `was` is
 * the soles last frame (undefined on the first), `v` the last frame's travel,
 * used to coast through a run's flight. */
export function stepBody(was: Soles | undefined, g: Gait, p: number, v: number, b: Build = REFERENCE): { dx: number; soles: Soles } {
  const cs = contacts(raw(g, ((p % 1) + 1) % 1, b));
  const soles = cs.flatMap((c) => [c[0], c[1]]);
  if (!was) return { dx: 0, soles };
  const prev: Vec[] = [0, 1, 2, 3].map((i): Vec => [was[i * 2] ?? 0, was[i * 2 + 1] ?? 0]);
  const air = Math.max(0, value(g, "air", p) - 0.02);
  if (air > 0.004) return { dx: v, soles };
  const { at } = planted(cs, prev);
  return { dx: (prev[at]?.[0] ?? 0) - (cs[at]?.[0] ?? 0), soles };
}
