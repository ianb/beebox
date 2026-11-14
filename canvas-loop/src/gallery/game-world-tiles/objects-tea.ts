// Props drawn as free sprites over the ground: each anchored at the bottom centre of
// its cell, drawn back to front, and moving with the same wind as the grass.
import type { View } from "@ianbicking/canvas-loop";
import { H, PERIOD, S, W, hash, objectAt, wind } from "./map-tea.js";
import { LEAVES, foliage, paintedSprite, placeSprite } from "./paint-tea.js";

interface At {
  /** Anchor: the point on the ground the prop stands on. */
  ax: number;
  ay: number;
  x: number;
  y: number;
  t: number;
}

function shadow(v: View, a: { ax: number; ay: number; rx: number; ry: number }): void {
  v.ellipse(a.ax, a.ay, a.rx, a.ry, { fill: v.ellipseGradient(a.ax, a.ay, a.rx, a.ry, [[0, "rgba(20,35,15,0.45)"], [0.7, "rgba(20,35,15,0.25)"], [1, "rgba(20,35,15,0)"]]) });
}

const TREE_LOOK: Record<string, { leaves: string; r: number }> = {
  T: { leaves: "green", r: 26 },
  O: { leaves: "oak", r: 31 },
  A: { leaves: "autumn", r: 28 },
  y: { leaves: "young", r: 15 },
};

/** A broadleaf tree: a trunk with root flare, and a painted crown (a sprite, painted
 * once) that leans with the wind about the top of the trunk. */
function tree(v: View, a: At, kind: string): void {
  const { leaves, r } = TREE_LOOK[kind] ?? { leaves: "green", r: 26 };
  const look = LEAVES[leaves];
  if (!look) return;
  const { ax, ay, x, y } = a;
  const trunkH = r * 1.3;
  shadow(v, { ax: ax + 4, ay: ay - 1, rx: r * 0.9, ry: r * 0.32 });
  const tw = Math.max(3, r * 0.16);
  v.path(
    [
      ["move", ax - tw * 1.9, ay],
      ["quad", ax - tw, ay - 3, ax - tw, ay - trunkH],
      ["line", ax + tw, ay - trunkH],
      ["quad", ax + tw, ay - 3, ax + tw * 2, ay],
      ["close"],
    ],
    { fill: "#6b4a2e" },
  );
  v.path([["move", ax + tw * 0.2, ay - 1], ["quad", ax + tw * 0.6, ay - trunkH * 0.5, ax + tw * 0.4, ay - trunkH]], { stroke: "#4a311d", weight: tw * 0.7 });
  v.path([["move", ax - tw * 0.6, ay - 2], ["quad", ax - tw * 0.8, ay - trunkH * 0.5, ax - tw * 0.6, ay - trunkH]], { stroke: "#8a6440", weight: tw * 0.4 });
  const size = Math.ceil(r * 2.5);
  const crown = paintedSprite(v, { key: `crown-${x}-${y}`, w: size, h: size }, () => {
    foliage(v, { cx: size / 2, cy: size / 2, r, look, x, y, salt: 3 });
  });
  const lean = wind(ax, ay - trunkH, a.t) * 0.035;
  v.at({ translate: [ax, ay - trunkH], rotate: lean }, () => placeSprite(v, crown, -size / 2, -r * 0.75 - size / 2));
}

/** A conifer: stacked tiers, each a dark skirt with brushed needle strokes sweeping
 * down and out from the trunk, lit on the left. Painted once as a sprite. */
function pine(v: View, a: At): void {
  const { ax, ay, x, y } = a;
  shadow(v, { ax: ax + 3, ay: ay - 1, rx: 22, ry: 7 });
  v.rect(ax - 3, ay - 16, 6, 16, { fill: "#5a3c25" });
  const w = 60, h = 112;
  const body = paintedSprite(v, { key: `pine-${x}-${y}`, w, h }, () => {
    const cx = w / 2;
    for (let i = 0; i < 5; i++) {
      const bottom = h - 6 - i * 18, top = bottom - 34;
      const half = 26 - i * 4.5;
      const skirt: [number, number][] = [[cx, top]];
      for (let k = 0; k <= 8; k++) {
        const px = cx + half - (2 * half * k) / 8;
        skirt.push([px, bottom - (k % 2 === 0 ? 0 : 3 + hash(x, y, 700 + i * 9 + k) * 3)]);
      }
      v.polygon(skirt, { fill: "#1d4630" });
      for (let k = 0; k < 14; k++) {
        const side = k % 2 === 0 ? -1 : 1;
        const along = 0.15 + hash(x, y, 720 + i * 20 + k) * 0.85;
        const sx = cx + side * half * along * 0.25, sy = top + (bottom - top) * along * 0.6;
        const ex = cx + side * half * along, ey = bottom - 2 - hash(x, y, 740 + i * 20 + k) * 4;
        const stroke = side < 0 ? (along > 0.5 ? "#5f9a58" : "#3f7a48") : along > 0.6 ? "#2c5e3c" : "#244e34";
        v.line(sx, sy, ex, ey, { stroke, weight: 3, brush: { preset: "bristle", lightJitter: 0.06, hueJitter: 5 }, gesture: { pressure: "taper-out" } });
      }
    }
  });
  const lean = wind(ax, ay, a.t) * 0.025;
  v.at({ translate: [ax, ay - 10], rotate: lean }, () => placeSprite(v, body, -w / 2, -h + 6));
}

function fence(v: View, a: At): void {
  const { ax, ay, x, y } = a;
  const east = objectAt(x + 1, y) === "f";
  if (east) {
    for (const ry of [ay - 13, ay - 6]) {
      v.rect(ax, ry, S, 3, { fill: "#8a5f3a" });
      v.rect(ax, ry + 2, S, 1, { fill: "#5e3d22" });
    }
  }
  shadow(v, { ax: ax + 2, ay, rx: 5, ry: 2 });
  v.rect(ax - 2.5, ay - 18, 5, 18, { fill: "#7a5233" });
  v.rect(ax - 2.5, ay - 18, 1.5, 18, { fill: "#a07048" });
  v.rect(ax - 3, ay - 19, 6, 2, { fill: "#5e3d22" });
}

function well(v: View, a: At): void {
  const { ax, ay } = a;
  const cy = ay - 10;
  shadow(v, { ax: ax + 2, ay: ay - 2, rx: 24, ry: 9 });
  v.ellipse(ax, cy + 6, 21, 11, { fill: "#6c6a68" });
  v.rect(ax - 21, cy - 2, 42, 8, { fill: "#6c6a68" });
  v.ellipse(ax, cy - 2, 21, 11, { fill: "#a8a29a" });
  v.ellipse(ax, cy - 2, 15, 7, { fill: "#203038" });
  v.ellipse(ax, cy, 12, 4.5, { fill: v.ellipseGradient(ax, cy, 12, 4.5, [[0, "#3c6e88"], [1, "#203038"]]) });
  // Stones in the wall: short dark seams around the front face.
  for (let i = 0; i < 9; i++) {
    const ang = Math.PI * (0.1 + (i / 8) * 0.8);
    const sx = ax + Math.cos(ang) * 21, sy = cy + 1 + Math.sin(ang) * 11;
    v.line(sx, sy - 3, sx, sy + 3, { stroke: "#4e4c4a", weight: 1 });
  }
  v.ellipse(ax, cy - 2, 21, 11, { stroke: "#cfc9bf", weight: 1 });
  // Posts, beam and a bucket that swings a little.
  v.rect(ax - 19, cy - 34, 4, 34, { fill: "#6b4a2e" });
  v.rect(ax + 15, cy - 34, 4, 34, { fill: "#6b4a2e" });
  v.rect(ax - 21, cy - 36, 42, 4, { fill: "#7c5636" });
  const swing = Math.sin((2 * Math.PI * a.t) / PERIOD) * 2;
  v.line(ax, cy - 32, ax + swing, cy - 16, { stroke: "#c8b48a", weight: 0.8 });
  v.rect(ax + swing - 3.5, cy - 16, 7, 6, { fill: "#8a5f3a" });
  v.rect(ax + swing - 3.5, cy - 16, 7, 1.2, { fill: "#5e3d22" });
}

function haystack(v: View, a: At): void {
  const { ax, ay, x, y } = a;
  shadow(v, { ax: ax + 3, ay: ay - 1, rx: 17, ry: 6 });
  v.path([["move", ax - 16, ay], ["bezier", ax - 17, ay - 26, ax + 17, ay - 26, ax + 16, ay], ["close"]], { fill: "#c9a43e" });
  v.path([["move", ax - 9, ay - 2], ["bezier", ax - 10, ay - 20, ax + 4, ay - 22, ax + 6, ay - 16], ["line", ax - 2, ay - 2], ["close"]], { fill: "#e3c35e" });
  for (let i = 0; i < 18; i++) {
    const sx = ax - 13 + hash(x, y, 800 + i) * 26, sy = ay - 2 - hash(x, y, 820 + i) * 16;
    const ang = (hash(x, y, 840 + i) - 0.5) * 1.2;
    v.line(sx, sy, sx + Math.sin(ang) * 4, sy - Math.cos(ang) * 4, { stroke: i % 3 === 0 ? "#9a7a2a" : "#f0d878", weight: 0.7 });
  }
}

function bush(v: View, a: At): void {
  const { ax, ay, x, y } = a;
  shadow(v, { ax: ax + 2, ay: ay - 1, rx: 14, ry: 5 });
  const look = LEAVES["bush"];
  if (!look) return;
  const size = 36;
  const body = paintedSprite(v, { key: `bush-${x}-${y}`, w: size, h: size }, () => {
    foliage(v, { cx: size / 2, cy: size / 2 + 2, r: 13, look, x, y, salt: 9 });
    for (let i = 0; i < 7; i++) {
      v.circle(size / 2 - 9 + hash(x, y, 860 + i) * 18, size / 2 - 6 + hash(x, y, 870 + i) * 12, 1.4, { fill: i % 3 === 0 ? "#e8606e" : "#b82e40" });
    }
  });
  v.at({ translate: [ax, ay], rotate: wind(ax, ay, a.t) * 0.04 }, () => placeSprite(v, body, -size / 2, -size + 4));
}

function rock(v: View, a: At): void {
  const { ax, ay } = a;
  shadow(v, { ax: ax + 2, ay: ay - 1, rx: 11, ry: 4 });
  v.polygon([[ax - 10, ay - 1], [ax - 8, ay - 9], [ax - 1, ay - 13], [ax + 7, ay - 10], [ax + 10, ay - 2]], { fill: "#7c7a74" });
  v.polygon([[ax - 8, ay - 9], [ax - 1, ay - 13], [ax + 2, ay - 8], [ax - 5, ay - 5]], { fill: "#a9a69c" });
  v.ellipse(ax + 10, ay - 1, 3.5, 2.4, { fill: "#8d8a82" });
  v.ellipse(ax - 13, ay - 2, 2.2, 1.6, { fill: "#8d8a82" });
}

function mushrooms(v: View, a: At): void {
  const { ax, ay } = a;
  for (const [mx, h, r] of [[-5, 8, 5], [4, 6, 4], [9, 4, 2.5]] as const) {
    v.ellipse(ax + mx + 1, ay, r, r * 0.35, { fill: "rgba(20,35,15,0.35)" });
    v.rect(ax + mx - 1.2, ay - h, 2.4, h, { fill: "#efe3c8" });
    v.path([["move", ax + mx - r, ay - h + 1], ["quad", ax + mx, ay - h - r * 1.3, ax + mx + r, ay - h + 1], ["close"]], { fill: "#a0522d" });
    v.circle(ax + mx - r * 0.3, ay - h - r * 0.3, r * 0.22, { fill: "#f3e0c0" });
  }
}

/** A disc with a wedge cut out, as polygon points: a lily pad's notch. */
function notched(r: number, ry: number): [number, number][] {
  const pts: [number, number][] = [[0, 0]];
  for (let i = 0; i <= 20; i++) {
    const ang = 0.4 + (i / 20) * (Math.PI * 2 - 0.55);
    pts.push([Math.cos(ang) * r, Math.sin(ang) * ry]);
  }
  return pts;
}

function lily(v: View, a: At, flower: boolean): void {
  const { ax, x, y } = a;
  const ay = a.ay - 12;
  const ph = hash(x, y, 900) * Math.PI * 2;
  const bob = Math.sin((2 * Math.PI * a.t) / PERIOD + ph);
  const turn = hash(x, y, 910) * Math.PI * 2 + bob * 0.08;
  for (const [dx, dy, r, k] of [[0, 0, 8, 0], [-9, 6, 5.5, 1]] as const) {
    v.at({ translate: [ax + dx + bob * 0.8, ay + dy], rotate: turn + k * 2 }, () => {
      v.polygon(notched(r, r * 0.75).map(([px, py]) => [px + 1, py + 1.5]), { fill: "rgba(10,40,60,0.45)" });
      v.polygon(notched(r, r * 0.75), { fill: "#4f8f3a" });
      v.polygon(notched(r * 0.7, r * 0.5), { fill: "#62a447" });
      v.line(0, 0, -r * 0.8, 0, { stroke: "#3c7030", weight: 0.6 });
    });
  }
  if (!flower) return;
  const fx = ax + bob * 0.8 + 1, fy = ay - 3;
  for (let i = 0; i < 7; i++) {
    const ang = (i / 7) * Math.PI * 2;
    v.ellipse(fx + Math.cos(ang) * 2.8, fy + Math.sin(ang) * 2, 2.4, 1.5, { fill: i % 2 === 0 ? "#f3a6c0" : "#e77aa0" });
  }
  v.circle(fx, fy - 1, 2.2, { fill: "#fbd2df" });
  v.circle(fx, fy - 1, 1, { fill: "#f2c53d" });
}

function reeds(v: View, a: At): void {
  const { ax, ay, x, y } = a;
  for (let i = 0; i < 7; i++) {
    const bx = ax - 9 + hash(x, y, 950 + i) * 18;
    const h = 18 + hash(x, y, 960 + i) * 14;
    const sway = wind(bx, ay, a.t) * (3 + h * 0.08);
    const tx = bx + sway, ty = ay - h;
    v.path([["move", bx - 0.8, ay], ["quad", bx, ay - h * 0.5, tx, ty], ["quad", bx + 0.2, ay - h * 0.5, bx + 0.8, ay], ["close"]], { fill: i % 2 === 0 ? "#3f7a34" : "#5a9440" });
    if (i % 2 === 0) {
      const hx = bx + sway * 0.85, hy = ay - h * 0.82;
      v.at({ translate: [hx, hy], rotate: sway * 0.05 }, () => {
        v.roundRect(-1.6, -5, 3.2, 10, 1.6, { fill: "#6a3a22" });
        v.rect(-1.6, -4, 1, 7, { fill: "#8a5232" });
      });
    }
  }
}

function barrel(v: View, a: At): void {
  const { ax, ay } = a;
  shadow(v, { ax: ax + 2, ay: ay - 1, rx: 11, ry: 4 });
  v.path([["move", ax - 9, ay - 2], ["quad", ax - 12, ay - 12, ax - 9, ay - 22], ["line", ax + 9, ay - 22], ["quad", ax + 12, ay - 12, ax + 9, ay - 2], ["close"]], { fill: "#8a5a34" });
  v.ellipse(ax, ay - 22, 9, 3.5, { fill: "#a87348" });
  for (const hy of [ay - 6, ay - 18]) v.rect(ax - 10.5, hy, 21, 2, { fill: "#4c4a48" });
  v.line(ax - 5, ay - 3, ax - 6, ay - 21, { stroke: "#6e4626", weight: 0.8 });
  v.line(ax + 4, ay - 3, ax + 5, ay - 21, { stroke: "#6e4626", weight: 0.8 });
}

/** Crops, one row per cell: cabbages, carrots (feathery tops over orange
 * shoulders) and wheat (stalks with heavy heads that ripple in a wave). */
function crop(v: View, a: At, o: string): void {
  const { ax, x, y, t } = a;
  const ay = a.ay - 3;
  if (o === "c") {
    for (const dx of [-8, 8]) {
      const cx = ax + dx;
      v.ellipse(cx + 1, ay + 2, 7, 2.5, { fill: "rgba(30,20,10,0.4)" });
      for (let i = 0; i < 6; i++) {
        const ang = (i / 6) * Math.PI * 2 + hash(x, y, 980 + dx);
        v.ellipse(cx + Math.cos(ang) * 4, ay - 3 + Math.sin(ang) * 2.5, 4, 3, { fill: "#4f9a4a" });
      }
      v.circle(cx, ay - 4, 4.2, { fill: "#8fcf7a" });
      v.circle(cx - 1, ay - 5, 2, { fill: "#b9e6a2" });
    }
    return;
  }
  if (o === "k") {
    for (const dx of [-10, -3, 4, 11]) {
      const cx = ax + dx;
      const sway = wind(cx, ay, t) * 1.8;
      v.ellipse(cx, ay - 1, 2.4, 1.6, { fill: "#e07a2c" });
      for (let i = -1; i <= 1; i++) {
        v.path([["move", cx, ay - 2], ["quad", cx + i * 2, ay - 6, cx + i * 3 + sway, ay - 10 - Math.abs(i) * -1]], { stroke: "#4f9a3a", weight: 1.1 });
        v.circle(cx + i * 3 + sway, ay - 10 + Math.abs(i), 1.6, { fill: "#66b048" });
      }
    }
    return;
  }
  if (o === "w") {
    for (let i = 0; i < 9; i++) {
      const bx = x * S + 2 + (i / 8) * (S - 4) + (hash(x, y, 990 + i) - 0.5) * 2;
      const h = 20 + hash(x, y, 1000 + i) * 6;
      const sway = wind(bx, ay, t) * 4.5;
      const tx = bx + sway, ty = ay - h;
      v.path([["move", bx, ay], ["quad", bx, ay - h * 0.6, tx, ty]], { stroke: "#b89a4a", weight: 0.9 });
      v.at({ translate: [tx, ty], rotate: sway * 0.06 }, () => {
        v.ellipse(0, -2.5, 1.9, 4.2, { fill: "#d9b34f" });
        v.ellipse(-0.6, -3, 0.8, 3, { fill: "#f2d478" });
      });
    }
  }
}

export function paintObjects(v: View, t: number): void {
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = objectAt(x, y);
      if (o === ".") continue;
      const a: At = { ax: x * S + HALF, ay: y * S + S - 4, x, y, t };
      paintOne(v, a, o);
    }
  }
}

const HALF = S / 2;

function paintOne(v: View, a: At, o: string): void {
  switch (o) {
    case "T":
    case "O":
    case "A":
    case "y": tree(v, a, o); return;
    case "P": pine(v, a); return;
    case "f": fence(v, a); return;
    case "W": well(v, a); return;
    case "H": haystack(v, a); return;
    case "b": bush(v, a); return;
    case "r": rock(v, a); return;
    case "m": mushrooms(v, a); return;
    case "l": lily(v, a, false); return;
    case "L": lily(v, a, true); return;
    case "R": reeds(v, a); return;
    case "B": barrel(v, a); return;
    default: crop(v, a, o);
  }
}
