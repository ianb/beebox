// Waiting Room. From intra-game: "Waiting Room: rows of uncomfortable chairs, piles of outdated magazines. Clocks on the wall stuck at random times; lights flicker. Perpetually overcast sky, dark clouds that never produce rain."
// Exits (1): Solitude Cubes (edge-left).
// Rows of bolted plastic chairs face a shuttered hatch. NOW SERVING never gets past
// 047; your ticket says 9,413,882. The clocks keep HERE, THERE, LATER and NEVER.
import type { View } from "@ianbicking/canvas-loop";
import { type RoomSpec, at, blob, glow, hash, mixHex, roundRectPts, stroke } from "./kit-tea.js";
import { mouldedChair, placard, speech } from "./parts-b-tea.js";
import { amaEye, amaSpeaker, citizen, clock, plant, poster, tubeGlow, tubeLight } from "./props-tea.js";
import { m } from "./sizes-tea.js";

const ROW_A = [0.9, 1.5, 2.1, 2.7, 3.3] as const, ROW_B = [1.2, 1.8, 2.4, 3.0, 3.6] as const;
const DA = 1.0, DB = 1.9;
const CHAIRS = ["#e8783a", "#d8a03a", "#5a9a8a", "#c85a4a"] as const;

const CLOCKS: readonly [number, number, string][] = [[1.35, 4.62, "HERE"], [2.1, 11.08, "THERE"], [2.85, 7.4, "LATER"], [3.6, 2.93, "NEVER"], [4.35, 9.5, "SOON"]];

function paintWall(v: View): void {
  for (const [x, time, label] of CLOCKS) {
    clock(v, x, 2.3, time);
    const [lx, ly] = at(x, 2.3, 0);
    v.text(label, { x: lx, y: ly + 30 }, { size: 8, fill: "#2a2a30", align: "center", valign: "middle", style: "bold" });
  }
  tubeLight(v, 1.6, 2.75, 1.0);
  tubeLight(v, 4.4, 2.75, 1.0);
  poster(v, 4.95, "calm", { h: 1.55 });
  // The hatch: a hatch with a roller shutter, pulled down, and a dusty bell.
  const [hx, hy] = at(6.0, 1.45, 0);
  const hw = m(0.9), hh = m(0.8);
  blob(v, roundRectPts(hx - hw / 2 - 10, hy - hh / 2 - 10, hw + 20, hh + 30, 6), { fill: "#8a8478", light: "#a8a296", seed: 4000, line: 2.2 });
  blob(v, [[hx - hw / 2, hy - hh / 2], [hx + hw / 2, hy - hh / 2], [hx + hw / 2, hy + hh / 2], [hx - hw / 2, hy + hh / 2]], { fill: "#b8b0a0", dark: "#6a6458", seed: 4001, line: 1.8, shadeSide: "bottom" });
  for (let y = hy - hh / 2 + 8; y < hy + hh / 2; y += 9) stroke(v, [[hx - hw / 2 + 2, y], [hx + hw / 2 - 2, y]], { seed: 4002 + y, weight: 1, colour: "#6a6458", amp: 0.3 });
  blob(v, [[hx - hw / 2 - 14, hy + hh / 2 + 4], [hx + hw / 2 + 14, hy + hh / 2 + 4], [hx + hw / 2 + 14, hy + hh / 2 + 16], [hx - hw / 2 - 14, hy + hh / 2 + 16]], { fill: "#6a5040", seed: 4010, line: 2 });
  v.arc(hx + 34, hy + hh / 2 + 4, 8, Math.PI, Math.PI * 2, { fill: "#c8b060", stroke: "#241c17", weight: 1.4 });
  placard(v, hx - 6, hy - 4, ["BACK IN", "5 MINUTES"], { w: 78, size: 10, bg: "#f0ead8", ink: "#3a2a20", seed: 4011, rot: -0.05 });
  // NOW SERVING board above it.
  const [nx, ny] = at(6.0, 2.4, 0);
  blob(v, roundRectPts(nx - 62, ny - 26, 124, 52, 6), { fill: "#2a2a2e", light: "#4a4a50", seed: 4020, line: 2.2 });
  v.text("NOW SERVING", { x: nx, y: ny - 14 }, { size: 9, fill: "#e8e0c8", align: "center", valign: "middle", style: "bold" });
  v.rect(nx - 40, ny - 4, 80, 26, { fill: "#140808" });
  // Ticket dispenser on a post, one ticket out.
  const [dx, dy] = at(0.55, 0, 0.6);
  stroke(v, [[dx, dy], [dx, dy - m(1.0)]], { seed: 4030, weight: 6, colour: "#9a9aa0" });
  blob(v, roundRectPts(dx - 22, dy - m(1.3), 44, m(0.32), 10), { fill: "#c83a2a", light: "#e86a5a", dark: "#7a1a10", seed: 4031, line: 2, shadeSide: "right" });
  v.text("TAKE A", { x: dx, y: dy - m(1.22) }, { size: 7, fill: "#f8f0e0", align: "center", valign: "middle", style: "bold" });
  v.text("NUMBER", { x: dx, y: dy - m(1.13) }, { size: 7, fill: "#f8f0e0", align: "center", valign: "middle", style: "bold" });
  v.at({ translate: [dx + 26, dy - m(1.05)], rotate: 0.25 }, () => {
    blob(v, [[-4, -9], [56, -9], [56, 9], [-4, 9]], { fill: "#f4ecd0", seed: 4032, line: 1.2, amp: 0.4 });
    v.text("9,413,882", { x: 26, y: 0 }, { size: 9, fill: "#3a2a20", align: "center", valign: "middle", style: "bold" });
  });
  amaSpeaker(v, 6.75, 2.5);
}

/** A slithering pile of old magazines. */
function magazines(v: View, x: number, h: number, depth: number, titles: readonly string[], seed: number): void {
  const [px, py] = at(x, h, depth);
  let y = py;
  for (const [i, title] of titles.entries()) {
    const shift = (hash(i, 0, seed) - 0.5) * 14, th = 7 + hash(i, 1, seed) * 3;
    const c = ["#d8604a", "#e8c84a", "#4a8ac8", "#e8e0d0", "#7ab85a", "#c87ab8"][(i + seed) % 6] ?? "#e8e0d0";
    v.at({ translate: [px + shift, y - th / 2], rotate: (hash(i, 2, seed) - 0.5) * 0.12 }, () => {
      blob(v, [[-34, -th / 2], [34, -th / 2], [34, th / 2], [-34, th / 2]], { fill: mixHex(c, "#c8c0a8", 0.35), seed: seed + i, line: 1.2, amp: 0.3 });
      v.text(title, { x: 0, y: 0.5 }, { size: 6, fill: "#2a2018", align: "center", valign: "middle", style: "bold" });
    });
    y -= th;
  }
}

function furniture(v: View): void {
  // The bolted rows: one long beam per row, chairs facing the hatch.
  for (const [row, xs, d] of [[0, ROW_A, DA], [1, ROW_B, DB]] as const) {
    const [bx0, by] = at(xs[0] - 0.3, 0.2, d), [bx1] = at(xs[4] + 0.3, 0.2, d);
    for (const [i, x] of xs.entries()) {
      const broken = row === 1 && i === 2;
      mouldedChair(v, x, d, { colour: CHAIRS[(i + row) % CHAIRS.length] ?? "#e8783a", facing: 1, seed: 4100 + row * 20 + i, tilt: broken ? 0.22 : 0 });
    }
    blob(v, [[bx0, by - 4], [bx1, by - 4], [bx1, by + 4], [bx0, by + 4]], { fill: "#8a8a90", light: "#b8b8c0", seed: 4150 + row, line: 1.6, amp: 0.3 });
  }
  // A side table buried in magazines, and a pile on the floor.
  const [tx, ty] = at(4.4, 0, 1.4);
  blob(v, roundRectPts(tx - m(0.35), ty - m(0.42), m(0.7), 10, 3), { fill: "#6a5040", light: "#8a7060", seed: 4160, line: 2 });
  for (const lx of [-m(0.3), m(0.27)]) stroke(v, [[tx + lx, ty - m(0.4)], [tx + lx, ty]], { seed: 4161 + lx, weight: 4, colour: "#3a2a20" });
  magazines(v, 4.38, 0.44, 1.4, ["TUMBLERS TODAY", "SURFACE LIVING '77", "OXYGEN DIGEST", "GROGNAK #3", "WAITING MONTHLY"], 4170);
  magazines(v, 3.95, 0, 2.3, ["BUNKER & GARDEN", "POPULAR HYGIENE", "TUMBLERS TODAY", "AMA'S WEEKLY"], 4180);
  magazines(v, 5.0, 0, 2.2, ["WHAT TO EXPECT", "WHEN WAITING", "THE NEW 1978", "SPRING LOOKS"], 4190);
  plant(v, 6.75, 0.5, { h: 0.9, leaf: "#7a9a5a", seed: 4200 });
}

export const WAITING_ROOM: RoomSpec = {
  id: "waiting-room",
  name: "Waiting Room",
  width: 7.0,
  wall: "#a8a29e",
  trim: "#5a5450",
  sky: "overcast",
  dead: [2],
  floor: "lino",
  floorColour: "#7a7a6a",
  ambient: "#a8a8b4",
  freshPaint: { from: 4.7, to: 6.6, colour: "#e8b8a0" },
  exits: [
    { to: "Solitude Cubes", kind: "edge-left", label: "Solitude Cubes", glow: "#6366f1" },
  ],
  paintWall,
  paintFurniture: furniture,
  live: (v, t) => {
    // The tubes: one steady-ish, one stuttering badly.
    tubeGlow(v, 1.6, 2.75, t, { w: 1.0, flicker: true });
    const bad = hash(Math.floor(t / 3), 7, 4300) < 0.45 || Math.floor(t / 40) % 4 === 1;
    if (!bad) tubeGlow(v, 4.4, 2.75, t, { w: 1.0 });
    else {
      const [cx, cy] = at(4.4, 2.75, 0);
      v.rect(cx - m(0.5) + 6, cy - 2, m(1.0) - 12, 4, { fill: "#6a6a62" });
    }
    // NOW SERVING: 047, a ding, 048 for a moment, then back to 047.
    const [nx, ny] = at(6.0, 2.4, 0);
    const k = t % 110, ding = k > 70 && k < 84;
    v.text(ding ? "048" : "047", { x: nx, y: ny + 9 }, { size: 20, fill: "#ff3a2a", align: "center", valign: "middle", style: "bold", font: "Courier New, monospace" });
    glow(v, nx, ny + 9, { rx: 50, ry: 20, colour: "#ff3a2a", alpha: 0.3 });
    if (ding) speech(v, nx + 40, ny - 24, "ding!", 1, { size: 10 });
    else if (k >= 84 && k < 100) speech(v, nx + 40, ny - 24, "...correction.", 0.9, { size: 10 });
    // The waiting: one reads, one sleeps, one has given up and stares at the clocks.
    citizen(v, { x: ROW_A[1] + 0.02, depth: DA + 0.05, pose: "sit", suit: "#6a6a7a", collar: "#a8a29e", number: "23" }, t);
    citizen(v, { x: ROW_A[3] + 0.02, depth: DA + 0.05, pose: "sit", suit: "#5a6a5a", collar: "#a8a29e", number: "61", hair: "#8a8a8a" }, t);
    citizen(v, { x: ROW_B[0] + 0.02, depth: DB + 0.05, pose: "sit", suit: "#7a5a4a", collar: "#a8a29e", number: "09", hair: "#a86a2a" }, t);
    citizen(v, { x: ROW_B[3] + 0.02, depth: DB + 0.05, pose: "sit", suit: "#4a5a7a", collar: "#a8a29e", number: "40" }, t);
    // A magazine held up by 23.
    const [mx, my] = at(ROW_A[1] + 0.27, 1.0, DA + 0.05);
    v.at({ translate: [mx, my], rotate: -0.3 + Math.sin(t * 0.03) * 0.04 }, () => blob(v, [[-4, -18], [6, -16], [6, 16], [-4, 18]], { fill: "#e8c84a", seed: 4310, line: 1.4 }));
    // 61 is asleep.
    const [zx, zy] = at(ROW_A[3] + 0.1, 1.45, DA);
    for (let i = 0; i < 3; i++) {
      const u = ((t * 0.012 + i / 3) % 1);
      v.text("z", { x: zx + u * 30 + i * 2, y: zy - u * 50 }, { size: 9 + u * 9, fill: `rgba(40,40,60,${(1 - u).toFixed(3)})`, align: "center", valign: "middle", style: "bold italic" });
    }
    amaEye(v, 6.75, 2.5, t);
  },
  rim: { x: 230, y: 230, colour: "#e8f0ff", reach: 500 },
};
