// A walk driven by measured human gait, not invented motion.
//
// The leg angles are the mean of 10 people walking on a treadmill, 10 strides
// each (UCI "Multivariate Gait Data", Helwig & Hsiao-Wecksler 2016, CC BY 4.0,
// unbraced condition), fitted here as five-harmonic Fourier series over one
// stride. Phase 0 is that leg's heel strike. Error of the fit is under 1.4°.
// Arm swing is not in that data: it is estimated from the hip, opposite in sign
// and about 70% the size, as gait studies describe it.
//
// Body proportions are Drillis & Contini's segment lengths as fractions of
// height (as tabled in Winter, "Biomechanics and Motor Control of Human
// Movement"). Everything here is in metres, y up, x forward.

export type Vec = readonly [number, number];

/** [mean, cos1, sin1, cos2, sin2, …] in degrees. */
const HIP = [9.94, 16.99, -3.19, -2.85, -2.91, -1.33, 1.31, -0.27, -0.18, -0.48, 0.15];
const KNEE = [25.27, 1.74, -22.37, -17.2, -1.11, -3.5, 3.99, -1.1, 0.05, -1.05, 0.25];
const ANKLE = [4.95, -4.84, 3.31, 3.94, -2.37, -2.28, -3.22, -0.2, 1.91, 1.75, 0.01];

function fourier(c: readonly number[], p: number): number {
  let y = c[0] ?? 0;
  for (let k = 1; 2 * k < c.length; k++) {
    const w = 2 * Math.PI * k * p;
    y += (c[2 * k - 1] ?? 0) * Math.cos(w) + (c[2 * k] ?? 0) * Math.sin(w);
  }
  return y;
}

/** The three measured curves, for plotting: degrees at phase p (0..1). */
export const CURVES = {
  hip: (p: number): number => fourier(HIP, p),
  knee: (p: number): number => fourier(KNEE, p),
  ankle: (p: number): number => fourier(ANKLE, p),
};

const H = 1.65;
export const BODY = {
  height: H,
  thigh: 0.245 * H,
  shank: 0.246 * H,
  ankleHigh: 0.039 * H,
  heelBack: 0.04,
  ball: 0.14,
  toe: 0.19,
  torso: (0.818 - 0.53) * H,
  upperArm: 0.186 * H,
  forearm: 0.146 * H,
  hand: 0.07,
  neck: 0.05,
  head: 0.13 * H,
};

/** How a person walks: an eigenwalker-like handful of knobs on the measured mean. */
export interface Style {
  /** Joint excursion around the mean (1 = measured). Smaller is a shuffle. */
  amp: number;
  /** Strides per second (the measured treadmill walk is about 0.9). */
  cadence: number;
  /** Forward lean of the trunk, degrees. */
  lean: number;
  /** Head drop, degrees (positive looks down). */
  nod: number;
  /** Arm swing relative to the default estimate. */
  arms: number;
}

export const STYLES = {
  ordinary: { amp: 1, cadence: 0.9, lean: 3, nod: 0, arms: 1 },
  weary: { amp: 0.72, cadence: 0.68, lean: 11, nod: 18, arms: 0.35 },
  brisk: { amp: 1.12, cadence: 1.02, lean: 5, nod: -4, arms: 1.5 },
} satisfies Record<string, Style>;

const RAD = Math.PI / 180;

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
  neck: Vec;
  /** Head centre and its tilt in radians (positive looks down). */
  head: Vec;
  nod: number;
  pelvis: Vec;
}

function around(c: readonly number[], p: number, amp: number): number {
  const mean = c[0] ?? 0;
  return mean + (fourier(c, p) - mean) * amp;
}

/** One leg's joints with the pelvis at (0, 0). */
function leg(p: number, s: Style): Leg {
  const tt = around(HIP, p, s.amp) * RAD;
  const knee: Vec = [BODY.thigh * Math.sin(tt), -BODY.thigh * Math.cos(tt)];
  const ts = tt - around(KNEE, p, s.amp) * RAD;
  const ankle: Vec = [knee[0] + BODY.shank * Math.sin(ts), knee[1] - BODY.shank * Math.cos(ts)];
  const f = ts + around(ANKLE, p, s.amp) * RAD;
  const dir: Vec = [Math.cos(f), Math.sin(f)];
  const down: Vec = [Math.sin(f), -Math.cos(f)];
  const sole = (d: number): Vec => [ankle[0] + down[0] * BODY.ankleHigh + dir[0] * d, ankle[1] + down[1] * BODY.ankleHigh + dir[1] * d];
  // The toes bend at the ball, so past it the shoe stays level with the ground.
  const ball = sole(BODY.ball);
  const toeLen = BODY.toe - BODY.ball;
  const toe: Vec = dir[1] < 0 ? [ball[0] + toeLen, ball[1]] : [ball[0] + dir[0] * toeLen, ball[1] + dir[1] * toeLen];
  return { hip: [0, 0], knee, ankle, heel: sole(-BODY.heelBack), ball, toe };
}

function arm(p: number, s: Style, shoulder: Vec): Arm {
  // The arm swings against the leg on its own side.
  const hip = around(HIP, p, s.amp) - (HIP[0] ?? 0);
  const sh = -0.7 * hip * s.arms * RAD;
  const el = sh + (12 + 0.9 * Math.max(0, -hip * s.arms)) * RAD;
  const elbow: Vec = [shoulder[0] + BODY.upperArm * Math.sin(sh), shoulder[1] - BODY.upperArm * Math.cos(sh)];
  const wrist: Vec = [elbow[0] + BODY.forearm * Math.sin(el), elbow[1] - BODY.forearm * Math.cos(el)];
  const hand: Vec = [wrist[0] + BODY.hand * Math.sin(el + 0.2), wrist[1] - BODY.hand * Math.cos(el + 0.2)];
  return { shoulder, elbow, wrist, hand };
}

const contacts = (l: Leg): Vec[] => [l.heel, l.ball];

/** The pose at stride phase p of the near leg, pelvis at (0, 0). */
function rawPose(p: number, s: Style): Omit<Pose, "pelvis"> {
  const q = (p + 0.5) % 1;
  const near = leg(p, s), far = leg(q, s);
  const lean = s.lean * RAD;
  const shoulder: Vec = [BODY.torso * Math.sin(lean), BODY.torso * Math.cos(lean)];
  const neck: Vec = [shoulder[0] + BODY.neck * Math.sin(lean * 1.5), shoulder[1] + BODY.neck];
  const nod = s.nod * RAD;
  const head: Vec = [neck[0] + 0.035 + Math.sin(nod) * 0.06, neck[1] + BODY.head * 0.45];
  return { near, far, nearArm: arm(p, s, shoulder), farArm: arm(q, s, shoulder), neck, head, nod };
}

function lowest(o: Omit<Pose, "pelvis">): { y: number; at: number } {
  const all = [...contacts(o.near), ...contacts(o.far)];
  let y = Infinity, at = 0;
  for (const [i, c] of all.entries()) {
    if (c[1] < y) {
      y = c[1];
      at = i;
    }
  }
  return { y, at };
}

interface Table {
  /** Pelvis height and forward travel at each sample of one stride. */
  lift: number[];
  travel: number[];
  /** Metres covered by one stride (two steps). */
  stride: number;
}
const N = 240;
const tables = new Map<Style, Table>();

/** Plant whichever point of either foot is lowest and let the body roll over it:
 * that gives the pelvis's bob and the forward travel, so the feet never skate. */
function table(s: Style): Table {
  const hit = tables.get(s);
  if (hit) return hit;
  const lift: number[] = [], travel: number[] = [];
  let x = 0;
  let prev = rawPose(0, s);
  for (let i = 0; i <= N; i++) {
    const o = rawPose(i / N, s);
    const low = lowest(o);
    if (i > 0) {
      const was = [...contacts(prev.near), ...contacts(prev.far)][low.at] ?? [0, 0];
      const now = [...contacts(o.near), ...contacts(o.far)][low.at] ?? [0, 0];
      x += was[0] - now[0];
    }
    lift.push(-low.y);
    travel.push(x);
    prev = o;
  }
  const t = { lift, travel, stride: x };
  tables.set(s, t);
  return t;
}

function sample(a: readonly number[], p: number): number {
  const f = p * N, i = Math.floor(f), k = f - i;
  return (a[i] ?? 0) * (1 - k) + (a[i + 1] ?? 0) * k;
}

/** Metres walked at time `sec`, and the stride phase there. */
export function progress(s: Style, sec: number): { x: number; phase: number } {
  const strides = sec * s.cadence;
  const c = Math.floor(strides), p = strides - c;
  const tb = table(s);
  return { x: c * tb.stride + sample(tb.travel, p), phase: p };
}

export function strideLength(s: Style): number {
  return table(s).stride;
}

/** The whole body at stride phase p, feet on y = 0, pelvis above x = 0. */
export function pose(s: Style, p: number): Pose {
  const o = rawPose(p, s);
  const up = sample(table(s).lift, p);
  const lift = (v: Vec): Vec => [v[0], v[1] + up];
  const L = (l: Leg): Leg => ({ hip: lift(l.hip), knee: lift(l.knee), ankle: lift(l.ankle), heel: lift(l.heel), ball: lift(l.ball), toe: lift(l.toe) });
  const A = (a: Arm): Arm => ({ shoulder: lift(a.shoulder), elbow: lift(a.elbow), wrist: lift(a.wrist), hand: lift(a.hand) });
  return { near: L(o.near), far: L(o.far), nearArm: A(o.nearArm), farArm: A(o.farArm), neck: lift(o.neck), head: lift(o.head), nod: o.nod, pelvis: [0, up] };
}

/** Where each foot stood flat, as [heel x, ball x] in metres walked, for strides
 * from `from` to `to` (stride counts). Near foot is flat around phase 0.25. */
export function footprints(s: Style, from: number, to: number): { heel: number; ball: number; near: boolean }[] {
  const out: { heel: number; ball: number; near: boolean }[] = [];
  const tb = table(s);
  for (let c = Math.floor(from); c <= to; c++) {
    for (const [p, near] of [[0.25, true], [0.75, false]] as const) {
      const body = c * tb.stride + sample(tb.travel, p);
      const ps = pose(s, p);
      const l = near ? ps.near : ps.far;
      out.push({ heel: body + l.heel[0], ball: body + l.ball[0], near });
    }
  }
  return out;
}
