// Ill-Fitting Lounge. From intra-game: "Ill-Fitting Lounge: chairs, tables and sofas scattered around, none the right size: every chair slightly too small or too low, every table slightly too tall. Ceiling: a serene beach, waves moving unnaturally slowly."
// Exits (3): Static Garden (edge-left), Solitude Cubes (door), Quiet Plaza (tube).
// Shrunken shell chairs, a tulip table at chin height, a sofa for one and a half,
// a standard lamp too tall for the room and bent against the ceiling. A height
// chart that no one passes, and a notice inviting the wrong-sized to report.
import type { SceneView as View } from "@ianbicking/canvas-loop";
import { type RoomSpec, at, blob, ellipsePts, glow, roundRectPts, stroke } from "./kit-tea.js";
import { mouldedChair, placard, speech } from "./parts-b-tea.js";
import { amaEye, amaSpeaker, citizen, couch, tulipTable } from "./props-tea.js";
import { BACK_FOOT_Y, m } from "./sizes-tea.js";

const TABLE_X = 4.75, TABLE_D = 1.5, TABLE_H = 1.22;
const LAMP_X = 3.75;

/** The height chart: YOU MUST BE THIS TALL TO SIT, with the line at 2.2 m. */
function heightChart(v: View): void {
  const [x0, y0] = at(1.35, 0.5, 0), [, y1] = at(1.35, 2.5, 0);
  blob(v, [[x0 - 16, y0], [x0 + 16, y0], [x0 + 16, y1], [x0 - 16, y1]], { fill: "#e8d8b0", dark: "#a89870", seed: 6000, line: 1.8 });
  for (let h = 0.5; h <= 2.5; h += 0.1) {
    const [, y] = at(0, h, 0);
    const major = Math.abs(h * 2 - Math.round(h * 2)) < 0.01;
    v.line(x0 - 16, y, x0 - 16 + (major ? 14 : 7), y, { stroke: "#3a2a20", weight: 1 });
  }
  const [, ly] = at(0, 2.2, 0);
  v.line(x0 - 22, ly, x0 + 22, ly, { stroke: "#c02a1a", weight: 3 });
  placard(v, x0 + 64, ly, ["YOU MUST BE", "THIS TALL", "TO SIT"], { w: 78, size: 8, bg: "#c02a1a", ink: "#f8f0e0", seed: 6001, rot: 0.03 });
  stroke(v, [[x0 + 24, ly], [x0 + 18, ly - 4], [x0 + 24, ly], [x0 + 18, ly + 4]], { seed: 6002, weight: 2, colour: "#c02a1a", amp: 0 });
}

function paintWall(v: View): void {
  heightChart(v);
  amaSpeaker(v, 4.4, 2.55);
  placard(v, at(5.45, 1.85, 0)[0], at(5.45, 1.85, 0)[1], ["WRONG SIZE, CITIZEN?", "REPORT TO ADJUSTMENT", "BAY 6. BRING YOURSELF."], { w: 148, size: 8, bg: "#e8e0c8", ink: "#3a2a20", seed: 6010, rot: -0.03 });
  placard(v, at(6.25, 2.45, 0)[0], at(6.25, 2.45, 0)[1], ["ONE SIZE", "FITS ALL"], { w: 84, size: 11, bg: "#f8a83a", ink: "#3a1a10", seed: 6011, rot: 0.05 });
}

/** A standard lamp two feet too tall: its pole bows and the shade is jammed into the ceiling. */
function lamp(v: View): void {
  const [px, py] = at(LAMP_X, 0, 0.6);
  const [, top] = at(LAMP_X, 3.12, 0.6);
  blob(v, ellipsePts(px, py - 3, 20, 5), { fill: "#3a3a3e", seed: 6100, line: 1.6 });
  stroke(v, [[px, py - 4], [px + 4, py - m(1.0)], [px + 16, py - m(1.8)], [px + 30, top + 40]], { seed: 6101, weight: 4, colour: "#c8a050", amp: 0.3 });
  blob(v, [[px + 2, top + 44], [px + 58, top + 44], [px + 50, top], [px + 10, top]], { fill: "#e8b86a", light: "#f8d89a", dark: "#a87a3a", seed: 6102, line: 2, shadeSide: "right" });
  // Scorch where the shade has been cooking the ceiling.
  v.ellipse(px + 30, top - 2, 34, 8, { fill: "rgba(40,20,10,0.35)" });
}

function furniture(v: View): void {
  lamp(v);
  // A sofa for one and a half, too short, and a tiny chair beside it.
  couch(v, 6.15, 0.75, { w: 0.95, colour: "#b85a2a", facing: "us", seed: 6200 });
  mouldedChair(v, 1.95, 1.1, { colour: "#5a9a5a", facing: -1, seat: 0.24, size: 0.6, seed: 6210 });
  // The tiny chair someone is sitting on anyway.
  mouldedChair(v, 0.95, 1.5, { colour: "#e8783a", facing: 1, size: 0.55, seed: 6220 });
  // A table at chin height, two cups up on it out of reach.
  tulipTable(v, TABLE_X, TABLE_D, { w: 0.62, h: TABLE_H, colour: "#e8e0d0", seed: 6230 });
  const [tx, ty] = at(TABLE_X, TABLE_H, TABLE_D);
  for (const dx of [-16, 14]) {
    blob(v, roundRectPts(tx + dx - 6, ty - 18, 12, 14, 2), { fill: "#e86a3a", seed: 6240 + dx, line: 1.4 });
    v.arc(tx + dx + 7, ty - 11, 4, -Math.PI / 2, Math.PI / 2, { stroke: "#241c17", weight: 1.4 });
  }
  // A second table, too tall for its two little stools.
  tulipTable(v, 2.95, 2.15, { w: 0.5, h: 0.95, colour: "#7aaa4a", seed: 6250 });
  for (const dx of [-0.42, 0.42]) mouldedChair(v, 2.95 + dx, 2.25, { colour: "#e8c84a", facing: dx < 0 ? 1 : -1, seat: 0.3, size: 0.62, seed: 6260 + Math.round(dx * 10) });
}

export const ILL_FITTING_LOUNGE: RoomSpec = {
  id: "ill-fitting-lounge",
  name: "Ill-Fitting Lounge",
  width: 8.8,
  wall: "#22c55e",
  trim: "#8a5a2a",
  sky: "beach",
  floor: "carpet",
  floorColour: "#8a6a3a",
  ambient: "#b0b8a8",
  freshPaint: { from: 0.4, to: 2.0, colour: "#f8c860" },
  exits: [
    { to: "Static Garden", kind: "edge-left", label: "Static Garden", glow: "#4ade80" },
    { to: "Solitude Cubes", kind: "door", x: 2.6, style: "slide", label: "Solitude Cubes", glow: "#6366f1" },
    { to: "Quiet Plaza", kind: "tube", x: 7.6, label: "Quiet Plaza", glow: "#a855f7" },
  ],
  paintWall,
  paintFurniture: furniture,
  live: (v, t) => {
    const [lx, ly] = at(LAMP_X, 2.85, 0.6);
    glow(v, lx + 30, ly + 30, { rx: 150, ry: 170, colour: "#ffc070", alpha: 0.45 + 0.04 * Math.sin(t * 0.2) });
    // On the tiny chair: slides slowly forward, hitches back.
    const slide = ((t * 0.004) % 0.12);
    citizen(v, { x: 0.97 + slide, depth: 1.52, facing: 1, pose: "sit", suit: "#7a5a3a", collar: "#22c55e", number: "52" }, t);
    // At the tall table, up on tiptoe for a cup.
    const tip = Math.max(0, Math.sin(t * 0.09)) * 0.07;
    v.at({ translate: [0, -m(tip)] }, () => citizen(v, { x: TABLE_X - 0.36, depth: TABLE_D + 0.25, facing: 1, pose: "stand", suit: "#3a6a8a", collar: "#22c55e", number: "17", hair: "#d8b060" }, t));
    const [ax, ay] = at(TABLE_X - 0.2, 1.42 + tip * 1.5, TABLE_D + 0.25);
    stroke(v, [[ax - 12, ay + 40], [ax, ay]], { seed: 6300, weight: 5, colour: "#33607e", amp: 0 });
    if (Math.floor(t / 120) % 2 === 0) speech(v, ax + 10, ay - 30, "nearly...", 0.85, { size: 10 });
    // Someone on the sofa, knees up, feet over the arm.
    citizen(v, { x: 6.05, depth: 0.85, facing: 1, pose: "sit", suit: "#8a4a6a", collar: "#22c55e", number: "06", hair: "#3a2a20" }, t);
    // The tube breathes, and its capsule comes and goes.
    const [cx] = at(7.6, 0, 0);
    const k = (t % 160) / 160;
    if (k > 0.55 && k < 0.8) {
      const y = BACK_FOOT_Y - m(2.3) + (k - 0.55) / 0.25 * m(2.0);
      blob(v, roundRectPts(cx - m(0.4), y - m(0.3), m(0.8), m(0.6), 18), { fill: "rgba(200,200,210,0.7)", seed: 6310, line: 1.6, amp: 0.4 });
    }
    amaEye(v, 4.4, 2.55, t);
  },
  rim: { x: 545, y: 130, colour: "#ffd890", reach: 500 },
};
