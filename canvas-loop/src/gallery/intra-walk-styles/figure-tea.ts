// Drawing a person from a gait: one continuous outline per limb (no jointed
// segments), a trunk with a back and a belly, a face in profile, and clothes that
// hang from their own small skeletons, which follow the legs a moment late.
import type { Vec2, View } from "@ianbicking/canvas-loop";
import { INK, blob, stroke } from "./ink-tea.js";
import { pose } from "./gait-tea.js";
import { REFERENCE } from "./body-tea.js";
import type { Build } from "./body-tea.js";
import type { Arm, Gait, Leg, Pose, Vec } from "./gait-tea.js";

export function mixHex(a: string, b: string, t: number): string {
  const pa = Number.parseInt(a.slice(1), 16), pb = Number.parseInt(b.slice(1), 16);
  const ch = (p: number, s: number): number => (p >> s) & 255;
  const c = [16, 8, 0].map((s) => Math.round(ch(pa, s) + (ch(pb, s) - ch(pa, s)) * t));
  return `#${c.map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}
const dark = (c: string, t: number): string => mixHex(c, "#000000", t);
const light = (c: string, t: number): string => mixHex(c, "#ffffff", t);

export interface Outfit {
  /** Top and trousers (a jumpsuit when they match). */
  top: string;
  legs: string;
  shoes: string;
  skin: string;
  hair: string;
  /** Hair style: short, bun or a ponytail that swings. */
  hairdo?: "short" | "bun" | "ponytail";
  collar?: string;
  skirt?: string;
  coat?: string;
  /** Draw hands and feet only, floating where the limbs would put them. */
  limbless?: boolean;
  /** Overlay the garments' own skeletons. */
  rig?: boolean;
  seed: number;
}

export interface Place {
  x: number;
  y: number;
  /** px per metre. */
  s: number;
  facing: 1 | -1;
}

// --- Geometry in body space (metres, y up, facing +x) -----------------------------------

const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1]];
const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1]];
const scl = (a: Vec, k: number): Vec => [a[0] * k, a[1] * k];
const lerp = (a: Vec, b: Vec, t: number): Vec => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const norm = (a: Vec): Vec => {
  const l = Math.hypot(a[0], a[1]) || 1;
  return [a[0] / l, a[1] / l];
};
/** The angle of a limb bone hanging from a: 0 straight down, positive forward. */
const hang = (a: Vec, b: Vec): number => Math.atan2(b[0] - a[0], a[1] - b[1]);
const dirOf = (ang: number): Vec => [Math.sin(ang), -Math.cos(ang)];
/** A point in a frame tipped by `ang` (positive tips forward), from (forward, up) offsets. */
const tipped = (o: Vec, ang: number, f: number, u: number): Vec => [o[0] + f * Math.cos(ang) + u * Math.sin(ang), o[1] - f * Math.sin(ang) + u * Math.cos(ang)];

/** A smooth centre line through a, b, c with the corner at b rounded off. */
function centre(a: Vec, b: Vec, c: Vec): Vec[] {
  const pts: Vec[] = [];
  const p0 = lerp(a, b, 0.78), p1 = lerp(b, c, 0.22);
  for (let i = 0; i <= 6; i++) pts.push(lerp(a, p0, i / 6));
  for (let i = 1; i < 6; i++) {
    const t = i / 6;
    pts.push(add(add(scl(p0, (1 - t) * (1 - t)), scl(b, 2 * t * (1 - t))), scl(p1, t * t)));
  }
  for (let i = 0; i <= 6; i++) pts.push(lerp(p1, c, i / 6));
  return pts;
}

/** A limb outline round a centre line: `front(t)` and `back(t)` give the half-widths
 * at fraction t along it; the far end gets a rounded cap. */
function sausage(line: readonly Vec[], front: (t: number) => number, back: (t: number) => number): Vec[] {
  const n = line.length;
  const L: Vec[] = [], R: Vec[] = [];
  for (let i = 0; i < n; i++) {
    const p = line[i] ?? [0, 0];
    const q = line[Math.min(n - 1, i + 1)] ?? p, o = line[Math.max(0, i - 1)] ?? p;
    const d = norm(sub(q, o));
    // For a limb hanging down, this normal points forward.
    const nf: Vec = [-d[1], d[0]];
    const t = i / (n - 1);
    L.push(add(p, scl(nf, front(t))));
    R.push(add(p, scl(nf, -back(t))));
  }
  const end = line[n - 1] ?? [0, 0];
  const d = norm(sub(end, line[n - 2] ?? end));
  const r = (front(1) + back(1)) / 2;
  const cap: Vec[] = [];
  for (let i = 1; i < 6; i++) {
    const a = (Math.PI * i) / 6;
    const nf: Vec = [-d[1], d[0]];
    cap.push(add(end, add(scl(nf, Math.cos(a) * r), scl(d, Math.sin(a) * r))));
  }
  return [...L, ...cap, ...R.reverse()];
}

const bump = (t: number, at: number, w: number): number => Math.max(0, 1 - ((t - at) / w) ** 2);

function legOutline(l: Leg, b: Build): Vec[] {
  // Thigh full at the top, a knee, a calf bulging behind, a slim ankle.
  const k = b.limb;
  const front = (t: number): number => k * (0.07 - 0.032 * t + 0.008 * bump(t, 0.25, 0.25) - 0.004 * bump(t, 0.5, 0.08));
  const back = (t: number): number => k * (0.075 - 0.045 * t + 0.022 * bump(t, 0.62, 0.16)) + b.seat * 0.6 * bump(t, 0, 0.25);
  return sausage(centre(l.hip, l.knee, l.ankle), front, back);
}
function armOutline(a: Arm, b: Build): Vec[] {
  const k = b.limb;
  const front = (t: number): number => k * (0.045 - 0.016 * t + 0.008 * bump(t, 0.62, 0.15));
  const back = (t: number): number => k * (0.05 - 0.02 * t + 0.01 * bump(t, 0.22, 0.2));
  return sausage(centre(a.shoulder, a.elbow, a.wrist), front, back);
}
/** A mitten: palm and a thumb, along the forearm. */
function handOutline(a: Arm, b: Build): Vec[] {
  const d = norm(sub(a.hand, a.wrist));
  const nf: Vec = [-d[1], d[0]];
  const w = a.wrist, len = 0.09 * (b.height / 1.65), k = Math.sqrt(b.limb) * (b.height / 1.65);
  const P = (along: number, across: number): Vec => add(w, add(scl(d, along * len), scl(nf, across * k)));
  return [P(-0.1, 0.025), P(0.4, 0.034), P(0.55, 0.045), P(0.7, 0.035), P(1, 0.012), P(1.05, -0.01), P(0.8, -0.03), P(0.2, -0.028), P(-0.1, -0.024)];
}
function shoeOutline(l: Leg, b: Build): Vec[] {
  const k = b.ball / 0.15;
  const up: Vec = add(l.ankle, [-0.03 * k, 0.04 * k]);
  const d = norm(sub(l.ball, l.heel));
  const nf: Vec = [-d[1], d[0]];
  const toeTop = add(l.toe, scl(nf, 0.035 * k));
  return [up, add(l.heel, scl(nf, 0.03 * k)), add(l.heel, [-0.005, -0.004]), l.ball, l.toe, add(l.toe, scl(d, 0.015 * k)), toeTop, add(lerp(l.ankle, l.ball, 0.5), scl(nf, 0.04 * k)), add(l.ankle, [0.045 * k, 0.03 * k])];
}

function trunkOutline(ps: Pose, b: Build, puff = 0): Vec[] {
  const p = ps.pelvis, lean = ps.lean, T = b.torso, D = b.depth * (1 + puff), U = T / 0.475;
  const at = (f: number, u: number): Vec => tipped(p, lean * (u / T), f, u);
  const c = b.chest, bl = b.belly, st = b.seat;
  return [
    at(0.07 * D, -0.1 * U), at(0.115 * D + bl * 0.4, 0.02 * U), at(0.105 * D + bl * 0.9, 0.14 * U), at(0.11 * D + bl, 0.24 * U),
    at(0.108 * D + bl * 0.5 + c * 0.45, T - 0.2 * U), at(0.122 * D + c, T - 0.13 * U), at(0.112 * D + c * 0.45, T - 0.06 * U), at(0.08 * D, T - 0.02 * U),
    at(0.045 * D, T + 0.07 * U), at(-0.045 * D, T + 0.08 * U),
    at(-0.11 * D, T - 0.01 * U), at(-0.125 * D, T - 0.12 * U), at(-0.105 * D - bl * 0.15, 0.2 * U), at(-0.095 * D, 0.12 * U), at(-0.118 * D - st, 0.0), at(-0.11 * D - st * 0.7, -0.09 * U), at(-0.05 * D, -0.13 * U),
  ];
}

// --- Clothes on their own skeletons -----------------------------------------------------

/** A panel that hangs from `top` in `bones` links, each link turned toward
 * `target` a little more than the last (cloth bends most at the hem). */
function chain(top: Vec, len: number, target: number, rest: number, links = 3): Vec[] {
  const pts: Vec[] = [top];
  let p = top;
  for (let i = 1; i <= links; i++) {
    const a = rest + (target - rest) * (i / links) ** 0.7;
    p = add(p, scl(dirOf(a), len / links));
    pts.push(p);
  }
  return pts;
}

/** How far forward (and back) the legs reach at a given height above the floor. */
function legReach(ps: Pose, y: number, k = 1): { front: number; back: number; found: boolean } {
  let front = -Infinity, back = Infinity;
  for (const l of [ps.near, ps.far]) {
    for (const [a, b] of [[l.hip, l.knee], [l.knee, l.ankle]] as const) {
      if ((a[1] - y) * (b[1] - y) > 0) continue;
      const t = (y - a[1]) / (b[1] - a[1] || 1e-6);
      const x = a[0] + (b[0] - a[0]) * t;
      front = Math.max(front, x + 0.075 * k);
      back = Math.min(back, x - 0.085 * k);
    }
  }
  const found = Number.isFinite(front);
  return { front: found ? front : 0.1, back: found ? back : -0.1, found };
}

/** The angles the front and back of a hanging garment take: pushed by the legs
 * now, following where they were a moment ago, and blown back by speed. */
function drape(ps: Pose, lag: Pose, top: number, len: number, speed: number, flare: number, b: Build): { front: number; back: number } {
  const y = top - len * 0.85;
  const now = legReach(ps, y, b.limb), was = legReach(lag, y, b.limb);
  const angle = (dx: number): number => Math.atan2(dx, len * 0.85);
  const drag = Math.min(0.9, speed * 0.18);
  // Cloth lifts and drops a beat behind the body's bob.
  const flutter = (ps.pelvis[1] - lag.pelvis[1]) * (4 + speed * 4);
  const front = Math.max(angle(now.front - ps.pelvis[0]), 0.6 * angle(now.front) + 0.4 * angle(was.front)) + flare - drag * 0.35;
  const back = Math.min(angle(now.back), 0.55 * angle(now.back) + 0.45 * angle(was.back)) - flare - drag + flutter;
  return { front, back };
}

/** Legs at height y: the front-most and back-most surface, or undefined if no leg is there. */
function legSpan(ps: Pose, y: number, k: number): { front: number; back: number } | undefined {
  const r = legReach(ps, y, k);
  return r.found ? r : undefined;
}

/** Push a hanging chain out of the legs: each link that would sit inside a leg is
 * moved out, with the links below it, so no leg ever pokes through. */
function contain(c: readonly Vec[], ps: Pose, side: "front" | "back", k: number): Vec[] {
  const out = [...c];
  for (let i = 1; i < out.length; i++) {
    const p = out[i] ?? [0, 0];
    const span = legSpan(ps, p[1], k);
    if (!span) continue;
    const dx = side === "front" ? Math.max(0, span.front - p[0]) : Math.min(0, span.back - p[0]);
    if (dx === 0) continue;
    for (let j = i; j < out.length; j++) out[j] = add(out[j] ?? [0, 0], [dx, 0]);
  }
  // A bent knee is a corner that can fall between two links: tilt the link past it.
  for (const knee of [ps.near.knee, ps.far.knee]) {
    for (let i = 1; i < out.length; i++) {
      const a = out[i - 1] ?? [0, 0], z = out[i] ?? [0, 0];
      if ((a[1] - knee[1]) * (z[1] - knee[1]) > 0) continue;
      const t = (knee[1] - a[1]) / (z[1] - a[1] || 1e-6);
      const x = a[0] + (z[0] - a[0]) * t;
      const need = side === "front" ? Math.max(0, knee[0] + 0.075 * k - x) : Math.min(0, knee[0] - 0.085 * k - x);
      if (need === 0) continue;
      for (let j = i; j < out.length; j++) out[j] = add(out[j] ?? [0, 0], [need / Math.max(t, 0.3), 0]);
    }
  }
  return out;
}

/** A skirt's two panels: like a coat's, but held closed, so they stay outside the legs. */
export function skirtPanels(ps: Pose, lag: Pose, speed: number, b: Build = REFERENCE): { front: Vec[]; back: Vec[]; waist: Vec } {
  const s = b.height / 1.65;
  const waist = tipped(ps.pelvis, ps.lean * 0.3, 0, 0.1 * s);
  const len = 0.52 * s;
  const d = drape(ps, lag, waist[1], len, speed, 0.12, b);
  const front = contain(chain(tipped(waist, ps.lean * 0.3, 0.11 * b.depth + b.belly * 0.6, 0), len, d.front, 0.15, 6), ps, "front", b.limb);
  const back = contain(chain(tipped(waist, ps.lean * 0.3, -0.125 * b.depth - b.seat, -0.04 * s), len - 0.02 * s, d.back, -0.15, 6), ps, "back", b.limb);
  return { front, back, waist };
}

function skirtShape(ps: Pose, lag: Pose, speed: number, b: Build): Vec[] {
  const { front, back, waist } = skirtPanels(ps, lag, speed, b);
  const hemF = front.at(-1) ?? waist, hemB = back.at(-1) ?? waist;
  const mid = add(lerp(hemB, hemF, 0.5), [0, 0.03]);
  return [...front, add(lerp(hemF, mid, 0.5), [0, -0.01]), mid, add(lerp(mid, hemB, 0.5), [0, -0.01]), ...[...back].reverse()];
}

function coatSkirt(ps: Pose, lag: Pose, speed: number, b: Build): { front: Vec[]; back: Vec[] } {
  const hipF = tipped(ps.pelvis, ps.lean * 0.3, 0.12 * b.depth + b.belly, 0.05);
  const hipB = tipped(ps.pelvis, ps.lean * 0.3, -0.14 * b.depth - b.seat, 0.03);
  const len = ps.pelvis[1] - 0.3 * (b.height / 1.65);
  const d = drape(ps, lag, hipF[1], len, speed, 0.03, b);
  return { front: chain(hipF, len, d.front, 0.05), back: chain(hipB, len, d.back, -0.05) };
}

// --- Head --------------------------------------------------------------------------------

function head(v: View, ps: Pose, lag: Pose, o: Outfit, P: (v: Vec) => Vec2, speed: number, b: Build): void {
  const R = b.head / 2, c = ps.head, nod = ps.nod;
  // Local (forward, up) in head units, tipped by the nod.
  const at = (f: number, u: number): Vec => tipped(c, nod, f * R, u * R);
  const face: Vec[] = [[-0.95, 0.1], [-0.82, 0.68], [-0.25, 1.05], [0.45, 0.95], [0.82, 0.5], [0.86, 0.15], [1.12, -0.18], [0.9, -0.3], [0.94, -0.5], [0.82, -0.78], [0.42, -0.98], [-0.05, -0.75], [-0.5, -0.5], [-0.85, -0.25]].map(([f, u]) => at(f ?? 0, u ?? 0));
  blob(v, face.map(P), { fill: o.skin, light: light(o.skin, 0.18), seed: o.seed + 50, line: 1.7, amp: 0.35 });
  // Ear, eye with a lid, brow.
  blob(v, [at(-0.18, 0.12), at(-0.02, 0.1), at(0.0, -0.22), at(-0.18, -0.25)].map(P), { fill: dark(o.skin, 0.1), seed: o.seed + 51, line: 1.1, amp: 0.2 });
  const [ex, ey] = P(at(0.6, 0.1));
  v.circle(ex, ey, Math.max(1.3, R * 0.07 * Math.abs(P([1, 0])[0] - P([0, 0])[0])), { fill: "#1a1010" });
  stroke(v, [at(0.45, 0.28), at(0.75, 0.3)].map(P), { seed: o.seed + 52, weight: 1.6, colour: dark(o.hair, 0.2), amp: 0.2 });
  // Hair: a cap over the crown and the back; a bun or a ponytail that swings.
  const cap: Vec[] = [at(-0.98, -0.2), at(-0.95, 0.4), at(-0.6, 0.95), at(0, 1.18), at(0.6, 1.0), at(0.88, 0.55), at(0.5, 0.62), at(0.1, 0.48), at(-0.25, 0.3), at(-0.55, -0.1)];
  blob(v, cap.map(P), { fill: o.hair, light: light(o.hair, 0.15), seed: o.seed + 53, line: 1.3, amp: 0.35 });
  if (o.hairdo === "bun") blob(v, [at(-1.25, 0.55), at(-1.0, 0.9), at(-0.7, 0.85), at(-0.75, 0.4), at(-1.1, 0.3)].map(P), { fill: o.hair, seed: o.seed + 54, line: 1.3, amp: 0.3 });
  if (o.hairdo === "ponytail") {
    // The tail follows the head's bob a moment late, and streams back with speed.
    const bob = (ps.pelvis[1] - lag.pelvis[1]) * 9;
    const root = at(-0.9, 0.55);
    const tail = chain(root, 0.3, -0.25 - Math.min(1.1, speed * 0.3) - bob, 0.1 - bob * 0.5, 4);
    const left = tail.map((p, i) => add(p, [0, 0.022 * (1 - i / 5)]));
    const right = tail.map((p, i) => add(p, [0, -0.022 * (1 - i / 5)]));
    blob(v, [...left, ...right.reverse()].map(P), { fill: o.hair, seed: o.seed + 55, line: 1.2, amp: 0.3 });
  }
}

function clothRig(v: View, ps: Pose, lag: Pose, speed: number, o: Outfit, P: (v: Vec) => Vec2, b: Build): void {
  const chains: Vec[][] = [];
  if (o.coat !== undefined) {
    const c = coatSkirt(ps, lag, speed, b);
    chains.push(c.front, c.back);
  }
  if (o.skirt !== undefined) {
    const k = skirtPanels(ps, lag, speed, b);
    chains.push(k.front, k.back);
  }
  for (const c of chains) {
    v.curve(c.map(P), false, { stroke: "#e0306a", weight: 2 });
    for (const p of c) {
      const [x, y] = P(p);
      v.circle(x, y, 3, { fill: "#e0306a" });
    }
  }
}

// --- The person --------------------------------------------------------------------------

function crease(v: View, a: Vec, b: Vec, c: Vec, P: (v: Vec) => Vec2, seed: number, colour: string): void {
  const bend = Math.abs(hang(a, b) - hang(b, c));
  if (bend < 0.35) return;
  const back = norm(add(norm(sub(a, b)), norm(sub(c, b))));
  const n = Math.min(3, Math.floor(bend / 0.3));
  for (let i = 0; i < n; i++) {
    const s = add(b, scl(back, 0.03 + i * 0.012));
    const side: Vec = [-back[1] * 0.025, back[0] * 0.025];
    stroke(v, [add(s, side), add(s, scl(side, -1))].map(P), { seed: seed + i, weight: 1, colour, amp: 0.2 });
  }
}

export function person(v: View, g: Gait, phase: number, speed: number, q: Place, o: Outfit, b: Build = REFERENCE): void {
  const ps = pose(g, phase, b), lag = pose(g, phase - 0.07, b);
  const P = (p: Vec): Vec2 => [q.x + p[0] * q.s * q.facing, q.y - p[1] * q.s];
  const far = 0.28;
  const skinFar = dark(o.skin, 0.22);
  const sleeve = o.coat ?? o.top;
  v.ellipse(q.x + ps.pelvis[0] * q.s * q.facing, q.y, 0.24 * q.s, 0.045 * q.s, { fill: `rgba(0,0,0,${(0.35 - ps.pelvis[1] * 0.1).toFixed(2)})` });
  const coat = o.coat === undefined ? undefined : coatSkirt(ps, lag, speed, b);

  // Far side: arm, leg, shoe; then the back of a coat.
  if (o.limbless !== true) blob(v, armOutline(ps.farArm, b).map(P), { fill: dark(sleeve, far), seed: o.seed + 1, line: 1.4, amp: 0.4 });
  blob(v, handOutline(ps.farArm, b).map(P), { fill: skinFar, seed: o.seed + 2, line: 1.2, amp: 0.25 });
  if (o.limbless !== true) blob(v, legOutline(ps.far, b).map(P), { fill: dark(o.legs, far), seed: o.seed + 3, line: 1.5, amp: 0.4 });
  blob(v, shoeOutline(ps.far, b).map(P), { fill: dark(o.shoes, 0.2), seed: o.seed + 4, line: 1.2, amp: 0.25 });

  // Trunk, then the near leg.
  blob(v, trunkOutline(ps, b, coat ? 0.12 : 0).map(P), { fill: sleeve, light: light(sleeve, 0.2), dark: dark(sleeve, 0.3), shadeSide: q.facing > 0 ? "left" : "right", seed: o.seed + 6, line: 1.9, amp: 0.5 });
  if (o.limbless !== true) {
    blob(v, legOutline(ps.near, b).map(P), { fill: o.legs, light: light(o.legs, 0.15), seed: o.seed + 7, line: 1.6, amp: 0.4 });
    crease(v, ps.near.hip, ps.near.knee, ps.near.ankle, P, o.seed + 8, dark(o.legs, 0.45));
  }
  blob(v, shoeOutline(ps.near, b).map(P), { fill: o.shoes, light: light(o.shoes, 0.25), seed: o.seed + 9, line: 1.3, amp: 0.25 });

  // Garments over the legs.
  if (o.skirt !== undefined) blob(v, skirtShape(ps, lag, speed, b).map(P), { fill: o.skirt, light: light(o.skirt, 0.2), dark: dark(o.skirt, 0.3), shadeSide: "bottom", seed: o.seed + 10, line: 1.7, amp: 0.5 });
  if (coat && o.coat !== undefined) {
    // One cloth over both legs: shoulders, down the front panel, along the hem,
    // up the back panel.
    const sh = ps.shoulder;
    const hemF = coat.front.at(-1) ?? sh, hemB = coat.back.at(-1) ?? sh;
    const sag = add(lerp(hemB, hemF, 0.5), [0, 0.02]);
    const body: Vec[] = [tipped(sh, ps.lean, 0.0, 0.08), tipped(sh, ps.lean, 0.11, 0.0), tipped(sh, ps.lean, 0.135, -0.18), ...coat.front, sag, ...[...coat.back].reverse(), tipped(sh, ps.lean, -0.135, -0.16), tipped(sh, ps.lean, -0.1, 0.02)];
    blob(v, body.map(P), { fill: o.coat, light: light(o.coat, 0.18), dark: dark(o.coat, 0.3), shadeSide: q.facing > 0 ? "left" : "right", seed: o.seed + 11, line: 1.9, amp: 0.5 });
    // The back vent: a fold line up from the hem.
    stroke(v, [hemB, lerp(hemB, coat.back[1] ?? hemB, 0.9)].map(P), { seed: o.seed + 18, weight: 1.1, colour: dark(o.coat, 0.5), amp: 0.3 });
    // Lapel and buttons.
    stroke(v, [tipped(sh, ps.lean, 0.08, 0.05), tipped(sh, ps.lean, 0.02, -0.2), tipped(ps.pelvis, ps.lean, 0.11, 0.12)].map(P), { seed: o.seed + 12, weight: 1.2, colour: dark(o.coat, 0.5), amp: 0.3 });
    for (const u of [0.05, 0.18]) {
      const [bx, by] = P(tipped(ps.pelvis, ps.lean, 0.125, u));
      v.circle(bx, by, 0.012 * q.s, { fill: "#d8c890" });
    }
  }
  if (o.collar !== undefined && !coat) blob(v, [tipped(ps.shoulder, ps.lean, -0.07, 0.07), tipped(ps.shoulder, ps.lean, 0.06, 0.07), tipped(ps.shoulder, ps.lean, 0.08, -0.01), tipped(ps.shoulder, ps.lean, -0.08, -0.01)].map(P), { fill: o.collar, seed: o.seed + 13, line: 1.2, amp: 0.25 });
  if (o.skirt === undefined && !coat) stroke(v, [tipped(ps.pelvis, ps.lean, -0.12, 0.09), tipped(ps.pelvis, ps.lean, 0.11, 0.1)].map(P), { seed: o.seed + 14, weight: 2.4, colour: "#2a2420", amp: 0.2 });

  head(v, ps, lag, o, P, speed, b);
  if (o.rig === true) clothRig(v, ps, lag, speed, o, P, b);

  // Near arm on top.
  if (o.limbless !== true) {
    blob(v, armOutline(ps.nearArm, b).map(P), { fill: sleeve, light: light(sleeve, 0.15), seed: o.seed + 15, line: 1.5, amp: 0.4 });
    crease(v, ps.nearArm.shoulder, ps.nearArm.elbow, ps.nearArm.wrist, P, o.seed + 16, dark(sleeve, 0.45));
  }
  blob(v, handOutline(ps.nearArm, b).map(P), { fill: o.skin, seed: o.seed + 17, line: 1.2, amp: 0.25 });
}

/** The pose's bones, for checking the drawing against the rig. */
export function bones(v: View, g: Gait, phase: number, q: Place, colour: string): void {
  const ps = pose(g, phase);
  const P = (p: Vec): Vec2 => [q.x + p[0] * q.s * q.facing, q.y - p[1] * q.s];
  const line = (pts: readonly Vec[]): void => {
    v.curve(pts.map(P), false, { stroke: colour, weight: 1.2 });
    for (const p of pts) {
      const [x, y] = P(p);
      v.circle(x, y, 1.8, { fill: colour });
    }
  };
  line([ps.far.hip, ps.far.knee, ps.far.ankle, ps.far.heel, ps.far.ball]);
  line([ps.farArm.shoulder, ps.farArm.elbow, ps.farArm.wrist]);
  line([ps.pelvis, ps.shoulder, ps.neck, ps.head]);
  line([ps.near.hip, ps.near.knee, ps.near.ankle, ps.near.heel, ps.near.ball]);
  line([ps.nearArm.shoulder, ps.nearArm.elbow, ps.nearArm.wrist]);
}
export { INK };

// --- Facing the camera -------------------------------------------------------------------

/** A limb seen from the front: a tapered band from a to c, bending at b. */
function band(a: Vec, b: Vec, c: Vec, ra: number, rb: number, rc: number): Vec[] {
  const w = (t: number): number => (t < 0.5 ? ra + (rb - ra) * t * 2 : rb + (rc - rb) * (t - 0.5) * 2);
  return sausage(centre(a, b, c), w, w);
}

/** The person standing and looking out of the picture: the middle frame of a turn. */
export function personFront(v: View, q: Place, o: Outfit, b: Build = REFERENCE): void {
  const s = b.height / 1.65, k = b.limb;
  const P = (p: Vec): Vec2 => [q.x + p[0] * q.s, q.y - p[1] * q.s];
  const hipY = b.thigh + b.shank + b.ankleHigh, shY = hipY + b.torso, R = b.head / 2;
  const headY = shY + b.neck + R * 0.95;
  const stance = 0.085 * s;
  v.ellipse(q.x, q.y, 0.26 * q.s * s, 0.045 * q.s, { fill: "rgba(0,0,0,0.3)" });
  const sleeve = o.coat ?? o.top;
  for (const side of [-1, 1]) {
    const hip: Vec = [side * b.hips * 0.5, hipY], ankle: Vec = [side * stance, b.ankleHigh];
    const knee = lerp(hip, ankle, 0.5);
    if (o.limbless !== true) blob(v, band(hip, knee, ankle, 0.07 * k, 0.05 * k, 0.035 * k).map(P), { fill: side < 0 ? dark(o.legs, 0.12) : o.legs, seed: o.seed + 70 + side, line: 1.5, amp: 0.4 });
    // A shoe seen toe-on: a rounded toe cap under the ankle.
    blob(v, [[side * stance - 0.055 * s, 0], [side * stance + 0.055 * s, 0], [side * stance + 0.05 * s, 0.05 * s], [side * stance, 0.075 * s], [side * stance - 0.05 * s, 0.05 * s]].map((p): Vec2 => P([p[0] ?? 0, p[1] ?? 0])), { fill: o.shoes, seed: o.seed + 72 + side, line: 1.2, amp: 0.25 });
  }
  if (o.skirt !== undefined) {
    const top = hipY + 0.1 * s, hem = top - 0.52 * s;
    blob(v, ([[-b.waist, top], [b.waist, top], [b.hips * 1.55, hem], [0, hem - 0.02], [-b.hips * 1.55, hem]] satisfies Vec[]).map(P), { fill: o.skirt, light: light(o.skirt, 0.2), dark: dark(o.skirt, 0.3), shadeSide: "left", seed: o.seed + 74, line: 1.7, amp: 0.5 });
  }
  // Trunk: hips, waist, chest, shoulders, a neck.
  const coatHem = 0.3 * s;
  const low = o.coat === undefined ? hipY - 0.1 * s : coatHem;
  const flare = o.coat === undefined ? b.hips : b.hips * 1.35;
  const trunk: Vec[] = [[-flare, low], [flare, low], [b.hips, hipY], [b.waist, hipY + 0.17 * s], [b.shoulders * 0.88 + b.chest * 0.4, shY - 0.17 * s], [b.shoulders, shY - 0.03 * s], [0.05 * s, shY + 0.03 * s], [-0.05 * s, shY + 0.03 * s], [-b.shoulders, shY - 0.03 * s], [-(b.shoulders * 0.88 + b.chest * 0.4), shY - 0.17 * s], [-b.waist, hipY + 0.17 * s], [-b.hips, hipY]];
  blob(v, trunk.map(P), { fill: sleeve, light: light(sleeve, 0.2), dark: dark(sleeve, 0.3), shadeSide: "left", seed: o.seed + 75, line: 1.9, amp: 0.5 });
  if (b.chest > 0.02) for (const side of [-1, 1]) stroke(v, [[side * 0.03 * s, shY - 0.2 * s], [side * 0.08 * s, shY - 0.21 * s - b.chest * 0.3], [side * 0.13 * s, shY - 0.18 * s]].map((p): Vec2 => P([p[0] ?? 0, p[1] ?? 0])), { seed: o.seed + 76 + side, weight: 1.1, colour: dark(sleeve, 0.4), amp: 0.2 });
  if (o.coat !== undefined) {
    stroke(v, [P([0, shY - 0.05 * s]), P([0, coatHem])], { seed: o.seed + 78, weight: 1.3, colour: dark(o.coat, 0.5), amp: 0.3 });
    for (const u of [0.15, 0.3, 0.45]) {
      const [bx, by] = P([0.025 * s, hipY + u * s - 0.1 * s]);
      v.circle(bx, by, 0.012 * q.s, { fill: "#d8c890" });
    }
  } else if (o.skirt === undefined) stroke(v, [P([-b.waist * 1.02, hipY + 0.08 * s]), P([b.waist * 1.02, hipY + 0.08 * s])], { seed: o.seed + 79, weight: 2.4, colour: "#2a2420", amp: 0.2 });
  if (o.collar !== undefined && o.coat === undefined) blob(v, [P([-0.1 * s, shY + 0.01 * s]), P([0.1 * s, shY + 0.01 * s]), P([0.05 * s, shY - 0.07 * s]), P([0, shY - 0.03 * s]), P([-0.05 * s, shY - 0.07 * s])], { fill: o.collar, seed: o.seed + 80, line: 1.2, amp: 0.25 });
  // Arms hang clear of the hips.
  for (const side of [-1, 1]) {
    const x0 = side * b.shoulders * 0.95, x1 = side * Math.max(b.shoulders * 0.98, b.hips * 1.05 + 0.04 * k);
    const sh: Vec = [x0, shY - 0.04 * s], el: Vec = [x1, shY - b.upperArm], wr: Vec = [x1 - side * 0.01, shY - b.upperArm - b.forearm];
    if (o.limbless !== true) blob(v, band(sh, el, wr, 0.05 * k, 0.04 * k, 0.032 * k).map(P), { fill: side < 0 ? dark(sleeve, 0.1) : sleeve, seed: o.seed + 82 + side, line: 1.5, amp: 0.4 });
    blob(v, ellipsePts2(P([wr[0], wr[1] - 0.045 * s]), 0.032 * q.s * s, 0.05 * q.s * s), { fill: o.skin, seed: o.seed + 84 + side, line: 1.2, amp: 0.25 });
  }
  // Head: oval face, ears, eyes, a nose and a small mouth, hair framing it.
  const [hx, hy] = P([0, headY]);
  const r = R * q.s;
  blob(v, [P([-0.05 * s, shY + 0.04 * s]), P([0.05 * s, shY + 0.04 * s]), P([0.045 * s, headY - R * 0.6]), P([-0.045 * s, headY - R * 0.6])], { fill: dark(o.skin, 0.12), seed: o.seed + 86, line: 1.2, amp: 0.2 });
  if (o.hairdo === "bun") blob(v, ellipsePts2([hx, hy - r * 1.05], r * 0.42, r * 0.32), { fill: o.hair, seed: o.seed + 87, line: 1.3, amp: 0.3 });
  for (const side of [-1, 1]) blob(v, ellipsePts2([hx + side * r * 0.8, hy + r * 0.05], r * 0.14, r * 0.22), { fill: dark(o.skin, 0.08), seed: o.seed + 88 + side, line: 1.1, amp: 0.2 });
  blob(v, [[-0.78, -0.2], [-0.8, 0.35], [-0.5, 0.85], [0, 0.98], [0.5, 0.85], [0.8, 0.35], [0.78, -0.2], [0.55, -0.7], [0, -0.98], [-0.55, -0.7]].map(([fx, fy]): Vec2 => [hx + (fx ?? 0) * r, hy - (fy ?? 0) * r]), { fill: o.skin, light: light(o.skin, 0.18), seed: o.seed + 90, line: 1.7, amp: 0.35 });
  blob(v, [[-0.86, 0.1], [-0.82, 0.62], [-0.45, 1.02], [0.1, 1.08], [0.6, 0.95], [0.86, 0.55], [0.84, 0.1], [0.65, 0.42], [0.2, 0.62], [-0.35, 0.58], [-0.68, 0.4]].map(([fx, fy]): Vec2 => [hx + (fx ?? 0) * r, hy - (fy ?? 0) * r]), { fill: o.hair, light: light(o.hair, 0.15), seed: o.seed + 91, line: 1.3, amp: 0.35 });
  for (const side of [-1, 1]) {
    v.circle(hx + side * r * 0.34, hy - r * 0.05, Math.max(1.3, r * 0.08), { fill: "#1a1010" });
    stroke(v, [[hx + side * r * 0.2, hy - r * 0.25], [hx + side * r * 0.5, hy - r * 0.27]], { seed: o.seed + 93 + side, weight: 1.4, colour: dark(o.hair, 0.2), amp: 0.15 });
  }
  stroke(v, [[hx, hy + r * 0.05], [hx - r * 0.06, hy + r * 0.3], [hx + r * 0.05, hy + r * 0.33]], { seed: o.seed + 95, weight: 1.2, colour: dark(o.skin, 0.45), amp: 0.1 });
  stroke(v, [[hx - r * 0.2, hy + r * 0.55], [hx, hy + r * 0.6], [hx + r * 0.2, hy + r * 0.55]], { seed: o.seed + 96, weight: 1.3, colour: dark(o.skin, 0.5), amp: 0.1 });
}

function ellipsePts2(c: Vec2, rx: number, ry: number): Vec2[] {
  const pts: Vec2[] = [];
  for (let i = 0; i < 14; i++) {
    const a = (Math.PI * 2 * i) / 14;
    pts.push([c[0] + Math.cos(a) * rx, c[1] + Math.sin(a) * ry]);
  }
  return pts;
}
