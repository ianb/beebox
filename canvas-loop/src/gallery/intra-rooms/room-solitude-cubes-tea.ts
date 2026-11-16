// Solitude Cubes. From intra-game: "Solitude Cubes: rows of tiny cramped cubicles, each barely large enough to sit in. Thin walls, faint voices from other cubes. Ceiling: peaceful night sky with twinkling stars; a voice occasionally announces the trajectory of a shooting star."
// Exits (4): Yellow Room (edge-left), Waiting Room (edge-right), Hollow Atrium (stairs-up), Ill-Fitting Lounge (door).
// Two tiers of moulded-plastic capsules along the back wall, rungs up to the top
// row, OCCUPIED lamps, voices leaking through the walls, and an amber ticker that
// announces shooting stars (wishes are logged).
import type { Drawing, View } from "@ianbicking/canvas-loop";
import { type RoomSpec, at, blob, ellipsePts, glow, hash, mixHex, roundRectPts, stroke } from "./kit-tea.js";
import { placard, pulse, speech } from "./parts-b-tea.js";
import { amaEye, amaSpeaker, citizen, pacing, vent } from "./props-tea.js";
import { m } from "./sizes-tea.js";

const CUBE_X0 = 3.25, CUBE_W = 0.65, CUBE_H = 1.25, CUBES = 5, CUBE_D = 0.4;
const SHELL = "#c8c4dc", SHELL_LO = "#7a7494";
/** Which cubes stand open (tier, index). */
const OPEN = new Set(["0-3", "1-1"]);

function cubeBox(v: View, i: number, tier: number): Drawing {
  const out: Drawing[] = [];
  const x0 = CUBE_X0 + i * CUBE_W, h0 = tier * CUBE_H;
  const [ax, ay] = at(x0, h0, CUBE_D), [bx, by] = at(x0 + CUBE_W, h0 + CUBE_H, CUBE_D);
  const seed = 3000 + tier * 20 + i;
  // The shell: thin moulded plastic, bowed a little.
  out.push(blob(v, roundRectPts(ax + 2, by + 2, bx - ax - 4, ay - by - 4, 14), { fill: SHELL, light: "#e8e4f4", dark: SHELL_LO, seed, line: 1.6, amp: 1.6, shadeSide: "bottom" }));
  const open = OPEN.has(`${tier}-${i}`);
  const dx = ax + 12, dy = by + 14, dw = bx - ax - 24, dh = ay - by - 24;
  if (open) {
    out.push(blob(v, roundRectPts(dx, dy, dw, dh, 10), { fill: "#14121e", seed: seed + 1, line: 1.4 }));
    // A thin cushion and a pillow.
    out.push(v.rect(dx + 4, dy + dh - 10, dw - 8, 7, { fill: "#6a5a8a" }));
    out.push(v.ellipse(dx + dw - 16, dy + dh - 16, 10, 6, { fill: "#a89ac8" }));
    // The door, slid aside onto the partition, its edge showing.
    out.push(v.rect(bx - 10, dy, 6, dh, { fill: mixHex(SHELL, "#000000", 0.2) }));
  } else {
    out.push(blob(v, roundRectPts(dx, dy, dw, dh, 10), { fill: "#a8a2c4", light: "#c8c2e0", dark: "#5a5478", seed: seed + 1, line: 1.4, shadeSide: "right" }));
    out.push(blob(v, ellipsePts(dx + dw / 2, dy + dh * 0.35, 12, 12), { fill: "#1e2034", seed: seed + 2, line: 1.4 }));
    out.push(v.line(dx + dw - 10, dy + dh * 0.55, dx + dw - 10, dy + dh * 0.75, { stroke: "#e8e4d8", weight: 3 }));
  }
  // Number plate and the lamp housing.
  const n = String(tier * CUBES + i + 1).padStart(2, "0");
  out.push(v.roundRect(ax + 10, by + 3, 26, 11, 3, { fill: "#2a2440", stroke: "#241c17", weight: 1 }));
  out.push(v.text(n, { x: ax + 23, y: by + 9 }, { size: 8, fill: "#e8e0c8", align: "center", valign: "middle", style: "bold" }));
  out.push(v.circle(bx - 14, by + 9, 5, { fill: "#2a2228", stroke: "#241c17", weight: 1 }));
  return out;
}

function paintWall(v: View): Drawing {
  const out: Drawing[] = [];
  out.push(vent(v, 6.1, 2.85, 0.5));
  // The capsule block: a riveted frame, two tiers, rungs on the partitions.
  const [fx0, fy0] = at(CUBE_X0 - 0.06, 0, CUBE_D), [fx1, fy1] = at(CUBE_X0 + CUBES * CUBE_W + 0.06, CUBE_H * 2 + 0.08, CUBE_D);
  out.push(blob(v, [[fx0, fy0], [fx1, fy0], [fx1, fy1], [fx0, fy1]], { fill: "#3a3650", dark: "#1e1a2c", seed: 2990, line: 2.4, shadeSide: "bottom" }));
  for (let tier = 0; tier < 2; tier++) for (let i = 0; i < CUBES; i++) out.push(cubeBox(v, i, tier));
  for (let i = 1; i < CUBES; i++) {
    const [rx] = at(CUBE_X0 + i * CUBE_W, 0, CUBE_D);
    for (let k = 0; k < 4; k++) {
      const [, ry] = at(0, 0.25 + k * 0.28, CUBE_D);
      out.push(stroke(v, [[rx - 7, ry], [rx + 7, ry]], { seed: 3100 + i * 5 + k, weight: 3, colour: "#a8a8b0", amp: 0.2 }));
    }
  }
  out.push(amaSpeaker(v, 3.15, 2.8));
  // The ticker's housing under the ceiling.
  const [tx0, ty] = at(3.6, 2.78, 0), [tx1] = at(7.4, 2.78, 0);
  out.push(blob(v, roundRectPts(tx0 - 8, ty - 16, tx1 - tx0 + 16, 32, 6), { fill: "#2a2630", light: "#4a4650", seed: 3120, line: 2 }));
  out.push(v.rect(tx0, ty - 10, tx1 - tx0, 20, { fill: "#120c08" }));
  return out;
}

function furniture(v: View): Drawing {
  const out: Drawing[] = [];
  // House rules, on the side of the stair landing.
  const [px, py] = at(2.45, 0.38, 0.36);
  out.push(placard(v, px, py, ["SOLITUDE IS MANDATORY.", "TALKING TO YOURSELF", "COUNTS AS A MEETING."], { w: 118, size: 7, bg: "#e8e0c8", ink: "#3a2a5a", seed: 3110, rot: 0.03 }));
  // Felt slippers left outside cube 04, and a sign hung on the bulkhead's wheel.
  const [sx, sy] = at(CUBE_X0 + 3.4 * CUBE_W, 0, 0.95);
  for (const d of [0, 16]) out.push(blob(v, ellipsePts(sx + d, sy - 3, 9, 4), { fill: "#8a5a9a", seed: 3130 + d, line: 1.2 }));
  const [hx, hy] = at(7.2, 1.05, 0);
  out.push(placard(v, hx + m(0.5) + 30, hy + 30, ["MIND", "THE SILL"], { w: 50, size: 7, bg: "#e8b83a", ink: "#2a1a10", seed: 3135, rot: 0.12 }));
  return out;
}

const VOICES = ["...is anyone there?", "shh!", "I can hear you breathing", "cube 7, you awake?", "...and then Ama said...", "stop humming"];
const TICKER = "AMA: SHOOTING STAR, BEARING 271, ELEVATION 40. MAKE A WISH. WISHES ARE LOGGED.     ";

export const SOLITUDE_CUBES: RoomSpec = {
  id: "solitude-cubes",
  name: "Solitude Cubes",
  width: 8.8,
  wall: "#6366f1",
  trim: "#3a3a7a",
  sky: "night-stars",
  floor: "carpet",
  floorColour: "#4a3e5e",
  ambient: "#8a8cc0",
  exits: [
    { to: "Yellow Room", kind: "edge-left", label: "Yellow Room", glow: "#ca8a04" },
    { to: "Waiting Room", kind: "edge-right", label: "Waiting Room", glow: "#a8a29e" },
    { to: "Hollow Atrium", kind: "stairs-up", x: 0.8, label: "Hollow Atrium", glow: "#f97316" },
    { to: "Ill-Fitting Lounge", kind: "door", x: 7.2, style: "bulkhead", label: "Ill-Fitting Lounge", glow: "#22c55e" },
  ],
  paintWall,
  paintFurniture: furniture,
  live: (v, t) => {
    const out: Drawing[] = [];
    // Occupancy lamps, and a reading light inside each open cube.
    for (let tier = 0; tier < 2; tier++) for (let i = 0; i < CUBES; i++) {
      const [, by] = at(0, tier * CUBE_H + CUBE_H, CUBE_D);
      const [bx] = at(CUBE_X0 + (i + 1) * CUBE_W, 0, CUBE_D);
      const open = OPEN.has(`${tier}-${i}`);
      const vacant = open || hash(i, tier, Math.floor(t / 50) + 3140) < 0.15;
      const c = vacant ? "#40e080" : "#ff4a3a";
      out.push(v.circle(bx - 14, by + 9, 3.5, { fill: c }));
      out.push(glow(v, bx - 14, by + 9, { rx: 12, colour: c, alpha: 0.5 }));
      if (!open && !vacant) {
        // A lit porthole with someone's head in it, turning now and then.
        const [ax] = at(CUBE_X0 + i * CUBE_W, 0, CUBE_D), [, ty] = at(0, tier * CUBE_H + CUBE_H, CUBE_D), [, fy] = at(0, tier * CUBE_H, CUBE_D);
        const cx = ax + (bx - ax) / 2, cy = ty + 14 + (fy - ty - 24) * 0.35;
        out.push(v.circle(cx, cy, 11, { fill: "rgba(255,190,110,0.45)" }));
        out.push(v.circle(cx + Math.sin(t * 0.02 + i * 2 + tier) * 3, cy + 3, 6, { fill: "rgba(30,20,30,0.8)" }));
      }
      if (open) {
        const [ix, iy] = at(CUBE_X0 + (i + 0.5) * CUBE_W, tier * CUBE_H + CUBE_H * 0.6, CUBE_D);
        out.push(glow(v, ix, iy, { rx: 40, ry: 50, colour: "#ffd080", alpha: 0.3 + 0.04 * Math.sin(t * 0.07 + i) }));
      }
    }
    // Someone wedged into cube 04, knees up.
    out.push(citizen(v, { x: CUBE_X0 + 3 * CUBE_W + 0.28, depth: CUBE_D + 0.05, facing: 1, pose: "sit", suit: "#4a4a7a", collar: "#6366f1", number: "04" }, t));
    // Voices leaking through the walls.
    for (let k = 0; k < 4; k++) {
      const a = pulse(t, 150 + k * 41, 60, k * 70) * 0.9;
      const i = (k * 3 + Math.floor(t / (150 + k * 41))) % CUBES, tier = k % 2;
      const [x, y] = at(CUBE_X0 + (i + 0.3) * CUBE_W, tier * CUBE_H + CUBE_H - 0.05, CUBE_D);
      out.push(speech(v, x, y, VOICES[(k + Math.floor(t / 150)) % VOICES.length] ?? "shh", a, { size: 11, side: i > 2 ? -1 : 1, bg: "220,216,240" }));
    }
    // The shooting-star ticker, amber dots crawling left.
    const [tx0, ty] = at(3.6, 2.78, 0), [tx1] = at(7.4, 2.78, 0);
    const style = { size: 13, fill: "#ffb030", style: "bold" as const, font: "Courier New, monospace" };
    const tw = v.textWidth(TICKER, style);
    const off = (t * 2.2) % tw;
    out.push(v.clip([[tx0, ty - 10], [tx1, ty - 10], [tx1, ty + 10], [tx0, ty + 10]], ((): Drawing => {
      const drawn: Drawing[] = [];
      for (let k = 0; k < 3; k++) drawn.push(v.text(TICKER, { x: tx0 - off + k * tw, y: ty + 1 }, { ...style, valign: "middle" }));
      for (let y = ty - 10; y < ty + 10; y += 3) drawn.push(v.line(tx0, y, tx1, y, { stroke: "rgba(0,0,0,0.45)", weight: 1 }));
      return drawn;
    })()));
    out.push(glow(v, (tx0 + tx1) / 2, ty, { rx: (tx1 - tx0) * 0.55, ry: 30, colour: "#ff9a30", alpha: 0.18 }));
    out.push(amaEye(v, 3.15, 2.8, t));
    const w = pacing(t + 200, 0.5, 8.3, 0.006);
    out.push(citizen(v, { x: w.x, facing: w.facing, pose: "walk", suit: "#5a4a7a", collar: "#6366f1", number: "88", hair: "#c8a060" }, t));
    return out;
  },
  rim: { x: 640, y: 120, colour: "#a0a8ff", reach: 600 },
};
