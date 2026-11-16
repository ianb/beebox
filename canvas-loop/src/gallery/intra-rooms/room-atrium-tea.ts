// The Hollow Atrium: "A large, open room lit by an orange glow from the sky screens
// above, which display an unchanging sunset. Dusty statues of citizens stand along
// the walls, their faces worn smooth. The sound of distant thunder plays
// occasionally, though no storm ever arrives."
// Exits (5): Foyer (left), Activity Hub (right), Hallway and Archive Lounge
// (arches in the back wall), Solitude Cubes (stairs down).
import type { Drawing, Vec2, View } from "@ianbicking/canvas-loop";
import { type RoomSpec, at, blob, ellipsePts, glow, hash, stroke } from "./kit-tea.js";
import { amaEye, amaSpeaker, bunting, citizen, pacing, plant, poster } from "./props-tea.js";
import { m } from "./sizes-tea.js";

/** A citizen in sandstone, worn faceless, on a plinth. `pose` 0 arms down, 1 an arm raised, 2 hooded. */
function statue(v: View, x: number, pose: number, seed: number): Drawing {
  const out: Drawing[] = [];
  const [px, py] = at(x, 0, 0.45);
  const h = m(2.2), pw = m(0.34);
  out.push(blob(v, [[px - pw, py], [px + pw, py], [px + pw - 4, py - m(0.42)], [px - pw + 4, py - m(0.42)]], { fill: "#9a8a76", light: "#bcaa92", dark: "#5a4c40", seed, line: 2.2, shadeSide: "right" }));
  const top = py - m(0.42);
  const robe: Vec2[] = [[px - m(0.27), top], [px + m(0.27), top], [px + m(0.22), top - h * 0.55], [px + m(0.2), top - h * 0.68], [px + m(0.08), top - h * 0.72], [px - m(0.08), top - h * 0.72], [px - m(0.2), top - h * 0.68], [px - m(0.22), top - h * 0.55]];
  out.push(blob(v, robe, { fill: "#c6a07a", light: "#e0c09a", dark: "#7a5a46", seed: seed + 1, line: 2.2, shadeSide: "right" }));
  for (let i = 0; i < 5; i++) out.push(stroke(v, [[px - m(0.16) + i * m(0.08), top - h * 0.4], [px - m(0.17) + i * m(0.08), top - 4]], { seed: seed + 2 + i, weight: 1.6, colour: "#8a6a50", amp: 0.8 }));
  const headY = top - h * 0.8;
  if (pose === 2) out.push(blob(v, [[px - m(0.14), top - h * 0.7], [px - m(0.12), headY - m(0.14)], [px + m(0.04), headY - m(0.18)], [px + m(0.14), headY - m(0.06)], [px + m(0.14), top - h * 0.7]], { fill: "#bc9670", light: "#dcb890", seed: seed + 8, line: 2.2 }));
  else out.push(blob(v, ellipsePts(px, headY, m(0.1), m(0.13)), { fill: "#c6a07a", light: "#e8c8a2", seed: seed + 8, line: 2.2 }));
  if (pose === 1) out.push(blob(v, [[px + m(0.16), top - h * 0.66], [px + m(0.24), top - h * 0.66], [px + m(0.26), top - h * 1.02], [px + m(0.18), top - h * 1.02]], { fill: "#c6a07a", light: "#e0c09a", seed: seed + 9, line: 2 }));
  // Dust on the shoulders and head.
  for (const [dx, dy] of [[-0.14, h * 0.69], [0.12, h * 0.69]] as const) out.push(stroke(v, [[px + m(dx) - 10, top - dy], [px + m(dx) + 10, top - dy]], { seed: seed + 20 + dx * 10, weight: 2.5, colour: "#e8dcc8", amp: 0.5 }));
  if (pose !== 2) out.push(stroke(v, [[px - 8, headY - m(0.12)], [px + 8, headY - m(0.12)]], { seed: seed + 30, weight: 2.5, colour: "#e8dcc8", amp: 0.4 }));
  return out;
}

function wallPieces(v: View): Drawing {
  const drawn: Drawing[] = [];
  drawn.push(bunting(v, 1.4, 7.6, 3.15));
  drawn.push(statue(v, 1.9, 0, 1000));
  drawn.push(statue(v, 4.5, 1, 1040));
  drawn.push(statue(v, 7.4, 2, 1080));
  // Citizen of the Month: every month crossed out.
  const [px, py] = at(4.5, 0.21, 0.5);
  drawn.push(blob(v, [[px - 46, py - 12], [px + 46, py - 12], [px + 46, py + 12], [px - 46, py + 12]], { fill: "#c8a85a", seed: 1100, line: 1.6 }));
  drawn.push(v.text("CITIZEN OF THE MONTH", { x: px, y: py - 4 }, { size: 7, fill: "#3a2a10", align: "center", valign: "middle", style: "bold" }));
  for (let i = 0; i < 6; i++) drawn.push(v.line(px - 40 + i * 14, py + 4, px - 32 + i * 14, py + 8, { stroke: "#8a1a1a", weight: 1.4 }));
  drawn.push(poster(v, 6.3, "smile", { h: 1.5 }));
  drawn.push(amaSpeaker(v, 8.3, 2.7));
  drawn.push(plant(v, 0.75, 0.6, { h: 1.0, leaf: "#e05a3a" }));
  return drawn;
}

export const ATRIUM: RoomSpec = {
  id: "hollow-atrium",
  name: "The Hollow Atrium",
  width: 8.8,
  ceiling: 3.6,
  wall: "#f97316",
  trim: "#6a3a1a",
  sky: "sunset",
  dead: [1],
  floor: "terrazzo",
  floorColour: "#a88a6a",
  ambient: "#a89ab0",
  exits: [
    { to: "Foyer", kind: "edge-left", label: "Foyer", glow: "#10b981" },
    { to: "Activity Hub", kind: "edge-right", label: "Activity Hub", glow: "#06b6d4" },
    { to: "Hallway", kind: "door", x: 3.2, style: "arch", label: "Hallway", glow: "#34d399" },
    { to: "Archive Lounge", kind: "door", x: 5.9, style: "arch", label: "Archive Lounge", glow: "#3b82f6" },
    { to: "Solitude Cubes", kind: "stairs-down", x: 0.9, label: "Solitude Cubes", glow: "#6366f1" },
  ],
  paintWall: wallPieces,
  live: (v, t) => {
    const out: Drawing[] = [];
    // The frozen sun, low in the west, and dust drifting in its light.
    out.push(glow(v, -40, at(0, 3.0, 0)[1], { rx: 520, ry: 420, colour: "#ff9a40", alpha: 0.35 }));
    for (let i = 0; i < 50; i++) {
      const x = ((hash(i, 0, 1) * m(8.8) + t * 0.2) % m(8.8)), y = at(0, 0.5 + hash(i, 1, 2) * 3.2, 0.8)[1] + Math.sin(t * 0.02 + i) * 8;
      out.push(v.circle(x, y, 1, { fill: `rgba(255,214,160,${(0.3 + 0.3 * Math.sin(t * 0.04 + i)).toFixed(3)})` }));
    }
    out.push(amaEye(v, 8.3, 2.7, t));
    const w = pacing(t, 0.6, 8.2);
    out.push(citizen(v, { x: w.x, facing: w.facing, pose: "walk", suit: "#3a6a9a", collar: "#f97316", number: "07" }, t));
    return out;
  },
  rim: { x: -40, y: 300, colour: "#ffb070", reach: 700 },
};

