// Static Garden. From intra-game: "Static Garden: plastic plants in neat rows, bright green leaves unmoving. A hidden speaker plays soft birdsong on a loop; the audio skips. Ceiling: forest canopy with beams of light breaking through, flickering slightly."
// Exits (1): Ill-Fitting Lounge (edge-right).
// Rows of identical plastic plants (one mould, one seed), a moulded tree with its
// part number showing, a birdhouse with a speaker in it that skips, a gnome
// giving the thumbs-up, and a gardener watering plants that will never need it.
import type { Vec2, View } from "@ianbicking/canvas-loop";
import { type RoomSpec, at, blob, ellipsePts, glow, hash, mixHex, roundRectPts, stroke } from "./kit-tea.js";
import { placard, speech } from "./parts-b-tea.js";
import { amaEye, amaSpeaker, citizen, crate, pacing, pipe } from "./props-tea.js";
import { m } from "./sizes-tea.js";

const W = 7.6;
const LEAF = "#38d860";
const BACK_ROW = [1.75, 2.3, 2.85, 3.4, 3.95, 4.5] as const;
const FRONT_ROW = [2.0, 2.8, 3.6, 4.4] as const;
const BIRD_X = 5.75, BIRD_H = 1.95;

/** The one plastic plant, pressed from the same mould every time. */
function moulded(v: View, x: number, depth: number, lift: number): void {
  const [px, py] = at(x, lift, depth);
  const h = m(0.75);
  blob(v, [[px - 16, py], [px + 16, py], [px + 21, py - 34], [px - 21, py - 34]], { fill: "#e8e0d0", dark: "#8a8070", seed: 5000, line: 2, shadeSide: "right" });
  for (let i = 0; i < 7; i++) {
    const ang = -Math.PI / 2 + (i - 3) * 0.36;
    const len = h * (0.7 + (i % 2) * 0.25);
    const base: Vec2 = [px, py - 34], tip: Vec2 = [px + Math.cos(ang) * len * 0.55, py - 34 + Math.sin(ang) * len];
    const mid: Vec2 = [(base[0] + tip[0]) / 2, (base[1] + tip[1]) / 2];
    blob(v, [base, [mid[0] + 9, mid[1] + 2], tip, [mid[0] - 9, mid[1] - 2]], { fill: i % 2 === 0 ? LEAF : mixHex(LEAF, "#ffffff", 0.25), light: "#a8ffb8", seed: 5001 + i, line: 1.4, amp: 0.3 });
    // The moulding seam down every leaf.
    v.line(base[0], base[1], tip[0], tip[1], { stroke: "rgba(20,80,30,0.5)", weight: 1 });
  }
  v.rect(px + 4, py - 26, 12, 8, { fill: "#f8f048" });
}

/** The tree: a moulded trunk in two halves, a seam, a part-number sticker, a lid of foliage. */
function tree(v: View): void {
  const [px, py] = at(0.85, 0, 0.6);
  const top = at(0.85, 2.35, 0.6)[1];
  blob(v, [[px - 24, py], [px + 24, py], [px + 14, top + 30], [px + 22, top], [px - 20, top], [px - 12, top + 30]], { fill: "#7a5a3a", light: "#9a7a52", dark: "#4a3220", seed: 5100, line: 2.4, shadeSide: "right" });
  for (let i = 0; i < 6; i++) stroke(v, [[px - 14 + i * 5, py - 10], [px - 12 + i * 5, top + 40]], { seed: 5101 + i, weight: 1.2, colour: "#4a3220", amp: 1.2 });
  stroke(v, [[px + 2, py], [px + 1, top]], { seed: 5110, weight: 2, colour: "#c8b090", amp: 0.2 });
  blob(v, roundRectPts(px - 18, py - m(1.1), 36, 20, 2), { fill: "#f0ead8", seed: 5111, line: 1.2 });
  v.text("PART T-12", { x: px, y: py - m(1.1) + 7 }, { size: 6, fill: "#3a2a20", align: "center", valign: "middle", style: "bold" });
  v.text("ASSY. B", { x: px, y: py - m(1.1) + 14 }, { size: 6, fill: "#3a2a20", align: "center", valign: "middle", style: "bold" });
  // Foliage: one lumpy moulded crown, with a tab where it snaps on.
  const [cx, cy] = at(0.85, 2.55, 0.6);
  const crown: Vec2[] = [];
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2, r = (0.86 + 0.14 * Math.abs(Math.sin(a * 4.5))) * m(0.62);
    crown.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.55]);
  }
  blob(v, crown, { fill: "#2aa848", light: "#5ae078", dark: "#18682a", seed: 5120, line: 2.4, shadeSide: "bottom" });
  v.rect(px - 10, cy + m(0.3), 20, 8, { fill: "#d8d0c0", stroke: "#241c17", weight: 1 });
}

function birdhouse(v: View): void {
  const [px, py] = at(BIRD_X, BIRD_H, 0);
  // A bracket, the house, a roof, the hole: a speaker cone where a bird should be.
  stroke(v, [[px, py + 40], [px, py + 70], [px - 20, py + 70]], { seed: 5200, weight: 3, colour: "#6a6a70" });
  blob(v, [[px - 26, py + 40], [px + 26, py + 40], [px + 26, py - 14], [px - 26, py - 14]], { fill: "#c87a4a", light: "#e8a070", dark: "#7a4022", seed: 5201, line: 2.2, shadeSide: "right" });
  blob(v, [[px - 36, py - 10], [px, py - 40], [px + 36, py - 10]], { fill: "#5a8a3a", light: "#7aaa5a", seed: 5202, line: 2.2 });
  blob(v, ellipsePts(px, py + 10, 13, 13), { fill: "#1a1418", seed: 5203, line: 1.8 });
  for (let r = 4; r < 12; r += 3) v.circle(px, py + 10, r, { stroke: "#4a4a50", weight: 1 });
  v.circle(px, py + 10, 3, { fill: "#8a8a90" });
  v.rect(px - 2, py + 26, 4, 8, { fill: "#8a6a40" });
  // The cable gives it away: down the wall to a tape deck on the planter.
  stroke(v, [[px + 22, py + 40], [px + 30, py + 90], [px + 26, at(0, 0.5, 0)[1]]], { seed: 5204, weight: 1.6, colour: "#1a1a1a", amp: 2 });
}

function paintWall(v: View): void {
  pipe(v, [[1.5, 2.75], [5.0, 2.75], [5.0, 2.55], [7.2, 2.55]], { colour: "#5a7a5a", seed: 5300 });
  placard(v, at(3.1, 1.6, 0)[0], at(3.1, 1.6, 0)[1], ["PLEASE DO NOT", "WATER THE PLANTS"], { w: 120, size: 9, bg: "#f0ead8", ink: "#2a5a2a", seed: 5310, rot: -0.02 });
  placard(v, at(4.6, 2.2, 0)[0], at(4.6, 2.2, 0)[1], ["NATURE:", "NOW 40% MORE", "NATURAL!"], { w: 98, size: 9, bg: "#f8f048", ink: "#d02a2a", seed: 5311, rot: 0.04 });
  amaSpeaker(v, 2.1, 2.35);
  birdhouse(v);
}

function furniture(v: View): void {
  tree(v);
  // The back planter: one long trough, plants at exact intervals.
  crate(v, 3.12, 0.45, { w: 3.4, h: 0.42, colour: "#8a7a5a", seed: 5400 });
  for (const x of BACK_ROW) moulded(v, x, 0.45, 0.42);
  // The tape deck that plays the birds, sitting at the trough's end.
  const [tx, ty] = at(5.5, 0, 0.45);
  blob(v, roundRectPts(tx - 26, ty - m(0.3), 52, m(0.3), 4), { fill: "#3a3a40", light: "#5a5a60", seed: 5410, line: 2 });
  for (const dx of [-12, 12]) v.circle(tx + dx, ty - m(0.18), 8, { fill: "#d8d0c0", stroke: "#241c17", weight: 1.2 });
  v.text("LOOP", { x: tx, y: ty - m(0.05) }, { size: 6, fill: "#e8e0c8", align: "center", valign: "middle", style: "bold" });
  // The front row: square pots on the grate.
  for (const x of FRONT_ROW) moulded(v, x, 1.7, 0);
  // A gnome in a jumpsuit, thumb up.
  const [gx, gy] = at(5.3, 0, 2.0);
  blob(v, [[gx - 12, gy], [gx + 12, gy], [gx + 10, gy - 26], [gx - 10, gy - 26]], { fill: "#3a6ac8", light: "#6a9ae8", seed: 5420, line: 1.6 });
  v.rect(gx - 8, gy - 22, 16, 3, { fill: "#e8c84a" });
  blob(v, ellipsePts(gx, gy - 32, 8, 8), { fill: "#f8d8b0", seed: 5421, line: 1.4 });
  blob(v, [[gx - 9, gy - 36], [gx + 9, gy - 36], [gx + 1, gy - 58]], { fill: "#d84a3a", seed: 5422, line: 1.4 });
  v.arc(gx + 1, gy - 31, 4, 0.2, Math.PI - 0.2, { stroke: "#241c17", weight: 1.2 });
  blob(v, roundRectPts(gx + 10, gy - 30, 6, 10, 2), { fill: "#f8d8b0", seed: 5423, line: 1 });
}

const SONG = ["tweet tweet", "tweet tw-", "tw- tw- tw-", "tweet tweet", "tweet tw-", "--whirr--", "tweet tweet"] as const;

export const STATIC_GARDEN: RoomSpec = {
  id: "static-garden",
  name: "Static Garden",
  width: W,
  wall: "#4ade80",
  trim: "#2a6a3a",
  sky: "canopy",
  dead: [3],
  floor: "grate",
  floorColour: "#4a5048",
  ambient: "#a8c0a8",
  exits: [
    { to: "Ill-Fitting Lounge", kind: "edge-right", label: "Ill-Fitting Lounge", glow: "#22c55e" },
  ],
  paintWall,
  paintFurniture: furniture,
  live: (v, t) => {
    // Shafts of light from the canopy, slanting, each flickering on its own.
    for (let i = 0; i < 4; i++) {
      const on = hash(i, Math.floor(t / 5), 5500) > 0.18;
      if (!on) continue;
      const x = m(0.9 + i * 1.75), top = at(0, 3.0, 0)[1], bot = at(0, 0, 2.2)[1];
      const a = 0.11 + 0.04 * Math.sin(t * 0.1 + i);
      v.polygon([[x - 14, top], [x + 14, top], [x + 110, bot], [x + 40, bot]], { fill: v.linearGradient(0, top, 0, bot, [[0, `rgba(255,250,200,${a.toFixed(3)})`], [1, "rgba(255,250,200,0)"]]), blend: "screen" });
      glow(v, x + 75, bot - 10, { rx: 50, ry: 10, colour: "#fff8c0", alpha: a * 2 });
    }
    // The birdsong, skipping: the bubble repeats a scrap, stalls, starts over.
    const [bx, by] = at(BIRD_X, BIRD_H, 0);
    const step = Math.floor(t / 22) % SONG.length;
    speech(v, bx + 24, by - 4, SONG[step] ?? "tweet", 0.9, { size: 10 });
    for (let i = 0; i < 3; i++) {
      const u = ((t * 0.02 + i / 3) % 1);
      const jump = step === 2 || step === 5 ? 0 : u;
      v.text("♪", { x: bx - 20 - jump * 40, y: by + 4 - jump * 40 - i * 4 }, { size: 12, fill: `rgba(30,60,30,${(1 - jump).toFixed(3)})`, align: "center", valign: "middle", style: "bold" });
    }
    // The gardener, watering anyway.
    const w = pacing(t, 1.6, 4.8, 0.006);
    citizen(v, { x: w.x, facing: w.facing, pose: "walk", suit: "#4a7a4a", collar: "#4ade80", number: "33", hair: "#c87a3a" }, t);
    const [hx, hy] = at(w.x + w.facing * 0.17, 0.72, 2.6);
    blob(v, [[hx - 12, hy], [hx + 12, hy], [hx + 10, hy + 22], [hx - 10, hy + 22]], { fill: "#c8c8c0", light: "#e8e8e0", seed: 5510, line: 1.6 });
    stroke(v, [[hx + w.facing * 10, hy + 6], [hx + w.facing * 34, hy - 6]], { seed: 5511, weight: 3, colour: "#a8a8a0", amp: 0 });
    for (let i = 0; i < 4; i++) {
      const u = ((t * 0.08 + i / 4) % 1);
      v.circle(hx + w.facing * (34 + u * 14), hy - 6 + u * u * 70, 1.8, { fill: "rgba(140,200,255,0.8)" });
    }
    amaEye(v, 2.1, 2.35, t);
  },
  rim: { x: 400, y: 160, colour: "#e8ffc0", reach: 600 },
};
