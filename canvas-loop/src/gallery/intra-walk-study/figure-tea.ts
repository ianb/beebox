// Drawing a pose from gait-tea.ts: a citizen in a jumpsuit, hand-inked, with the
// far-side limbs a shade darker and behind the body. Also the bare skeleton.
import type { Vec2, View } from "@ianbicking/canvas-loop";
import { INK, blob, ellipsePts } from "./ink-tea.js";
import type { Arm, Leg, Pose, Vec } from "./gait-tea.js";

export function mixHex(a: string, b: string, t: number): string {
  const pa = Number.parseInt(a.slice(1), 16), pb = Number.parseInt(b.slice(1), 16);
  const ch = (p: number, s: number): number => (p >> s) & 255;
  const c = [16, 8, 0].map((s) => Math.round(ch(pa, s) + (ch(pb, s) - ch(pa, s)) * t));
  return `#${c.map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

export interface Look {
  suit: string;
  collar: string;
  skin: string;
  hair: string;
  seed: number;
}
export const LOOK: Look = { suit: "#3a6a9a", collar: "#e8b83a", skin: "#c58a62", hair: "#2e1d15", seed: 900 };

/** A rounded limb from a to b, radius ra at a and rb at b. */
function capsule(a: Vec2, b: Vec2, ra: number, rb: number): Vec2[] {
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const pts: Vec2[] = [];
  for (let i = 0; i <= 6; i++) {
    const t = ang - Math.PI / 2 + (Math.PI * i) / 6;
    pts.push([b[0] + Math.cos(t) * rb, b[1] + Math.sin(t) * rb]);
  }
  for (let i = 0; i <= 6; i++) {
    const t = ang + Math.PI / 2 + (Math.PI * i) / 6;
    pts.push([a[0] + Math.cos(t) * ra, a[1] + Math.sin(t) * ra]);
  }
  return pts;
}

interface Place {
  x: number;
  y: number;
  /** px per metre. */
  s: number;
  facing: 1 | -1;
}
function toPx(q: Place): (v: Vec) => Vec2 {
  return (v) => [q.x + v[0] * q.s * q.facing, q.y - v[1] * q.s];
}

function drawLeg(v: View, l: Leg, P: (v: Vec) => Vec2, a: { suit: string; seed: number; s: number }): void {
  const r = (mm: number): number => mm * a.s;
  blob(v, capsule(P(l.hip), P(l.knee), r(0.075), r(0.058)), { fill: a.suit, seed: a.seed, line: 1.6, amp: 0.5 });
  blob(v, capsule(P(l.knee), P(l.ankle), r(0.056), r(0.044)), { fill: a.suit, seed: a.seed + 1, line: 1.6, amp: 0.5 });
  // The boot: heel, ball, toe and up the back of the ankle.
  const up: Vec = [l.ankle[0] - 0.02, l.ankle[1] + 0.05];
  blob(v, [P(up), P(l.heel), P(l.ball), P(l.toe), P([l.ankle[0] + 0.06, l.ankle[1] + 0.01])], { fill: "#1a1410", seed: a.seed + 2, line: 1.2, amp: 0.3 });
}

function drawArm(v: View, arm: Arm, P: (v: Vec) => Vec2, a: { suit: string; skin: string; seed: number; s: number }): void {
  const r = (mm: number): number => mm * a.s;
  blob(v, capsule(P(arm.shoulder), P(arm.elbow), r(0.05), r(0.042)), { fill: a.suit, seed: a.seed, line: 1.5, amp: 0.4 });
  blob(v, capsule(P(arm.elbow), P(arm.wrist), r(0.04), r(0.033)), { fill: a.suit, seed: a.seed + 1, line: 1.5, amp: 0.4 });
  blob(v, capsule(P(arm.wrist), P(arm.hand), r(0.03), r(0.026)), { fill: a.skin, seed: a.seed + 2, line: 1.2, amp: 0.3 });
}

/** A citizen in this pose, feet on (x, y), `s` px per metre. */
export function walker(v: View, ps: Pose, q: Place, look: Look = LOOK): void {
  const P = toPx(q);
  const far = mixHex(look.suit, "#000000", 0.3), near = look.suit;
  const s = q.s;
  v.ellipse(P([ps.pelvis[0], 0])[0], q.y, 0.2 * s, 0.04 * s, { fill: "rgba(0,0,0,0.35)" });
  drawArm(v, ps.farArm, P, { suit: far, skin: mixHex(look.skin, "#000000", 0.25), seed: look.seed + 10, s });
  drawLeg(v, ps.far, P, { suit: far, seed: look.seed + 20, s });
  // Trunk: hips to shoulders, a little fuller at the chest.
  const sh = ps.nearArm.shoulder, pv = ps.pelvis;
  const trunk: Vec[] = [[pv[0] - 0.1, pv[1] - 0.06], [pv[0] + 0.11, pv[1] - 0.06], [sh[0] + 0.12, sh[1] - 0.12], [sh[0] + 0.07, sh[1] + 0.04], [sh[0] - 0.1, sh[1] + 0.03], [sh[0] - 0.12, sh[1] - 0.16]];
  blob(v, trunk.map(P), { fill: near, light: mixHex(near, "#ffffff", 0.22), dark: mixHex(near, "#000000", 0.3), shadeSide: q.facing > 0 ? "left" : "right", seed: look.seed + 30, line: 2 });
  const belt: Vec[] = [[pv[0] - 0.11, pv[1] + 0.06], [pv[0] + 0.12, pv[1] + 0.07], [pv[0] + 0.12, pv[1] + 0.03], [pv[0] - 0.11, pv[1] + 0.02]];
  blob(v, belt.map(P), { fill: "#2a2420", seed: look.seed + 31, line: 1, amp: 0.2 });
  const collar: Vec[] = [[sh[0] - 0.09, sh[1] + 0.04], [sh[0] + 0.08, sh[1] + 0.05], [sh[0] + 0.05, sh[1] - 0.03], [sh[0] - 0.07, sh[1] - 0.03]];
  blob(v, collar.map(P), { fill: look.collar, seed: look.seed + 32, line: 1.3, amp: 0.3 });
  drawLeg(v, ps.near, P, { suit: near, seed: look.seed + 40, s });
  // Head, tipped by the nod: face forward, hair over the back.
  const [hx, hy] = P(ps.head);
  v.at({ translate: [hx, hy], rotate: ps.nod * q.facing, scale: [q.facing, 1] }, () => {
    const R = 0.105 * s;
    blob(v, ellipsePts(0, 0, R * 0.92, R * 1.1, 14), { fill: look.skin, light: mixHex(look.skin, "#ffffff", 0.2), seed: look.seed + 50, line: 1.8, amp: 0.5 });
    blob(v, [[-R * 0.95, R * 0.1], [-R * 0.9, -R * 0.8], [-R * 0.1, -R * 1.18], [R * 0.75, -R * 0.75], [R * 0.2, -R * 0.55], [-R * 0.3, -R * 0.2]], { fill: look.hair, seed: look.seed + 51, line: 1.3, amp: 0.4 });
    v.circle(R * 0.55, -R * 0.12, Math.max(1.2, R * 0.08), { fill: "#1a1010" });
    v.line(R * 0.86, -R * 0.05, R * 1.02, R * 0.22, { stroke: INK, weight: 1.4 });
  });
  drawArm(v, ps.nearArm, P, { suit: mixHex(near, "#000000", 0.08), skin: look.skin, seed: look.seed + 60, s });
}

/** The bare rig: bones as lines, joints as dots. */
export function skeleton(v: View, ps: Pose, q: Place, a: { colour: string; weight?: number }): void {
  const P = toPx(q);
  const w = a.weight ?? 2;
  const line = (pts: Vec[], c: string): void => {
    for (let i = 1; i < pts.length; i++) {
      const p0 = pts[i - 1], p1 = pts[i];
      if (!p0 || !p1) continue;
      const [x0, y0] = P(p0), [x1, y1] = P(p1);
      v.line(x0, y0, x1, y1, { stroke: c, weight: w });
    }
    for (const p of pts) {
      const [x, y] = P(p);
      v.circle(x, y, w * 1.3, { fill: c });
    }
  };
  const farC = mixHex(a.colour, "#ffffff", 0.5);
  line([ps.farArm.shoulder, ps.farArm.elbow, ps.farArm.wrist, ps.farArm.hand], farC);
  line([ps.far.hip, ps.far.knee, ps.far.ankle, ps.far.heel, ps.far.ball, ps.far.toe], farC);
  line([ps.pelvis, ps.nearArm.shoulder, ps.neck, ps.head], a.colour);
  line([ps.near.hip, ps.near.knee, ps.near.ankle, ps.near.heel, ps.near.ball, ps.near.toe], a.colour);
  line([ps.nearArm.shoulder, ps.nearArm.elbow, ps.nearArm.wrist, ps.nearArm.hand], a.colour);
}
