// Utility Closet. From intra-game: "Utility Closet: dimly lit, barely large enough to stand in. Rusting shelves of broken tools, cracked pipes, frayed wires. Dust everywhere; stale metal and mildew. In the corner, half hidden behind cleaning supplies, an exposed wire leads to a heavy flickering panel: the plug for something important."
// Exits (1): Reflection Chamber (edge-left).
//
// A low ceiling; a leaning rusty shelf of broken tools (and a thumbs-up
// lunchbox); a cracked pipe dripping into a can; a swinging bare bulb; and in
// the corner, behind a mop bucket and bottles, the SENTRA panel: a heavy grey box
// with a big plug, flickering lamps, a frayed cable throwing sparks, and a note.
import type { Vec2, SceneView as View } from "@ianbicking/canvas-loop";
import { type RoomSpec, at, blob, ellipsePts, glow, hash, mixHex, rivet, roundRectPts, stroke } from "./kit-tea.js";
import { bareBulb, box, bulbPoint, cable, mascot, shelfUnit, slab, sparks, stencil } from "./parts-c-tea.js";
import { amaEye, amaSpeaker, citizen, pipe } from "./props-tea.js";
import { m } from "./sizes-tea.js";

const CEIL = 2.6;

/** One broken tool or piece of junk on a shelf, standing on y (px), starting at x. Returns its width. */
function junk(v: View, kind: number, x: number, y: number, seed: number): number {
  switch (kind % 7) {
    case 0: { // A wrench, lying down.
      stroke(v, [[x, y - 4], [x + 40, y - 6]], { seed, weight: 5, colour: "#8a8e94" });
      v.arc(x + 44, y - 7, 6, -2.4, 2.4, { stroke: "#8a8e94", weight: 4 });
      return 54;
    }
    case 1: { // A paint can, a dried drip down its side.
      blob(v, [[x, y], [x + 26, y], [x + 26, y - 30], [x, y - 30]], { fill: "#8a7a5a", dark: "#4a3a2a", seed, line: 1.6, shadeSide: "right" });
      stroke(v, [[x + 8, y - 30], [x + 9, y - 14]], { seed: seed + 1, weight: 4, colour: "#5a8ac8" });
      return 32;
    }
    case 2: { // A coil of frayed wire.
      for (let k = 0; k < 3; k++) v.ellipse(x + 16, y - 10, 15 - k * 2, 9 - k, { stroke: k === 1 ? "#a85a2a" : "#2a2420", weight: 2 });
      stroke(v, [[x + 28, y - 8], [x + 36, y - 2], [x + 40, y - 4]], { seed, weight: 1.6, colour: "#c87a3a" });
      return 42;
    }
    case 3: { // A hammer handle with no head.
      v.at({ translate: [x + 4, y - 3], rotate: -0.1 }, () => blob(v, roundRectPts(0, -4, 44, 7, 3), { fill: "#a8804a", seed, line: 1.4, amp: 0.3 }));
      return 50;
    }
    case 4: { // A cracked jar of screws.
      blob(v, roundRectPts(x, y - 30, 22, 30, 5), { fill: "rgba(200,220,210,0.5)", seed, line: 1.4 });
      for (let k = 0; k < 6; k++) v.circle(x + 5 + hash(k, 0, seed) * 12, y - 4 - hash(k, 1, seed) * 10, 2, { fill: "#6a6a6e" });
      stroke(v, [[x + 14, y - 28], [x + 10, y - 18], [x + 15, y - 10]], { seed: seed + 1, weight: 1 });
      blob(v, roundRectPts(x - 1, y - 34, 24, 6, 2), { fill: "#8a3a2a", seed: seed + 2, line: 1.2 });
      return 28;
    }
    case 5: { // A box of fuses, flap open.
      blob(v, [[x, y], [x + 36, y], [x + 36, y - 22], [x, y - 22]], { fill: "#c8a868", dark: "#7a5a30", seed, line: 1.6 });
      blob(v, [[x, y - 22], [x + 16, y - 22], [x + 4, y - 36]], { fill: "#d8b878", seed: seed + 1, line: 1.2 });
      v.text("FUSES", { x: x + 18, y: y - 10 }, { size: 6, fill: "#3a2a10", align: "center", valign: "middle", style: "bold" });
      return 40;
    }
    default: { // A cracked length of pipe.
      blob(v, roundRectPts(x, y - 12, 46, 11, 3), { fill: "#7a6650", dark: "#3a2e24", seed, line: 1.4 });
      stroke(v, [[x + 22, y - 12], [x + 26, y - 6], [x + 22, y - 1]], { seed: seed + 1, weight: 1.2 });
      return 50;
    }
  }
}

function shelves(v: View): void {
  shelfUnit(v, { x: 1.1, w: 1.15, h: 2.05, shelves: [0.25, 0.75, 1.25, 1.75], colour: "#6a6460", rust: true, lean: -0.03, seed: 5000 }, (i, x0, x1, y) => {
    if (i === 3) {
      // The lunchbox on the top shelf.
      blob(v, roundRectPts(x0 + 4, y - 34, 56, 34, 5), { fill: "#3a6ab8", light: "#5a8ad8", seed: 5050, line: 1.8 });
      stroke(v, [[x0 + 20, y - 34], [x0 + 24, y - 44], [x0 + 40, y - 44], [x0 + 44, y - 34]], { seed: 5051, weight: 2.4, colour: "#8a8e94" });
      mascot(v, [x0 + 28, y - 17], 9, 5052);
      let x = x0 + 70;
      while (x < x1 - 30) x += junk(v, 5 + Math.floor(hash(i, x, 5060) * 2), x, y, 5070 + x) + 6;
      return;
    }
    let x = x0;
    let k = i * 3;
    while (x < x1 - 24) {
      x += junk(v, k, x, y, 5100 + i * 50 + k) - 4 + hash(i, k, 5099) * 6;
      k++;
    }
  });
}

/** The SENTRA panel in the corner. */
const PANEL = { x: 3.0, h0: 0.55, h1: 1.95, w: 0.72 };
function plugPoint(): Vec2 {
  return at(PANEL.x - 0.12, 1.0, 0);
}
function sentraPanel(v: View): void {
  const p = box(PANEL.x - PANEL.w / 2, PANEL.x + PANEL.w / 2, PANEL.h0, PANEL.h1, 0);
  blob(v, p, { fill: "#6a7076", light: "#8a9096", dark: "#3a3e42", seed: 5200, line: 2.8, shadeSide: "right" });
  const [x0, y0] = at(PANEL.x - PANEL.w / 2, PANEL.h1, 0);
  const w = m(PANEL.w);
  for (let k = 0; k < 5; k++) {
    rivet(v, x0 + 8 + k * ((w - 16) / 4), y0 + 8);
    rivet(v, x0 + 8 + k * ((w - 16) / 4), y0 + m(PANEL.h1 - PANEL.h0) - 8);
  }
  blob(v, roundRectPts(x0 + 14, y0 + 18, w - 28, 24, 3), { fill: "#1a1a1e", seed: 5201, line: 1.6 });
  v.text("SENTRA", { x: x0 + w / 2, y: y0 + 30 }, { size: 13, fill: "#e8b83a", align: "center", valign: "middle", style: "bold", font: "Courier New, monospace" });
  // Two dials.
  for (const [k, dx] of [0.3, 0.7].entries()) {
    const cx = x0 + w * dx, cy = y0 + 70;
    blob(v, ellipsePts(cx, cy, 16, 16), { fill: "#e8e0c8", seed: 5202 + k, line: 1.8 });
    v.line(cx, cy, cx + Math.cos(-2.6 + k * 2.2) * 12, cy + Math.sin(-2.6 + k * 2.2) * 12, { stroke: "#c82a1a", weight: 1.6 });
  }
  // The socket and the big plug in it, its cable thick and black.
  const [sx, sy] = plugPoint();
  blob(v, roundRectPts(sx - 22, sy - 22, 44, 44, 6), { fill: "#2a2a2e", seed: 5210, line: 2 });
  blob(v, roundRectPts(sx - 14, sy - 16, 28, 32, 5), { fill: "#c83a2a", light: "#e85a4a", seed: 5211, line: 2 });
  stencil(v, "DO NOT", { x: x0 + w * 0.72, y: sy - 8 }, { size: 7, colour: "#f8e048" });
  stencil(v, "UNPLUG", { x: x0 + w * 0.72, y: sy + 2 }, { size: 7, colour: "#f8e048" });
  // Yellow-and-black hazard stripes along the foot.
  const [, fy] = at(0, PANEL.h0 + 0.08, 0);
  v.clip([[x0, fy - 6], [x0 + w, fy - 6], [x0 + w, fy + 6], [x0, fy + 6]], () => {
    for (let x = x0 - 12; x < x0 + w; x += 16) v.polygon([[x, fy + 6], [x + 8, fy + 6], [x + 20, fy - 6], [x + 12, fy - 6]], { fill: "#e8c83a" });
  });
  // The note, taped to the wall beside it.
  v.at({ translate: [x0 - 34, at(0, 1.45, 0)[1]], rotate: -0.08 }, () => {
    blob(v, [[-28, -18], [28, -18], [28, 18], [-28, 18]], { fill: "#f4f0c8", seed: 5220, line: 1.2, amp: 0.4 });
    for (const [i, l] of ["IF YOU CAN", "READ THIS YOU", "ARE NOT CLEARED", "TO READ THIS"].entries()) v.text(l, { x: 0, y: -12 + i * 8 }, { size: 5.5, fill: "#8a1a1a", align: "center", valign: "middle", style: "bold" });
  });
  // The cable from the plug down the wall, across the floor and off to the left,
  // stripped bare where it crosses the conduit.
  const run: Vec2[] = [[sx, sy + 18], [sx - 6, sy + 60], at(2.7, 0.08, 0.2), at(1.9, 0.02, 0.3), at(0.9, 0.05, 0.25), at(0, 0.04, 0.3)];
  cable(v, run, { seed: 5230, weight: 6, frayAt: 1 });
}

/** The mop bucket, mop, broom and bottles that half hide the panel. */
function cleaning(v: View): void {
  const [bx, by] = at(2.6, 0, 0.75);
  stroke(v, [[bx + 10, by - 40], [bx + 70, by - m(1.5)]], { seed: 5300, weight: 5, colour: "#a8804a" });
  stroke(v, [[bx - 30, by - 20], [bx - 10, by - m(1.35)]], { seed: 5301, weight: 4, colour: "#c8a868" });
  blob(v, [[bx - 44, by - 18], [bx - 14, by - 22], [bx - 24, by + 2], [bx - 50, by]], { fill: "#c8b080", seed: 5302, line: 1.6 });
  blob(v, [[bx - 30, by], [bx + 34, by], [bx + 40, by - 50], [bx - 36, by - 50]], { fill: "#e8b83a", light: "#f8d860", dark: "#8a6a20", seed: 5303, line: 2.2, shadeSide: "right" });
  v.ellipse(bx + 2, by - 50, 38, 6, { fill: "#4a5a4a" });
  v.ellipse(bx + 2, by - 50, 38, 6, { stroke: "#241c17", weight: 1.6 });
  blob(v, [[bx + 2, by - 52], [bx + 14, by - 60], [bx + 30, by - 50], [bx + 18, by - 44]], { fill: "#c8c0a8", seed: 5304, line: 1.4 });
  // Bottles on an upturned crate.
  slab(v, { x0: 3.0, x1: 3.5, h0: 0, h1: 0.32, depth: 0.85 }, { fill: "#6a5034", seed: 5310, shade: true });
  const [cx, cy] = at(3.08, 0.32, 0.85);
  const bottles = [["#4ab8c8", "SCRUB-O"], ["#c84a8a", ""], ["#e8e0c8", "BLEACH"]] as const;
  for (const [i, [c, label]] of bottles.entries()) {
    const x = cx + i * 22, h = 44 + (i % 2) * 10;
    blob(v, [[x, cy], [x + 18, cy], [x + 18, cy - h], [x + 12, cy - h - 8], [x + 6, cy - h - 8], [x, cy - h]], { fill: c, light: mixHex(c, "#ffffff", 0.3), seed: 5311 + i, line: 1.6 });
    if (label !== "") v.at({ translate: [x + 9, cy - h / 2], rotate: -Math.PI / 2 }, () => v.text(label, { x: 0, y: 0 }, { size: 6, fill: "#1a1a1a", align: "center", valign: "middle", style: "bold" }));
  }
}

function wallPieces(v: View): void {
  // Cracked pipes along the top, one wrapped in rag.
  pipe(v, [[0, 2.3], [1.6, 2.3], [1.7, 2.18], [3.6, 2.18]], { seed: 5400, colour: "#6a5440" });
  pipe(v, [[0.3, 0.45], [0.3, 1.5], [0.5, 1.6], [2.4, 1.6], [2.5, 2.18]], { width: 0.07, seed: 5410, colour: "#5a6a5a" });
  const [rx, ry] = at(1.95, 2.18, 0);
  blob(v, [[rx - 14, ry - 12], [rx + 14, ry - 10], [rx + 12, ry + 12], [rx - 12, ry + 10]], { fill: "#a89878", seed: 5420, line: 1.4 });
  stroke(v, [[rx + 14, ry + 4], [rx + 20, ry + 20]], { seed: 5421, weight: 2, colour: "#a89878" });
  amaSpeaker(v, 2.15, 2.0);
  shelves(v);
  sentraPanel(v);
  // Dust and mildew: dark blooms in the corner.
  for (let i = 0; i < 6; i++) {
    const [dx, dy] = at(3.2 + hash(i, 0, 5430) * 0.4, 2.0 + hash(i, 1, 5430) * 0.5, 0);
    v.circle(dx, dy, 8 + hash(i, 2, 5430) * 14, { fill: "rgba(40,60,30,0.25)" });
  }
}

function furniture(v: View): void {
  // The drip can under the crack.
  const [px, py] = at(1.95, 0, 0.6);
  blob(v, [[px - 14, py], [px + 14, py], [px + 16, py - 26], [px - 16, py - 26]], { fill: "#8a8e94", dark: "#4a4e54", seed: 5500, line: 1.6 });
  v.ellipse(px, py - 26, 16, 3, { fill: "#2a3a3a" });
  cleaning(v);
}

export const UTILITY_CLOSET: RoomSpec = {
  id: "utility-closet",
  name: "Utility Closet",
  width: 3.6,
  ceiling: CEIL,
  wall: "#d97706",
  trim: "#5a3a10",
  sky: "dead",
  dead: [0, 1],
  floor: "grate",
  ambient: "#7a7060",
  exits: [
    { to: "Reflection Chamber", kind: "edge-left", label: "Reflection Chamber", glow: "#4b5563" },
  ],
  paintWall: wallPieces,
  paintFurniture: furniture,
  live: (v, t) => {
    const swing = Math.sin(t * 0.045) * 0.06;
    const [lx, ly] = bulbPoint(1.6, 1.95, CEIL, swing);
    const brown = hash(Math.floor(t / 4), 0, 5600) < 0.1 ? 0.5 : 1;
    glow(v, lx, ly + 30, { rx: 240, ry: 220, colour: "#ffc880", alpha: 0.32 * brown });
    bareBulb(v, 1.6, 1.95, CEIL, swing);
    // Dust in the bulb light.
    for (let i = 0; i < 24; i++) {
      const dx = lx - 120 + hash(i, 0, 5610) * 240 + Math.sin(t * 0.02 + i) * 6;
      const dy = ly - 40 + ((hash(i, 1, 5611) * 260 + t * 0.15) % 260);
      v.circle(dx, dy, 1, { fill: `rgba(255,230,190,${(0.25 + 0.25 * Math.sin(t * 0.05 + i)).toFixed(3)})` });
    }
    // The panel's lamps, flickering, and its glow.
    const [x0, y0] = at(PANEL.x - PANEL.w / 2, PANEL.h1, 0);
    const w = m(PANEL.w);
    const surge = hash(Math.floor(t / 2), 1, 5620) < 0.25;
    for (let k = 0; k < 5; k++) {
      const on = hash(k, Math.floor(t / (2 + k)), 5621) < 0.6;
      const c = k === 4 ? "#ff4a2a" : k % 2 === 0 ? "#5aff7a" : "#ffb83a";
      v.circle(x0 + 16 + k * ((w - 32) / 4), y0 + 100, 4, { fill: on ? c : "#2a2a2a" });
      if (on) glow(v, x0 + 16 + k * ((w - 32) / 4), y0 + 100, { rx: 12, colour: c, alpha: 0.6 });
    }
    glow(v, x0 + w / 2, y0 + 80, { rx: 120, ry: 140, colour: "#9ad0ff", alpha: surge ? 0.3 : 0.1 });
    const [sx, sy] = plugPoint();
    sparks(v, [sx - 6, sy + 60], t, surge && hash(t, 2, 5622) < 0.6);
    // The drip from the cracked pipe, into the can.
    const [dx, dTop] = at(1.95, 2.12, 0.6);
    const [, dBot] = at(1.95, 0.2, 0.6);
    const u = (t % 40) / 40;
    v.ellipse(dx, dTop + (dBot - dTop) * u * u, 2.5, 3.5, { fill: "rgba(160,200,200,0.85)" });
    amaEye(v, 2.15, 2.0, t);
    citizen(v, { x: 0.7, depth: 2.3, facing: 1, pose: "stand", suit: "#7a5a3a", collar: "#d97706", number: "13", skin: "#d8a070", hair: "#1a1a1a" }, t);
  },
};
