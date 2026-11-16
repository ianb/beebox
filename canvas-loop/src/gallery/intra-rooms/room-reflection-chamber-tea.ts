// Reflection Chamber. From intra-game: "Reflection Chamber: padded treatment chairs, a metal waiting bench, and a screen on which Ama demonstrates how to sit comfortably, in a chair unlike any in the room. Nothing starts merely because someone sits down. Ama speaks through every intercom. An open passage leads to the Utility Closet; the door back to the Hallway opens from this side."
// Exits (2): Hallway (edge-left), Utility Closet (edge-right).
//
// Two tufted vinyl treatment chairs with straps and a hood on an arm (one
// re-covered in orange, NEW!); a perforated metal bench under a take-a-number
// machine that is always serving 00; a big screen where Ama, a figure with a red
// eye for a head, sits down in a floral wingback armchair; an eye chart; a cable
// marked SENTRA running off into the closet.
import type { Drawing, Vec2, View } from "@ianbicking/canvas-loop";
import { type RoomSpec, at, blob, ellipsePts, glow, hash, mixHex, rivet, roundRectPts, stroke } from "./kit-tea.js";
import { cable, stencil } from "./parts-c-tea.js";
import { amaEye, amaSpeaker, citizen, poster, tubeGlow, tubeLight } from "./props-tea.js";
import { m } from "./sizes-tea.js";

/** A reclining treatment chair, facing right, on a hydraulic column. */
function treatmentChair(v: View, x: number, depth: number, a: { colour: string; seed: number; fresh?: boolean }): Drawing {
  const out: Drawing[] = [];
  const [px, py] = at(x, 0, depth);
  const c = a.colour, s = a.seed;
  const hi = mixHex(c, "#ffffff", 0.3), lo = mixHex(c, "#000000", 0.35);
  const P = (dx: number, h: number): Vec2 => [px + m(dx), py - m(h)];
  out.push(blob(v, ellipsePts(px, py - 4, m(0.32), 7), { fill: "#8a9096", seed: s, line: 1.8 }));
  out.push(blob(v, [P(-0.07, 0.02), P(0.07, 0.02), P(0.05, 0.42), P(-0.05, 0.42)], { fill: "#c8ccd0", light: "#ffffff", dark: "#6a7076", seed: s + 1, line: 1.8, shadeSide: "right" }));
  for (let k = 1; k < 4; k++) out.push(stroke(v, [P(-0.06, k * 0.1), P(0.06, k * 0.1)], { seed: s + 2 + k, weight: 1, amp: 0.2 }));
  // Hood on its arm, behind the backrest.
  out.push(stroke(v, [P(-0.55, 0.62), P(-0.72, 1.45), P(-0.42, 1.62)], { seed: s + 10, weight: 5, colour: "#9aa0a6" }));
  out.push(blob(v, [P(-0.6, 1.5), P(-0.22, 1.56), P(-0.16, 1.4), P(-0.26, 1.3), P(-0.58, 1.32)], { fill: "#d8dcd8", light: "#ffffff", dark: "#8a908a", seed: s + 11, line: 2, shadeSide: "bottom" }));
  for (let k = 0; k < 3; k++) out.push(v.circle(px + m(-0.48 + k * 0.1), py - m(1.36), 2.4, { fill: k === 1 ? "#e84a3a" : "#4a4e54" }));
  out.push(stroke(v, [P(-0.4, 1.32), P(-0.46, 1.1), P(-0.55, 0.9)], { seed: s + 12, weight: 1.6, colour: "#2a2a2e" }));
  // Backrest, reclined, tufted.
  const back: Vec2[] = [P(-0.36, 0.5), P(-0.08, 0.58), P(-0.38, 1.24), P(-0.52, 1.28), P(-0.66, 1.2)];
  out.push(blob(v, back, { fill: c, light: hi, dark: lo, seed: s + 20, line: 2.2, shadeSide: "right" }));
  out.push(blob(v, [P(-0.58, 1.18), P(-0.42, 1.24), P(-0.4, 1.36), P(-0.6, 1.32)], { fill: c, light: hi, seed: s + 21, line: 1.8 }));
  // Seat and leg rest.
  out.push(blob(v, [P(-0.36, 0.42), P(0.28, 0.44), P(0.3, 0.6), P(-0.3, 0.6)], { fill: c, light: hi, dark: lo, seed: s + 22, line: 2.2, shadeSide: "bottom" }));
  out.push(blob(v, [P(0.24, 0.44), P(0.3, 0.6), P(0.72, 0.42), P(0.68, 0.3)], { fill: c, light: hi, dark: lo, seed: s + 23, line: 2.2, shadeSide: "bottom" }));
  for (const [dx, h] of [[-0.42, 0.85], [-0.48, 1.0], [-0.36, 0.72], [-0.1, 0.52], [0.1, 0.52], [0.44, 0.47]] as const) {
    out.push(v.circle(px + m(dx), py - m(h), 2.2, { fill: lo }));
    out.push(v.circle(px + m(dx) - 0.6, py - m(h) - 0.6, 0.8, { fill: hi }));
  }
  // Armrest with a strap hanging open.
  out.push(blob(v, roundRectPts(px - m(0.3), py - m(0.8), m(0.5), m(0.07), 4), { fill: lo, seed: s + 30, line: 1.8 }));
  out.push(stroke(v, [P(-0.3, 0.78), P(-0.26, 0.6), P(-0.3, 0.48)], { seed: s + 31, weight: 1.4, colour: INK_STRAP }));
  out.push(stroke(v, [P(0.0, 0.78), P(0.05, 0.62), P(0.02, 0.5)], { seed: s + 32, weight: 5, colour: "#5a3a24" }));
  out.push(blob(v, roundRectPts(px + m(0.0), py - m(0.62), 10, 8, 2), { fill: "#c8ccd0", seed: s + 33, line: 1, amp: 0.2 }));
  if (a.fresh === true) out.push(v.at({ translate: P(0.1, 0.52), rotate: -0.2 }, [
    blob(v, ellipsePts(0, 0, 18, 11), { fill: "#f8f048", seed: s + 40, line: 1.2, amp: 0.4 }),
    v.text("NEW!", { x: 0, y: 0 }, { size: 8, fill: "#d02a2a", align: "center", valign: "middle", style: "bold" }),
  ]));
  return out;
}
const INK_STRAP = "#3a2a1a";

/** The screen Ama demonstrates on: a 70s rounded bezel. Its picture is drawn per frame. */
const SCREEN = { x: 3.95, h0: 1.55, h1: 2.6, w: 1.7 };
function screenRect(): { x: number; y: number; w: number; h: number } {
  const [x0, y0] = at(SCREEN.x - SCREEN.w / 2, SCREEN.h1, 0), [x1, y1] = at(SCREEN.x + SCREEN.w / 2, SCREEN.h0, 0);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
function screenFrame(v: View): Drawing {
  const out: Drawing[] = [];
  const r = screenRect();
  out.push(blob(v, roundRectPts(r.x - 18, r.y - 16, r.w + 36, r.h + 40, 22), { fill: "#d8d4c8", light: "#f0ece0", dark: "#8a8478", seed: 4000, line: 2.6 }));
  out.push(blob(v, roundRectPts(r.x - 4, r.y - 4, r.w + 8, r.h + 8, 16), { fill: "#1a1c20", seed: 4001, line: 2 }));
  for (let k = 0; k < 4; k++) out.push(v.circle(r.x + r.w - 20 - k * 18, r.y + r.h + 12, 4, { fill: k === 0 ? "#e84a3a" : "#5a5650" }));
  out.push(v.text("AMA-VISION", { x: r.x + 40, y: r.y + r.h + 12 }, { size: 8, fill: "#5a5650", align: "center", valign: "middle", style: "bold" }));
  for (const dx of [r.w * 0.3, r.w * 0.7]) out.push(stroke(v, [[r.x + dx, r.y - 16], [r.x + dx, r.y - 60]], { seed: 4002 + dx, weight: 3, colour: "#6a6e72" }));
  return out;
}

/** The demonstration, a loop: Ama walks in, sits in a floral wingback, stays. */
const LOOP = 300;
function demonstration(v: View, t: number): Drawing {
  const r = screenRect();
  const p = t % LOOP;
  return [
    v.mask(v.roundRect(r.x, r.y, r.w, r.h, 14, { fill: "#000" }), ((): Drawing => {
      const drawn: Drawing[] = [];
      drawn.push(v.rect(r.x, r.y, r.w, r.h, { fill: v.linearGradient(0, r.y, 0, r.y + r.h, [[0, "#e8d8b8"], [0.72, "#d8c098"], [0.73, "#8a6a4a"], [1, "#6a4a30"]]) }));
      // A window with curtains: a home, somewhere else.
      drawn.push(v.rect(r.x + 26, r.y + 18, 54, 44, { fill: "#9ad0f0" }));
      drawn.push(v.rect(r.x + 18, r.y + 14, 16, 54, { fill: "#d87a6a" }));
      drawn.push(v.rect(r.x + 72, r.y + 14, 16, 54, { fill: "#d87a6a" }));
      // The wingback: wide, plush, roses.
      const cx = r.x + r.w * 0.62, fy = r.y + r.h * 0.8;
      drawn.push(v.roundRect(cx - 46, fy - 96, 92, 96, 22, { fill: "#c85a7a" }));
      drawn.push(v.roundRect(cx - 58, fy - 54, 24, 54, 10, { fill: "#b04a6a" }));
      drawn.push(v.roundRect(cx + 34, fy - 54, 24, 54, 10, { fill: "#b04a6a" }));
      drawn.push(v.roundRect(cx - 36, fy - 40, 72, 22, 8, { fill: "#d87090" }));
      for (let k = 0; k < 7; k++) drawn.push(v.circle(cx - 34 + hash(k, 0, 4010) * 68, fy - 90 + hash(k, 1, 4010) * 44, 4, { fill: "#f8d0d8" }));
      for (const lx of [cx - 46, cx + 40]) drawn.push(v.rect(lx, fy, 6, 10, { fill: "#4a2a1a" }));
      // Ama: a figure with a red eye for a head.
      const walkIn = Math.min(1, p / 90);
      const sit = p < 90 ? 0 : Math.min(1, (p - 90) / 40);
      const ax = r.x + 20 + walkIn * (cx - r.x - 20), ay = fy - sit * 30;
      const leg = p < 90 ? Math.sin(p * 0.4) * 6 : 0;
      drawn.push(v.line(ax, ay - 34, ax - 4 + leg, ay, { stroke: "#f0f0f0", weight: 7 }));
      drawn.push(v.line(ax, ay - 34, ax + 4 - leg + sit * 16, ay - sit * 4, { stroke: "#f0f0f0", weight: 7 }));
      drawn.push(v.roundRect(ax - 12, ay - 76, 24, 44, 9, { fill: "#f0f0f0" }));
      drawn.push(v.circle(ax, ay - 90, 13, { fill: "#f0f0f0" }));
      drawn.push(v.circle(ax, ay - 90, 7, { fill: "#e83a2a" }));
      drawn.push(v.circle(ax, ay - 90, 2.5, { fill: "#2a0a0a" }));
      // Captions.
      const step = p < 90 ? "1. APPROACH THE CHAIR" : p < 160 ? "2. SIT COMFORTABLY" : "3. CONTINUE SITTING";
      drawn.push(v.rect(r.x, r.y + r.h - 22, r.w, 22, { fill: "rgba(20,20,40,0.75)" }));
      drawn.push(v.text(step, { x: r.x + r.w / 2, y: r.y + r.h - 11 }, { size: 11, fill: "#fff8d0", align: "center", valign: "middle", style: "bold" }));
      if (p > 200 && Math.floor(t / 12) % 2 === 0) drawn.push(v.text("YOU ARE DOING GREAT", { x: r.x + r.w * 0.33, y: r.y + 86 }, { size: 9, fill: "#c83a3a", align: "center", valign: "middle", style: "bold" }));
      for (let y = r.y; y < r.y + r.h; y += 3) drawn.push(v.line(r.x, y, r.x + r.w, y, { stroke: "rgba(0,0,0,0.12)", weight: 1 }));
      if (hash(Math.floor(t / 4), 0, 4020) < 0.06) drawn.push(v.rect(r.x, r.y + hash(t, 1, 4021) * r.h, r.w, 6, { fill: "rgba(255,255,255,0.4)" }));
      return drawn;
    })()),
    glow(v, r.x + r.w / 2, r.y + r.h, { rx: r.w * 0.8, ry: 150, colour: "#ffe0b0", alpha: 0.2 }),
  ];
}

function eyeChart(v: View, x: number): Drawing {
  const out: Drawing[] = [];
  const [cx, cy] = at(x, 1.72, 0);
  out.push(blob(v, [[cx - 40, cy - 60], [cx + 40, cy - 60], [cx + 40, cy + 60], [cx - 40, cy + 60]], { fill: "#f4f0e4", seed: 4100, line: 1.8 }));
  const rows = [["T", 26], ["RU", 18], ["STA", 13], ["MAAL", 10], ["WAYS", 7]] as const;
  let y = cy - 44;
  for (const [txt, size] of rows) {
    out.push(v.text(txt.split("").join(" "), { x: cx, y }, { size, fill: "#1a1a1a", align: "center", valign: "middle", style: "bold", font: "Helvetica, Arial, sans-serif" }));
    y += size + 7;
  }
  return out;
}

/** The take-a-number machine and the NOW SERVING board (its digits drawn per frame). */
const BOARD: [number, number] = [1.3, 2.25];
function numbers(v: View): Drawing {
  const out: Drawing[] = [];
  const [bx, by] = at(BOARD[0], BOARD[1], 0);
  out.push(blob(v, roundRectPts(bx - 52, by - 24, 104, 48, 6), { fill: "#2a2a2e", seed: 4200, line: 2 }));
  out.push(v.text("NOW SERVING", { x: bx, y: by - 15 }, { size: 7, fill: "#c8c8c0", align: "center", valign: "middle", style: "bold" }));
  const [dx, dy] = at(0.55, 1.25, 0);
  out.push(blob(v, [[dx - 14, dy - 26], [dx + 14, dy - 26], [dx + 18, dy + 22], [dx - 18, dy + 22]], { fill: "#c83a2a", light: "#e85a4a", seed: 4201, line: 2 }));
  out.push(v.rect(dx - 8, dy + 10, 16, 4, { fill: "#1a1a1a" }));
  out.push(v.at({ translate: [dx + 2, dy + 18], rotate: 0.2 }, v.rect(-6, 0, 12, 16, { fill: "#f4f0e4" })));
  out.push(stencil(v, "TAKE A", { x: dx, y: dy - 14 }, { size: 6, colour: "#ffffff" }));
  out.push(stencil(v, "NUMBER", { x: dx, y: dy - 5 }, { size: 6, colour: "#ffffff" }));
  return out;
}

/** A perforated metal bench along the wall. */
function metalBench(v: View, x: number, depth: number, w: number): Drawing {
  const out: Drawing[] = [];
  const [px, py] = at(x, 0, depth);
  const hw = m(w) / 2;
  for (const lx of [px - hw + 10, px + hw - 16]) out.push(blob(v, [[lx, py], [lx + 6, py], [lx + 6, py - m(0.44)], [lx, py - m(0.44)]], { fill: "#5a5e64", seed: 4300 + lx, line: 1.6 }));
  out.push(blob(v, roundRectPts(px - hw, py - m(0.48), 2 * hw, m(0.06), 3), { fill: "#a8aeb4", light: "#d8dce0", dark: "#5a5e64", seed: 4310, line: 2 }));
  out.push(blob(v, [[px - hw + 4, py - m(0.48)], [px + hw - 4, py - m(0.48)], [px + hw - 4, py - m(0.9)], [px - hw + 4, py - m(0.9)]], { fill: "#9aa0a6", light: "#c8ccd0", dark: "#5a5e64", seed: 4311, line: 2 }));
  for (let i = 0; i < Math.floor((2 * hw - 20) / 14); i++) for (let j = 0; j < 3; j++) out.push(v.circle(px - hw + 16 + i * 14, py - m(0.84) + j * 16, 2.4, { fill: "#4a4e54" }));
  out.push(rivet(v, px - hw + 8, py - m(0.86)));
  out.push(rivet(v, px + hw - 8, py - m(0.86)));
  return out;
}

function wallPieces(v: View): Drawing {
  const out: Drawing[] = [];
  out.push(tubeLight(v, 1.6, 2.75, 1.2));
  out.push(tubeLight(v, 5.6, 2.75, 1.2));
  out.push(numbers(v));
  out.push(screenFrame(v));
  out.push(eyeChart(v, 6.1));
  out.push(poster(v, 2.6, "report", { h: 1.75 }));
  out.push(amaSpeaker(v, 1.95, 2.3));
  out.push(amaSpeaker(v, 5.45, 2.3));
  // Nothing starts merely because someone sits down.
  const [sx, sy] = at(3.95, 1.2, 0);
  out.push(blob(v, roundRectPts(sx - 66, sy - 15, 132, 30, 3), { fill: "#f4f0e4", seed: 4400, line: 1.6 }));
  out.push(v.text("SITTING DOWN DOES NOT", { x: sx, y: sy - 5 }, { size: 7, fill: "#2a2a2e", align: "center", valign: "middle", style: "bold" }));
  out.push(v.text("START TREATMENT", { x: sx, y: sy + 5 }, { size: 7, fill: "#c83a2a", align: "center", valign: "middle", style: "bold" }));
  // The SENTRA cable, clipped along the wall into the closet passage.
  const run: Vec2[] = [at(5.2, 0.62, 0), at(5.9, 0.6, 0), at(6.5, 0.64, 0), at(7.05, 0.6, 0)];
  out.push(cable(v, run, { seed: 4410, colour: "#1c1814", weight: 5 }));
  for (const p of run.slice(0, 3)) out.push(v.rect(p[0] - 3, p[1] - 6, 6, 12, { fill: "#8a8e94" }));
  out.push(stencil(v, "SENTRA", { x: at(6.2, 0.75, 0)[0], y: at(6.2, 0.75, 0)[1] }, { size: 8, colour: "#e8b83a" }));
  return out;
}

function furniture(v: View): Drawing {
  return [
    metalBench(v, 1.35, 0.5, 1.5),
    treatmentChair(v, 2.85, 1.35, { colour: "#4a8a7a", seed: 4500 }),
    treatmentChair(v, 5.15, 1.35, { colour: "#c8682a", seed: 4600, fresh: true }),
  ];
}

export const REFLECTION_CHAMBER: RoomSpec = {
  id: "reflection-chamber",
  name: "Reflection Chamber",
  width: 7.0,
  wall: "#4b5563",
  trim: "#2a3a3a",
  sky: "dead",
  dead: [0, 1, 2],
  floor: "lino",
  floorColour: "#8a9a8a",
  ambient: "#a8b4c4",
  freshPaint: { from: 0.2, to: 2.2, colour: "#9ad0c0" },
  exits: [
    { to: "Hallway", kind: "edge-left", label: "Hallway", glow: "#34d399" },
    { to: "Utility Closet", kind: "edge-right", style: "open", label: "Utility Closet", glow: "#d97706" },
  ],
  paintWall: wallPieces,
  paintFurniture: furniture,
  live: (v, t) => {
    const out: Drawing[] = [];
    out.push(tubeGlow(v, 1.6, 2.75, t, { colour: "#e0fff0" }));
    out.push(tubeGlow(v, 5.6, 2.75, t, { colour: "#e0fff0", flicker: true }));
    out.push(demonstration(v, t));
    const [bx, by] = at(BOARD[0], BOARD[1], 0);
    const blank = hash(Math.floor(t / 5), 0, 4700) < 0.1;
    out.push(v.text(blank ? "--" : "00", { x: bx, y: by + 6 }, { size: 22, fill: "#ff4a2a", align: "center", valign: "middle", style: "bold", font: "Courier New, monospace" }));
    out.push(glow(v, bx, by + 6, { rx: 40, ry: 20, colour: "#ff4a2a", alpha: 0.3 }));
    out.push(amaEye(v, 1.95, 2.3, t));
    out.push(amaEye(v, 5.45, 2.3, t));
    out.push(citizen(v, { x: 1.05, depth: 0.55, facing: 1, pose: "sit", suit: "#6a6e74", collar: "#4b5563", number: "96", skin: "#a87050" }, t));
    return out;
  },
};
