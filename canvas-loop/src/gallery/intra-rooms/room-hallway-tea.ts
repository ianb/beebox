// The Hallway: "A narrow, sterile corridor lined with identical doors, each one
// labeled clearly with the name of a citizen. The automated access control system
// ensures that only the assigned resident can enter their quarters, regardless of
// any invitation or request. The ceiling simulates a clear, calm sky, though the
// occasional flicker of static disrupts the illusion. Overhead lights hum
// quietly, with a few flickering sporadically, casting long, shifting shadows down
// the hall."
// Exits (14): the Hollow Atrium (left), the Reflection Chamber (right end), and
// twelve quarters doors along the wall. 20 m long: the view pans with the walker.
import type { Drawing, View } from "@ianbicking/canvas-loop";
import { type Exit, type RoomSpec, at, blob, glow, hash, roundRectPts, stroke } from "./kit-tea.js";
import { amaEye, amaSpeaker, citizen, pacing, plant, poster, vent } from "./props-tea.js";
import { BACK_FOOT_Y, m } from "./sizes-tea.js";

const WIDTH = 20;
const NAMES = ["Doug", "Marta", "Frida", "June", "Lana", "Harold", "Greg", "Milton", "Gloria", "Lily", "Henry", "Yours"] as const;
/** Each quarters door: x along the hall, metres. */
const doorX = (i: number): number => 1.9 + i * 1.45;

const DOORS: Exit[] = NAMES.map((name, i): Exit => ({ to: `Quarters: ${name}`, kind: "door", x: doorX(i), style: "closed", label: name, glow: name === "Yours" ? "#40ff70" : "#ff3a2a" }));

/** What each occupant has done to their identical door. */
function dressing(v: View, name: (typeof NAMES)[number], x: number): Drawing {
  const drawn: Drawing[] = [];
  const [cx, foot] = at(x, 0, 0);
  const top = foot - m(2.1);
  switch (name) {
    case "Doug":
      // Stickers, every which way.
      for (let k = 0; k < 7; k++) {
        const sx = cx - 22 + hash(k, 0, 1) * 44, sy = top + 60 + hash(k, 1, 1) * 180;
        drawn.push(v.at({ translate: [sx, sy], rotate: hash(k, 2, 1) * 3 }, blob(v, roundRectPts(-7, -5, 14, 10, 3), { fill: ["#e85a5a", "#f8d040", "#5ab8e8", "#8ae85a"][k % 4] ?? "#fff", seed: 1200 + k, line: 1 })));
      }
      break;
    case "Marta":
      // Polished: a gleam, and a mat squared to the door.
      drawn.push(stroke(v, [[cx - 20, top + 40], [cx - 4, top + 24]], { seed: 1210, weight: 4, colour: "rgba(255,255,255,0.6)" }));
      drawn.push(blob(v, roundRectPts(cx - 36, foot - 6, 72, 8, 2), { fill: "#5a6a8a", seed: 1211, line: 1.2 }));
      break;
    case "Frida":
      // Notes pinned all over it.
      for (let k = 0; k < 10; k++) {
        const sx = cx - 26 + (k % 3) * 22, sy = top + 50 + Math.floor(k / 3) * 34;
        drawn.push(v.at({ translate: [sx, sy], rotate: (hash(k, 0, 3) - 0.5) * 0.4 }, ((): Drawing => {
          const parts: Drawing[] = [];
          parts.push(blob(v, roundRectPts(-9, -11, 18, 22, 1), { fill: "#f4ecb0", seed: 1220 + k, line: 1 }));
          for (let l = 0; l < 3; l++) parts.push(v.line(-6, -6 + l * 5, 6, -6 + l * 5, { stroke: "#5a5a8a", weight: 0.8 }));
          return parts;
        })()));
      }
      break;
    case "June":
      // A small picture beside the door, hung crooked.
      drawn.push(v.at({ translate: [cx + m(0.75), top + 70], rotate: 0.12 }, [
        blob(v, roundRectPts(-16, -12, 32, 24, 2), { fill: "#c8a870", seed: 1230, line: 1.6 }),
        v.rect(-12, -8, 24, 16, { fill: "#7ab8c8" }),
      ]));
      break;
    case "Harold":
      drawn.push(blob(v, roundRectPts(cx - 30, top + 40, 60, 40, 3), { fill: "#e8e0c8", seed: 1240, line: 1.4 }));
      drawn.push(v.text("RULES", { x: cx, y: top + 50 }, { size: 9, fill: "#8a1a1a", align: "center", valign: "middle", style: "bold" }));
      for (let l = 0; l < 4; l++) drawn.push(v.line(cx - 22, top + 60 + l * 5, cx + 22, top + 60 + l * 5, { stroke: "#5a5040", weight: 0.8 }));
      break;
    case "Milton":
      // Complaint forms, slid under the door and piling out.
      for (let k = 0; k < 6; k++) drawn.push(v.at({ translate: [cx - 20 + k * 8, foot - 3], rotate: (hash(k, 0, 5) - 0.5) * 0.6 }, blob(v, [[-10, -3], [10, -3], [10, 2], [-10, 2]], { fill: "#f0e8d8", seed: 1250 + k, line: 1 })));
      break;
    case "Gloria":
      // A chair by the door, angled toward the hall.
      drawn.push(blob(v, [[cx + m(0.55), foot], [cx + m(0.95), foot], [cx + m(0.95), foot - m(0.45)], [cx + m(0.55), foot - m(0.45)]], { fill: "#c84a4a", seed: 1260, line: 1.6 }));
      drawn.push(blob(v, [[cx + m(0.9), foot - m(0.45)], [cx + m(0.98), foot - m(0.45)], [cx + m(0.98), foot - m(0.9)], [cx + m(0.9), foot - m(0.9)]], { fill: "#a83a3a", seed: 1261, line: 1.6 }));
      break;
    case "Lily":
      drawn.push(plant(v, x + 0.62, 0.3, { h: 0.7, leaf: "#2ad870" }));
      break;
    case "Henry":
      // A packed suitcase, always ready.
      drawn.push(blob(v, roundRectPts(cx + m(0.55), foot - m(0.5), m(0.42), m(0.5), 6), { fill: "#8a5a3a", light: "#a8784a", seed: 1270, line: 2 }));
      drawn.push(stroke(v, [[cx + m(0.66), foot - m(0.5)], [cx + m(0.66), foot - m(0.58)], [cx + m(0.86), foot - m(0.58)], [cx + m(0.86), foot - m(0.5)]], { seed: 1271, weight: 2.4 }));
      break;
    case "Yours": {
      // WELCOME! — a fresh banner, already peeling at one end.
      const bw = m(1.0);
      drawn.push(blob(v, [[cx - bw / 2, top - 40], [cx + bw / 2, top - 40], [cx + bw / 2 - 6, top - 14], [cx - bw / 2, top - 18]], { fill: "#f8e848", seed: 1280, line: 1.6 }));
      drawn.push(v.text("WELCOME!", { x: cx - 4, y: top - 28 }, { size: 12, fill: "#d02a2a", align: "center", valign: "middle", style: "bold" }));
      break;
    }
    case "Lana":
    case "Greg":
      break;
  }
  return drawn;
}

function wallPieces(v: View): Drawing {
  const out: Drawing[] = [];
  // A runner of green carpet down the hall, and numbered markings at each door.
  for (let i = 0; i < 4; i++) out.push(vent(v, 1.1 + i * 5.2, 2.55, 0.5));
  out.push(poster(v, 0.95, "trust", { h: 1.55 }));
  out.push(poster(v, 19.1, "clearance", { h: 1.55 }));
  out.push(amaSpeaker(v, 9.9, 2.65));
  for (const [i] of NAMES.entries()) {
    out.push(v.text(`${101 + i}`, { x: at(doorX(i), 0, 0)[0], y: BACK_FOOT_Y - m(2.35) }, { size: 9, fill: "#3a4a40", align: "center", valign: "middle" }));
  }
  return out;
}

/** The heavy door at the right end, to the Reflection Chamber. */
function endDoor(v: View): Drawing {
  const out: Drawing[] = [];
  const [x, foot] = at(WIDTH, 0, 0);
  out.push(blob(v, [[x - 40, foot - m(2.4)], [x, foot - m(2.4)], [x, foot + 120], [x - 40, foot + 120]], { fill: "#24212a", seed: 1300, line: 2.4 }));
  out.push(blob(v, roundRectPts(x - 38, foot - m(2.2), 34, m(2.2), 6), { fill: "#6a6e72", light: "#8a9094", dark: "#3a3e42", seed: 1301, line: 2.4 }));
  for (let i = 0; i < 6; i++) out.push(v.circle(x - 21, foot - m(2.0) + i * 52, 2.5, { fill: "#2a2a2e" }));
  out.push(blob(v, roundRectPts(x - 150, foot - m(2.75), 132, 38, 4), { fill: "#e8e0c8", seed: 1302, line: 1.8 }));
  out.push(v.text("REFLECTION CHAMBER", { x: x - 84, y: foot - m(2.75) + 13 }, { size: 9, fill: "#2a2018", align: "center", valign: "middle", style: "bold" }));
  out.push(v.text("please reflect >", { x: x - 84, y: foot - m(2.75) + 27 }, { size: 8, fill: "#6a5a4a", align: "center", valign: "middle" }));
  return out;
}

/** Overhead lights hanging under the sky panels, every few metres. */
const LIGHTS = [2.4, 6.4, 10.4, 14.4, 18.4];
function lights(v: View): Drawing {
  const out: Drawing[] = [];
  for (const x of LIGHTS) {
    const [cx, cy] = at(x, 2.75, 1.2);
    out.push(stroke(v, [[cx - 30, at(x, 3, 0)[1]], [cx - 30, cy]], { seed: 1310 + x, weight: 1.2 }));
    out.push(stroke(v, [[cx + 30, at(x, 3, 0)[1]], [cx + 30, cy]], { seed: 1311 + x, weight: 1.2 }));
    out.push(blob(v, roundRectPts(cx - 50, cy - 6, 100, 12, 5), { fill: "#c8c8c0", seed: 1312 + x, line: 1.8 }));
  }
  return out;
}

export const HALLWAY: RoomSpec = {
  id: "hallway",
  name: "Hallway",
  width: WIDTH,
  wall: "#34d399",
  trim: "#2a5a48",
  sky: "calm-static",
  dead: [4],
  floor: "lino",
  floorColour: "#7a8a7a",
  ambient: "#a8b0b8",
  freshPaint: { from: 13.2, to: 16.1, colour: "#5ae8b0" },
  exits: [{ to: "Hollow Atrium", kind: "edge-left", label: "Hollow Atrium", glow: "#f97316" }, ...DOORS],
  paintWall: (v) => {
    return [
      wallPieces(v),
      endDoor(v),
    ];
  },
  paintFurniture: (v) => {
    const drawn: Drawing[] = [];
    for (const [i, name] of NAMES.entries()) drawn.push(dressing(v, name, doorX(i)));
    drawn.push(lights(v));
    return drawn;
  },
  live: (v, t) => {
    const drawn: Drawing[] = [];
    for (const [i, x] of LIGHTS.entries()) {
      // A few flicker; when one drops out, its pool of light goes with it.
      const flicker = (i === 1 || i === 3) && hash(Math.floor(t / 3), i, 7) < 0.25;
      if (flicker) continue;
      const [cx, cy] = at(x, 2.75, 1.2);
      drawn.push(v.rect(cx - 44, cy - 2, 88, 4, { fill: "#f8f8e8" }));
      drawn.push(glow(v, cx, cy + 160, { rx: 230, ry: 230, colour: "#e8fff0", alpha: 0.22 }));
    }
    drawn.push(glow(v, at(WIDTH, 0, 0)[0] - 20, BACK_FOOT_Y - m(2.5), { rx: 20, colour: "#ff3020", alpha: 0.8 * (0.6 + 0.4 * Math.sin(t * 0.1)) }));
    drawn.push(amaEye(v, 9.9, 2.65, t));
    const w = walkerAt(t);
    drawn.push(citizen(v, { x: w.x, facing: w.facing, pose: "walk", suit: "#4a7a6a", collar: "#34d399", number: "112" }, t));
    return drawn;
  },
  focus: (t) => m(walkerAt(t).x),
};

function walkerAt(t: number): { x: number; facing: 1 | -1 } {
  return pacing(t, 0.8, WIDTH - 1.2, 0.012);
}

