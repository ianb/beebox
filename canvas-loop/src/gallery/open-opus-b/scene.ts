// Backdrop: dusk sky, moon, far hills, the stilt village, and the water.
import type { Sketch, Vec2 } from "@ianbicking/canvas-loop";

export const HORIZON = 470;

export const C = {
  skyTop: "#1c2150",
  skyMid: "#4a3f7d",
  skyRose: "#b8648a",
  skyGlow: "#f3a66c",
  skyLow: "#f8cf8f",
  hill: "#6a5f92",
  hillFar: "#8f7aa6",
  house: "#3b2d4d",
  houseLit: "#5a4060",
  roof: "#271f3f",
  window: "#ffd27a",
  waterTop: "#e9a77c",
  waterMid: "#6b5d93",
  waterLow: "#232650",
  moon: "#fbf1d0",
} as const;

export function drawSky(s: Sketch): void {
  s.background(
    s.linearGradient(0, 0, 0, HORIZON, [
      [0, C.skyTop],
      [0.42, C.skyMid],
      [0.75, C.skyRose],
      [0.93, C.skyGlow],
      [1, C.skyLow],
    ]),
  );
  // Moon and its halo.
  s.noStroke();
  s.fill(s.radialGradient(190, 130, 110, [
    [0, "rgba(251,241,208,0.35)"],
    [1, "rgba(251,241,208,0)"],
  ]));
  s.circle(190, 130, 220);
  s.fill(C.moon);
  s.circle(190, 130, 58);
  // Stars.
  s.fill("rgba(255,244,214,0.85)");
  for (let i = 0; i < 40; i += 1) {
    const x = s.random(0, 800);
    const y = s.random(0, 230);
    s.circle(x, y, s.random(1, 2.6));
  }
  // A broad rose wash low in the sky.
  s.noFill();
  s.brush("wash", { opacity: 0.4 });
  s.gesture({ pressure: "swell", wobble: 8 });
  s.stroke("#d77d95");
  s.strokeWeight(70);
  s.curve([[-40, 360], [400, 345], [840, 365]]);
  // Cloud streaks: a lavender body, its underside lit rose and peach by the set sun.
  const clouds: readonly { x: number; y: number; len: number; w: number }[] = [
    { x: 420, y: 215, len: 300, w: 16 },
    { x: 560, y: 248, len: 260, w: 22 },
    { x: 300, y: 285, len: 340, w: 18 },
    { x: 610, y: 320, len: 240, w: 14 },
    { x: -30, y: 300, len: 260, w: 16 },
    { x: 40, y: 250, len: 180, w: 10 },
    { x: 500, y: 380, len: 320, w: 10 },
    { x: 120, y: 385, len: 220, w: 9 },
  ];
  for (const c of clouds) {
    const lowGlow = c.y > 300;
    s.brush("bristle", { bristles: 14, load: 0.95, flow: 0.55, spread: 0.6 });
    s.gesture({ pressure: [[0, 0.2], [0.35, 1], [0.8, 0.8], [1, 0.1]], wobble: 3 });
    s.stroke(lowGlow ? "#9b6a9e" : "#6a5596");
    s.strokeWeight(c.w);
    s.curve([[c.x, c.y + 3], [c.x + c.len * 0.45, c.y - c.w * 0.3], [c.x + c.len, c.y + 2]]);
    s.brush("bristle", { bristles: 10, load: 0.9, flow: 0.6, spread: 0.5 });
    s.gesture({ pressure: "taper", wobble: 2 });
    s.stroke(lowGlow ? "#f7b58a" : "#de8aa0");
    s.strokeWeight(c.w * 0.45);
    s.curve([[c.x + c.len * 0.15, c.y + c.w * 0.45], [c.x + c.len * 0.5, c.y + c.w * 0.3], [c.x + c.len * 0.9, c.y + c.w * 0.5]]);
  }
  s.noBrush();
  // Far hills behind the village.
  s.noStroke();
  s.fill(C.hillFar);
  s.curve([[-20, HORIZON], [-20, 420], [80, 405], [190, 425], [300, 440], [420, 462], [480, HORIZON]], true);
  s.fill(C.hill);
  s.curve([[-20, HORIZON], [-20, 438], [100, 432], [220, 446], [360, HORIZON]], true);
}

export function drawWater(s: Sketch): void {
  s.noStroke();
  s.fill(
    s.linearGradient(0, HORIZON, 0, 800, [
      [0, C.waterTop],
      [0.18, "#b8708e"],
      [0.45, C.waterMid],
      [1, C.waterLow],
    ]),
  );
  s.rect(0, HORIZON, 800, 330);
  // Ripples: bristle strokes in several values, the sky's colours mirrored.
  s.noFill();
  const near = ["#f8c99a", "#f2a77e", "#d98a96"];
  const mid = ["#9d7fb0", "#7c6aa3", "#c48aa0", "#5c5590"];
  const low = ["#3d3f78", "#2e3068", "#6e64a0", "#4a4a86"];
  for (let i = 0; i < 150; i += 1) {
    const t = i / 150;
    const y = HORIZON + 4 + t * t * 330;
    const x = s.random(-60, 780);
    const len = 30 + t * 160 + s.random(0, 80);
    const pal = t < 0.25 ? near : t < 0.6 ? mid : low;
    s.brush("bristle", { bristles: 7, load: 0.85, spread: 0.5, flow: 0.65 });
    s.stroke(s.randomChoice(pal));
    s.strokeWeight(2.5 + t * 8);
    s.gesture({ pressure: "taper", wobble: 1 + t });
    s.line(x, y, x + len, y + s.random(-1.5, 1.5));
  }
  // The moon's reflection: a broken, drifting column of pale dabs.
  s.brush("ink");
  for (let y = 498; y < 790; y += 5 + (y - 498) / 18 + s.random(0, 6)) {
    const t = (y - 498) / 292;
    if (s.random() < 0.2) continue;
    const half = (6 + t * 30) * s.random(0.3, 1.1);
    const cx = 190 + s.random(-10, 10) + Math.sin(y * 0.07) * 6;
    s.stroke(`rgba(251,236,196,${(0.85 - t * 0.5).toFixed(2)})`);
    s.strokeWeight(1.5 + t * 2.5);
    s.gesture({ pressure: "taper", wobble: 0.6 });
    s.line(cx - half, y, cx + half, y + s.random(-0.8, 0.8));
  }
  s.noBrush();
}

interface House {
  readonly x: number;
  readonly w: number;
  readonly base: number;
  readonly h: number;
  readonly roof: number;
}

const HOUSES: readonly House[] = [
  { x: 22, w: 88, base: 448, h: 66, roof: 40 },
  { x: 118, w: 70, base: 458, h: 52, roof: 34 },
  { x: 196, w: 104, base: 476, h: 74, roof: 46 },
];

function houseShape(h: House): Vec2[] {
  const top = h.base - h.h;
  return [
    [h.x, h.base],
    [h.x, top],
    [h.x + h.w / 2, top - h.roof],
    [h.x + h.w, top],
    [h.x + h.w, h.base],
  ];
}

function drawHouse(s: Sketch, h: House): void {
  // Stilts.
  s.stroke(C.roof);
  s.strokeWeight(4);
  s.brush("ink");
  s.gesture({ pressure: "even", wobble: 0.6 });
  for (let i = 0; i <= 3; i += 1) {
    const x = h.x + 6 + (i * (h.w - 12)) / 3;
    s.line(x, h.base, x, h.base + 26);
  }
  s.noBrush();
  s.noStroke();
  s.fill(C.house);
  s.polygon(houseShape(h));
  const top = h.base - h.h;
  s.fill(C.roof);
  s.polygon([
    [h.x - 8, top + 4],
    [h.x + h.w / 2, top - h.roof - 4],
    [h.x + h.w + 8, top + 4],
    [h.x + h.w + 8, top + 10],
    [h.x + h.w / 2, top - h.roof + 6],
    [h.x - 8, top + 10],
  ]);
  // Board texture on the walls, and the sky's light along the roof's upper edge.
  s.clip(houseShape(h), () => {
    s.noFill();
    s.brush("bristle", { bristles: 8, load: 0.95, flow: 0.5, spread: 0.5 });
    s.gesture({ pressure: "even", wobble: 0.6 });
    for (let x = h.x + 5; x < h.x + h.w; x += 9) {
      s.stroke(x % 2 === 0 ? "#4a3a5c" : "#2f2541");
      s.strokeWeight(6);
      s.line(x, top - h.roof, x + 1, h.base);
    }
    s.noBrush();
  });
  s.noFill();
  s.stroke("#e79aa6");
  s.brush("ink", { opacity: 0.95 });
  s.gesture({ pressure: "taper", wobble: 0.4 });
  s.strokeWeight(3);
  s.line(h.x - 6, top + 3, h.x + h.w / 2, top - h.roof - 3);
  s.stroke("#f2a77e");
  s.line(h.x + h.w / 2, top - h.roof - 3, h.x + h.w + 6, top + 3);
  s.noBrush();
  s.noStroke();
  // Windows with glow.
  const wy = top + h.h * 0.3;
  for (const fx of [0.28, 0.66]) {
    const wx = h.x + h.w * fx;
    s.fill(s.radialGradient(wx, wy + 8, 30, [
      [0, "rgba(255,200,110,0.45)"],
      [1, "rgba(255,200,110,0)"],
    ]));
    s.circle(wx, wy + 8, 60);
    s.fill(C.window);
    s.rect(wx - 7, wy, 14, 17);
  }
}

export function drawVillage(s: Sketch): void {
  // Reflections first, painted as broken horizontal strokes, then the houses.
  s.noFill();
  for (const h of HOUSES) {
    const water = h.base + 26;
    const tall = (h.h + h.roof) * 0.95;
    s.brush("bristle", { bristles: 8, load: 0.9, flow: 0.75 });
    s.gesture({ pressure: "taper", wobble: 1 });
    for (let d = 2; d < tall; d += 4.5) {
      const t = d / tall;
      const half = d < h.h ? h.w / 2 : (h.w / 2) * (1 - (d - h.h) / h.roof);
      const cx = h.x + h.w / 2 + s.random(-4, 4);
      s.stroke(`rgba(44,34,70,${(0.7 - t * 0.45).toFixed(2)})`);
      s.strokeWeight(4.5);
      s.line(cx - half - s.random(2, 10), water + d, cx + half + s.random(2, 10), water + d);
    }
    // Window light, stretched by the ripples.
    s.brush("wash", { opacity: 0.55 });
    s.gesture({ pressure: "taper-out", wobble: 3 });
    s.stroke("#ffc979");
    s.strokeWeight(10);
    const wy = water + (h.base - h.h * 0.7 - water) * -1;
    for (const fx of [0.28, 0.66]) {
      const wx = h.x + h.w * fx;
      s.line(wx, wy - 6, wx + 1, wy + 34);
    }
  }
  s.noBrush();
  for (const h of HOUSES) drawHouse(s, h);
  drawBoat(s);
}

/** The last boat still out, far off on the right, with its own small light. */
function drawBoat(s: Sketch): void {
  const bx = 778;
  const by = HORIZON + 4;
  s.noStroke();
  s.fill(s.radialGradient(bx + 4, by - 12, 22, [
    [0, "rgba(255,214,130,0.7)"],
    [1, "rgba(255,190,110,0)"],
  ]));
  s.circle(bx + 4, by - 12, 44);
  s.fill("#3a2c4d");
  s.polygon([[bx - 16, by - 4], [bx + 18, by - 4], [bx + 12, by + 2], [bx - 12, by + 2]]);
  s.stroke("#3a2c4d");
  s.strokeWeight(1.4);
  s.line(bx - 2, by - 4, bx - 2, by - 26);
  s.noStroke();
  s.fill("#fff0b8");
  s.circle(bx + 5, by - 12, 3.4);
}

/** Dark reeds in the near corners, for depth: filled tapering leaves. */
export function drawReeds(s: Sketch): void {
  const clumps: readonly { x: number; n: number; spread: number; h: number; dir: number }[] = [
    { x: 30, n: 13, spread: 100, h: 250, dir: 1 },
    { x: 790, n: 9, spread: 60, h: 180, dir: -1 },
  ];
  for (const c of clumps) {
    for (let i = 0; i < c.n; i += 1) {
      const x = c.x + s.random(-c.spread / 2, c.spread / 2);
      const h = c.h * s.random(0.5, 1);
      const lean = c.dir * s.random(-10, 50);
      const pts: Vec2[] = [[x, 815], [x + lean * 0.15, 815 - h * 0.45], [x + lean * 0.5, 815 - h * 0.8], [x + lean, 815 - h]];
      const leaf = s.tube(pts, { width: s.random(7, 12), profile: [[0, 1], [0.6, 0.7], [1, 0]] });
      s.noStroke();
      s.fill(i % 3 === 0 ? "#2c2543" : "#1a172d");
      s.path(leaf);
      s.clip(leaf, () => {
        s.noFill();
        s.stroke("#6a4f78");
        s.brush("wash", { opacity: 0.6 });
        s.strokeWeight(5);
        s.gesture({ pressure: "taper-in" });
        s.curve(pts.map(([px, py]): Vec2 => [px - 5 * c.dir, py]));
        s.noBrush();
      });
    }
    // A few cattail heads on stems.
    for (let i = 0; i < 3; i += 1) {
      const x = c.x + s.random(-c.spread / 3, c.spread / 3);
      const y = 815 - c.h * s.random(0.8, 1.1);
      s.noFill();
      s.stroke("#1a172d");
      s.brush("ink");
      s.strokeWeight(3);
      s.gesture({ pressure: "even", wobble: 1 });
      s.line(x, 815, x + 4 * c.dir, y);
      s.noBrush();
      const head = s.tube([[x + 4 * c.dir, y + 6], [x + 5 * c.dir, y + 36]], { width: 11 });
      s.noStroke();
      s.fill("#4a2f2c");
      s.path(head);
      s.clip(head, () => {
        s.noFill();
        s.stroke("#c47a5e");
        s.brush("wash", { opacity: 0.8 });
        s.strokeWeight(5);
        s.gesture({ pressure: "swell" });
        s.line(x + 4 * c.dir + 4 * c.dir, y + 8, x + 5 * c.dir + 4 * c.dir, y + 34);
        s.noBrush();
      });
    }
  }
}
