// Yellow Room. From intra-game: "Yellow Room: walls, floor and ceiling all vibrant yellow. A single uncomfortable chair in the centre facing nothing in particular. Static blue sky with large fluffy clouds that never move."
// Exits (1): Solitude Cubes (edge-right).
// Someone keeps painting it yellow: over the plates, over the ceiling beam, over Ama
// (all but her eye). The chair faces a taped-off patch of wall marked NOTHING.
import type { Drawing, Vec2, View } from "@ianbicking/canvas-loop";
import { type RoomSpec, at, blob, ellipsePts, glow, hash, panelBand, panels, rivet, roundRectPts, stroke } from "./kit-tea.js";
import { placard } from "./parts-b-tea.js";
import { amaEye, amaSpeaker, citizen } from "./props-tea.js";
import { BACK_FOOT_Y, m } from "./sizes-tea.js";

const W = 4.6;
const YELLOW = "#f2c418", YELLOW_HI = "#ffe46a", YELLOW_LO = "#b8880a";
const CHAIR_X = 2.25, CHAIR_D = 1.3;

/** A roller's worth of fresh yellow: broad, uneven, a little see-through at the edges. */
function rollerCoat(v: View, x0: number, x1: number, y0: number, y1: number, seed: number): Drawing {
  const out: Drawing[] = [];
  for (let x = x0; x < x1; x += 34) {
    const top = y0 + hash(x, 0, seed) * 30;
    out.push(v.line(x + 17, top, x + 19, y1, { stroke: hash(x, 1, seed) < 0.5 ? YELLOW : YELLOW_HI, weight: 40, brush: { preset: "wash", opacity: 0.75 }, gesture: { seed: seed + x, wobble: 2 } }));
  }
  return out;
}

function paintWall(v: View): Drawing {
  const out: Drawing[] = [];
  const w = m(W), top = BACK_FOOT_Y - m(3);
  // Coat after coat over everything, plates and rivets included.
  out.push(rollerCoat(v, -10, w - 30, top, BACK_FOOT_Y, 2000));
  out.push(rollerCoat(v, 20, w - 60, top + 40, BACK_FOOT_Y - m(0.6), 2001));
  // Drips under the dado rail and at the plates' top edge.
  for (let i = 0; i < 14; i++) {
    const x = 30 + hash(i, 0, 2002) * (w - 60), y = BACK_FOOT_Y - m(i % 2 === 0 ? 1.0 : 0.5);
    out.push(stroke(v, [[x, y], [x + 1, y + 10 + hash(i, 1, 2003) * 26]], { seed: 2004 + i, weight: 4, colour: YELLOW_HI, amp: 0.4 }));
  }
  // NOTHING: a taped rectangle on the wall, which the chair faces.
  const [nx, ny] = at(3.55, 1.25, 0);
  const tape = "rgba(240,236,220,0.9)";
  for (const [a, b] of [[[-50, -60], [50, -60]], [[50, -60], [50, 60]], [[50, 60], [-50, 60]], [[-50, 60], [-50, -60]]] as const) out.push(stroke(v, [[nx + a[0], ny + a[1]], [nx + b[0], ny + b[1]]], { seed: 2010 + a[0] + b[1], weight: 6, colour: tape, amp: 0.8 }));
  out.push(v.text("NOTHING", { x: nx, y: ny - 8 }, { size: 13, fill: "#6a4a08", align: "center", valign: "middle", style: "bold" }));
  out.push(v.text("(in particular)", { x: nx, y: ny + 10 }, { size: 10, fill: "#6a4a08", align: "center", valign: "middle", style: "italic" }));
  // Clearance notice.
  const [cx, cy] = at(1.8, 2.2, 0);
  out.push(placard(v, cx, cy, ["THIS ROOM IS", "YELLOW CLEARANCE", "YOU ARE IN THIS ROOM"], { w: 150, size: 10, bg: "#1a1a1a", ink: "#f2c418", seed: 2020, rot: -0.03 }));
  const [sx, sy] = at(1.8, 1.8, 0);
  out.push(v.text("therefore...", { x: sx + 40, y: sy }, { size: 11, fill: "#4a3408", align: "center", valign: "middle", style: "italic" }));
  // Ama, painted over but for her eye.
  out.push(amaSpeaker(v, 3.05, 2.5));
  const [ax, ay] = at(3.05, 2.5, 0);
  out.push(v.ellipse(ax, ay, 26, 26, { fill: "rgba(242,196,24,0.72)" }));
  out.push(v.ellipse(ax, ay, 9, 9, { fill: "#2a1a1a" }));
  return out;
}

/** Paint the ceiling beam and the panel frames yellow too. */
function yellowCeiling(v: View, r: RoomSpec): Drawing {
  const out: Drawing[] = [];
  const w = m(W);
  const [y0, y1] = panelBand(r);
  out.push(blob(v, [[-10, y0 - 50], [w + 10, y0 - 50], [w + 10, y0 - 4], [-10, y0 - 4]], { fill: YELLOW, light: YELLOW_HI, dark: YELLOW_LO, seed: 2030, amp: 2, line: 2 }));
  for (let x = 12; x < w; x += 36) out.push(rivet(v, x, y0 - 14));
  for (const [i, [a, b]] of panels(r).entries()) {
    out.push(blob(v, [[a - 6, y0 - 8], [b + 6, y0 - 8], [b + 6, y1 + 8], [a - 6, y1 + 8]], { fill: YELLOW, light: YELLOW_HI, dark: YELLOW_LO, seed: 2031 + i, line: 2.4, amp: 1.2 }));
    out.push(blob(v, [[a, y0], [b, y0], [b, y1], [a, y1]], { fill: "#0e1018", seed: 2035 + i, line: 1.6, amp: 0.6 }));
  }
  return out;
}

/** A bar between two points, as an inked blob. */
function bar(v: View, p: Vec2, q: Vec2, w: number, seed: number, fill = "#e0a010"): Drawing {
  const len = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
  const nx = (-(q[1] - p[1]) / len) * w / 2, ny = ((q[0] - p[0]) / len) * w / 2;
  return blob(v, [[p[0] + nx, p[1] + ny], [q[0] + nx, q[1] + ny], [q[0] - nx, q[1] - ny], [p[0] - nx, p[1] - ny]], { fill, light: YELLOW_HI, dark: YELLOW_LO, seed, line: 2, amp: 0.4 });
}

/** The chair: back too tall and leaning in, seat tipped forward, one short leg on a folded shim. */
function chair(v: View): Drawing {
  const out: Drawing[] = [];
  const [px, py] = at(CHAIR_X, 0, CHAIR_D);
  out.push(v.ellipse(px, py, m(0.36), 7, { fill: "rgba(90,60,0,0.3)" }));
  const seatB: Vec2 = [px - m(0.24), py - m(0.56)], seatF: Vec2 = [px + m(0.26), py - m(0.48)];
  const topB: Vec2 = [px - m(0.2), py - m(1.55)];
  // Far legs first, darker.
  out.push(bar(v, [px - m(0.18), py - 2], [seatB[0] + 6, seatB[1]], 7, 2040, "#a87a08"));
  out.push(bar(v, [px + m(0.3), py - 2], [seatF[0] - 6, seatF[1]], 7, 2041, "#a87a08"));
  // The back post, leaning forward over the seat.
  out.push(bar(v, [px - m(0.26), py], topB, 10, 2042));
  for (let i = 0; i < 3; i++) {
    const u = 0.45 + i * 0.2;
    const sx = px - m(0.26) + (topB[0] - (px - m(0.26))) * u, sy = py + (topB[1] - py) * u;
    out.push(blob(v, roundRectPts(sx - 4, sy - 7, 22, 14, 3), { fill: YELLOW, light: YELLOW_HI, dark: YELLOW_LO, seed: 2043 + i, line: 1.8 }));
  }
  out.push(blob(v, roundRectPts(topB[0] - 8, topB[1] - 12, 34, 18, 5), { fill: YELLOW, light: YELLOW_HI, dark: YELLOW_LO, seed: 2046, line: 2.2 }));
  // Seat: a thin hard slab tipped forward, with a bolt standing proud.
  out.push(blob(v, [seatB, seatF, [seatF[0] + 2, seatF[1] + 10], [seatB[0], seatB[1] + 10]], { fill: YELLOW, light: YELLOW_HI, dark: YELLOW_LO, seed: 2047, line: 2.4, shadeSide: "bottom" }));
  out.push(v.circle(px, py - m(0.52) - 4, 3, { fill: "#8a8a90", stroke: "#241c17", weight: 1.2 }));
  // Near legs; the front one is short and stands on a folded shim.
  out.push(bar(v, [px - m(0.3), py], [seatB[0] + 4, seatB[1] + 8], 9, 2048));
  out.push(bar(v, [px + m(0.28), py - m(0.05)], [seatF[0], seatF[1] + 8], 9, 2049));
  out.push(blob(v, [[px + m(0.2), py], [px + m(0.36), py], [px + m(0.35), py - m(0.05)], [px + m(0.21), py - m(0.05)]], { fill: "#f0ece0", seed: 2050, line: 1.2 }));
  // Chips where the old orange shows through.
  for (let i = 0; i < 5; i++) out.push(v.circle(topB[0] + 6 + hash(i, 0, 2051) * 6, py - m(0.7) - hash(i, 1, 2052) * m(0.7), 2.2, { fill: "#d0601a" }));
  return out;
}

function furniture(v: View): Drawing {
  const out: Drawing[] = [];
  out.push(yellowCeiling(v, YELLOW_ROOM));
  // Paint tins and a tray by the left wall: SUNSHINE No. 5.
  for (const [i, x] of [0.32, 0.6].entries()) {
    const [px, py] = at(x, 0, 0.6 + i * 0.25);
    out.push(blob(v, [[px - 14, py], [px + 14, py], [px + 14, py - m(0.22)], [px - 14, py - m(0.22)]], { fill: "#d8d8d0", light: "#f0f0e8", dark: "#8a8a80", seed: 2060 + i, line: 1.8, shadeSide: "right" }));
    out.push(blob(v, [[px - 12, py - m(0.16)], [px + 12, py - m(0.16)], [px + 12, py - m(0.07)], [px - 12, py - m(0.07)]], { fill: YELLOW, seed: 2062 + i, line: 1 }));
    out.push(stroke(v, [[px - 14, py - m(0.22)], [px - 12, py - m(0.22) - 8], [px + 6, py - m(0.22) - 4]], { seed: 2064 + i, weight: 3, colour: YELLOW_HI, amp: 0.6 }));
  }
  const [lx, ly] = at(0.46, 0.08, 0.6);
  out.push(v.text("SUNSHINE No.5", { x: lx, y: ly - 18 }, { size: 6, fill: "#3a2a10", align: "center", valign: "middle", style: "bold" }));
  const [tx, ty] = at(1.0, 0, 1.0);
  out.push(blob(v, [[tx - 30, ty], [tx + 30, ty], [tx + 26, ty - 8], [tx - 26, ty - 8]], { fill: "#5a5a60", seed: 2056, line: 1.6 }));
  out.push(v.ellipse(tx, ty - 6, 22, 3, { fill: YELLOW_HI }));
  out.push(chair(v));
  // WET PAINT sign, on its own little stand.
  const [wx, wy] = at(1.75, 0, 2.3);
  out.push(stroke(v, [[wx, wy], [wx, wy - m(0.7)]], { seed: 2058, weight: 3, colour: "#6a6a70" }));
  out.push(placard(v, wx, wy - m(0.75), ["WET PAINT", "(SINCE 1979)"], { w: 80, size: 9, bg: "#f8f4e0", ink: "#c02a1a", seed: 2059, rot: 0.06 }));
  return out;
}

export const YELLOW_ROOM: RoomSpec = {
  id: "yellow-room",
  name: "Yellow Room",
  width: W,
  wall: "#ca8a04",
  trim: "#d8a018",
  sky: "still-clouds",
  floor: "lino",
  floorColour: "#d8b020",
  ambient: "#f4ecd4",
  exits: [
    { to: "Solitude Cubes", kind: "edge-right", label: "Solitude Cubes", glow: "#6366f1" },
  ],
  paintWall,
  paintFurniture: furniture,
  live: (v, t) => {
    const out: Drawing[] = [];
    out.push(glow(v, m(W) / 2, BACK_FOOT_Y - m(1.6), { rx: 380, ry: 300, colour: "#fff0a0", alpha: 0.22 }));
    // The clouds never move because the sky is paused.
    if (Math.floor(t / 20) % 2 === 1) {
      const [y0] = panelBand(YELLOW_ROOM);
      const [, b] = panels(YELLOW_ROOM)[1] ?? [0, 0];
      out.push(v.rect(b - 28, y0 + 8, 5, 16, { fill: "rgba(255,255,255,0.85)" }));
      out.push(v.rect(b - 19, y0 + 8, 5, 16, { fill: "rgba(255,255,255,0.85)" }));
    }
    // A fresh drip creeping down from the dado rail.
    const [dx, dy] = at(1.75, 1.0, 0);
    const len = 6 + ((t * 0.25) % 40);
    out.push(stroke(v, [[dx, dy], [dx, dy + len]], { seed: 2060, weight: 4, colour: YELLOW_HI, amp: 0 }));
    out.push(v.circle(dx, dy + len + 1, 3, { fill: YELLOW_HI }));
    // The painter, rolling another coat, roller going up and down the wall.
    const roll = 0.5 + 0.5 * Math.sin(t * 0.12);
    const [hx, hy] = at(0.95, 1.05, 1.1);
    const [rx, ry] = at(0.42, 1.1 + roll * 1.3, 0.05);
    out.push(stroke(v, [[hx, hy], [rx, ry]], { seed: 2061, weight: 3, colour: "#8a6a3a", amp: 0 }));
    out.push(blob(v, roundRectPts(rx - 8, ry - 18, 16, 36, 6), { fill: YELLOW_HI, seed: 2062, line: 1.8, amp: 0.3 }));
    out.push(citizen(v, { x: 1.05, depth: 1.1, facing: -1, pose: "stand", suit: "#c8a020", collar: "#ca8a04", number: "88", hair: "#6a4a2a" }, t));
    // A visitor contemplating NOTHING, leaning in now and then for a closer look.
    const lean = Math.floor(t / 80) % 2 === 1 ? 0.08 * Math.min(1, ((t % 80) / 20)) : 0;
    out.push(citizen(v, { x: 3.05 + lean, depth: 2.4, facing: 1, pose: "stand", suit: "#6a5a8a", collar: "#6366f1", number: "11" }, t));
    // Painted over too: a yellow film on the eye's casing, but the eye still glows.
    out.push(amaEye(v, 3.05, 2.5, t));
    const [ex, ey] = at(3.05, 2.5, 0);
    out.push(blob(v, ellipsePts(ex, ey, 3, 3), { fill: "rgba(255,90,60,0.5)", seed: 2063, line: 0.4 }));
    return out;
  },
  rim: { x: 334, y: 120, colour: "#fff4b0", reach: 600 },
};
