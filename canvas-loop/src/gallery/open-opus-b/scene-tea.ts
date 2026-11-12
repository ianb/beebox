// Backdrop: dusk sky, moon, far hills, the stilt village, and the water.
import type { Style, Util, Vec2, View } from "@ianbicking/canvas-loop";

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

// ── randomness, rolled once in init in the order the picture consumed it ──
export interface Star {
  readonly x: number;
  readonly y: number;
  readonly d: number;
}
export interface Ripple {
  readonly x: number;
  readonly y: number;
  readonly len: number;
  readonly color: string;
  readonly dy: number;
  readonly t: number;
}
export interface MoonDab {
  readonly y: number;
  readonly t: number;
  readonly half: number;
  readonly cx: number;
  readonly dy: number;
}
export interface HouseRipple {
  readonly cx: number;
  readonly left: number;
  readonly right: number;
}
export interface Leaf {
  readonly x: number;
  readonly h: number;
  readonly lean: number;
  readonly width: number;
}
export interface Cattail {
  readonly x: number;
  readonly y: number;
}
export interface SceneRandom {
  readonly stars: readonly Star[];
  readonly ripples: readonly Ripple[];
  readonly moonDabs: readonly MoonDab[];
  readonly houseRipples: readonly (readonly HouseRipple[])[];
  readonly leaves: readonly (readonly Leaf[])[];
  readonly cattails: readonly (readonly Cattail[])[];
}

const NEAR = ["#f8c99a", "#f2a77e", "#d98a96"];
const MID = ["#9d7fb0", "#7c6aa3", "#c48aa0", "#5c5590"];
const LOW = ["#3d3f78", "#2e3068", "#6e64a0", "#4a4a86"];

const REED_CLUMPS: readonly {
  x: number;
  n: number;
  spread: number;
  h: number;
  dir: number;
}[] = [
  { x: 30, n: 13, spread: 100, h: 250, dir: 1 },
  { x: 790, n: 9, spread: 60, h: 180, dir: -1 },
];

function rollStars(u: Util): Star[] {
  const stars: Star[] = [];
  for (let i = 0; i < 40; i += 1) {
    const x = u.random(0, 800);
    const y = u.random(0, 230);
    stars.push({ x, y, d: u.random(1, 2.6) });
  }
  return stars;
}

function rollRipples(u: Util): Ripple[] {
  const out: Ripple[] = [];
  for (let i = 0; i < 150; i += 1) {
    const t = i / 150;
    const y = HORIZON + 4 + t * t * 330;
    const x = u.random(-60, 780);
    const len = 30 + t * 160 + u.random(0, 80);
    const pal = t < 0.25 ? NEAR : t < 0.6 ? MID : LOW;
    const color = u.randomChoice(pal);
    out.push({ x, y, len, color, dy: u.random(-1.5, 1.5), t });
  }
  return out;
}

function rollMoonDabs(u: Util): MoonDab[] {
  const out: MoonDab[] = [];
  for (let y = 498; y < 790; y += 5 + (y - 498) / 18 + u.random(0, 6)) {
    const t = (y - 498) / 292;
    if (u.random() < 0.2) continue;
    const half = (6 + t * 30) * u.random(0.3, 1.1);
    const cx = 190 + u.random(-10, 10) + Math.sin(y * 0.07) * 6;
    out.push({ y, t, half, cx, dy: u.random(-0.8, 0.8) });
  }
  return out;
}

function rollHouseRipples(u: Util): HouseRipple[][] {
  return HOUSES.map((h) => {
    const out: HouseRipple[] = [];
    const tall = (h.h + h.roof) * 0.95;
    for (let d = 2; d < tall; d += 4.5) {
      const cx = h.x + h.w / 2 + u.random(-4, 4);
      out.push({ cx, left: u.random(2, 10), right: u.random(2, 10) });
    }
    return out;
  });
}

function rollReeds(u: Util): { leaves: Leaf[][]; cattails: Cattail[][] } {
  const leaves: Leaf[][] = [];
  const cattails: Cattail[][] = [];
  for (const c of REED_CLUMPS) {
    const ls: Leaf[] = [];
    for (let i = 0; i < c.n; i += 1) {
      const x = c.x + u.random(-c.spread / 2, c.spread / 2);
      const h = c.h * u.random(0.5, 1);
      const lean = c.dir * u.random(-10, 50);
      ls.push({ x, h, lean, width: u.random(7, 12) });
    }
    leaves.push(ls);
    const cs: Cattail[] = [];
    for (let i = 0; i < 3; i += 1) {
      const x = c.x + u.random(-c.spread / 3, c.spread / 3);
      const y = 815 - c.h * u.random(0.8, 1.1);
      cs.push({ x, y });
    }
    cattails.push(cs);
  }
  return { leaves, cattails };
}

/** Every random value the scene uses, drawn in the order the picture consumed them. */
export function rollScene(u: Util): SceneRandom {
  const stars = rollStars(u);
  const ripples = rollRipples(u);
  const moonDabs = rollMoonDabs(u);
  const houseRipples = rollHouseRipples(u);
  const { leaves, cattails } = rollReeds(u);
  return { stars, ripples, moonDabs, houseRipples, leaves, cattails };
}

export function drawSky(v: View, r: SceneRandom): void {
  v.background(
    v.linearGradient(0, 0, 0, HORIZON, [
      [0, C.skyTop],
      [0.42, C.skyMid],
      [0.75, C.skyRose],
      [0.93, C.skyGlow],
      [1, C.skyLow],
    ]),
  );
  // Moon and its halo.
  v.circle(190, 130, 220, {
    fill: v.radialGradient(190, 130, 110, [
      [0, "rgba(251,241,208,0.35)"],
      [1, "rgba(251,241,208,0)"],
    ]),
  });
  v.circle(190, 130, 58, { fill: C.moon });
  // Stars.
  for (const star of r.stars)
    v.circle(star.x, star.y, star.d, { fill: "rgba(255,244,214,0.85)" });
  // A broad rose wash low in the sky.
  v.curve(
    [
      [-40, 360],
      [400, 345],
      [840, 365],
    ],
    false,
    {
      stroke: "#d77d95",
      weight: 70,
      brush: { preset: "wash", opacity: 0.4 },
      gesture: { pressure: "swell", wobble: 8 },
    },
  );
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
    v.curve(
      [
        [c.x, c.y + 3],
        [c.x + c.len * 0.45, c.y - c.w * 0.3],
        [c.x + c.len, c.y + 2],
      ],
      false,
      {
        stroke: lowGlow ? "#9b6a9e" : "#6a5596",
        weight: c.w,
        brush: {
          preset: "bristle",
          bristles: 14,
          load: 0.95,
          flow: 0.55,
          spread: 0.6,
        },
        gesture: {
          pressure: [
            [0, 0.2],
            [0.35, 1],
            [0.8, 0.8],
            [1, 0.1],
          ],
          wobble: 3,
        },
      },
    );
    v.curve(
      [
        [c.x + c.len * 0.15, c.y + c.w * 0.45],
        [c.x + c.len * 0.5, c.y + c.w * 0.3],
        [c.x + c.len * 0.9, c.y + c.w * 0.5],
      ],
      false,
      {
        stroke: lowGlow ? "#f7b58a" : "#de8aa0",
        weight: c.w * 0.45,
        brush: {
          preset: "bristle",
          bristles: 10,
          load: 0.9,
          flow: 0.6,
          spread: 0.5,
        },
        gesture: { pressure: "taper", wobble: 2 },
      },
    );
  }
  // Far hills behind the village.
  v.curve(
    [
      [-20, HORIZON],
      [-20, 420],
      [80, 405],
      [190, 425],
      [300, 440],
      [420, 462],
      [480, HORIZON],
    ],
    true,
    { fill: C.hillFar },
  );
  v.curve(
    [
      [-20, HORIZON],
      [-20, 438],
      [100, 432],
      [220, 446],
      [360, HORIZON],
    ],
    true,
    { fill: C.hill },
  );
}

export function drawWater(v: View, r: SceneRandom): void {
  v.rect(0, HORIZON, 800, 330, {
    fill: v.linearGradient(0, HORIZON, 0, 800, [
      [0, C.waterTop],
      [0.18, "#b8708e"],
      [0.45, C.waterMid],
      [1, C.waterLow],
    ]),
  });
  // Ripples: bristle strokes in several values, the sky's colours mirrored.
  for (const rp of r.ripples) {
    v.line(rp.x, rp.y, rp.x + rp.len, rp.y + rp.dy, {
      stroke: rp.color,
      weight: 2.5 + rp.t * 8,
      brush: {
        preset: "bristle",
        bristles: 7,
        load: 0.85,
        spread: 0.5,
        flow: 0.65,
      },
      gesture: { pressure: "taper", wobble: 1 + rp.t },
    });
  }
  // The moon's reflection: a broken, drifting column of pale dabs.
  for (const d of r.moonDabs) {
    v.line(d.cx - d.half, d.y, d.cx + d.half, d.y + d.dy, {
      stroke: `rgba(251,236,196,${(0.85 - d.t * 0.5).toFixed(2)})`,
      weight: 1.5 + d.t * 2.5,
      brush: "ink",
      gesture: { pressure: "taper", wobble: 0.6 },
    });
  }
}

function drawHouse(v: View, h: House): void {
  // Stilts.
  const stilt: Style = {
    stroke: C.roof,
    weight: 4,
    brush: "ink",
    gesture: { pressure: "even", wobble: 0.6 },
  };
  for (let i = 0; i <= 3; i += 1) {
    const x = h.x + 6 + (i * (h.w - 12)) / 3;
    v.line(x, h.base, x, h.base + 26, stilt);
  }
  v.polygon(houseShape(h), { fill: C.house });
  const top = h.base - h.h;
  v.polygon(
    [
      [h.x - 8, top + 4],
      [h.x + h.w / 2, top - h.roof - 4],
      [h.x + h.w + 8, top + 4],
      [h.x + h.w + 8, top + 10],
      [h.x + h.w / 2, top - h.roof + 6],
      [h.x - 8, top + 10],
    ],
    { fill: C.roof },
  );
  // Board texture on the walls, and the sky's light along the roof's upper edge.
  v.clip(houseShape(h), () => {
    const board: Style = {
      weight: 6,
      brush: {
        preset: "bristle",
        bristles: 8,
        load: 0.95,
        flow: 0.5,
        spread: 0.5,
      },
      gesture: { pressure: "even", wobble: 0.6 },
    };
    for (let x = h.x + 5; x < h.x + h.w; x += 9) {
      v.line(x, top - h.roof, x + 1, h.base, {
        ...board,
        stroke: x % 2 === 0 ? "#4a3a5c" : "#2f2541",
      });
    }
  });
  const edge: Style = {
    weight: 3,
    brush: { preset: "ink", opacity: 0.95 },
    gesture: { pressure: "taper", wobble: 0.4 },
  };
  v.line(h.x - 6, top + 3, h.x + h.w / 2, top - h.roof - 3, {
    ...edge,
    stroke: "#e79aa6",
  });
  v.line(h.x + h.w / 2, top - h.roof - 3, h.x + h.w + 6, top + 3, {
    ...edge,
    stroke: "#f2a77e",
  });
  // Windows with glow.
  const wy = top + h.h * 0.3;
  for (const fx of [0.28, 0.66]) {
    const wx = h.x + h.w * fx;
    v.circle(wx, wy + 8, 60, {
      fill: v.radialGradient(wx, wy + 8, 30, [
        [0, "rgba(255,200,110,0.45)"],
        [1, "rgba(255,200,110,0)"],
      ]),
    });
    v.rect(wx - 7, wy, 14, 17, { fill: C.window });
  }
}

export function drawVillage(v: View, r: SceneRandom): void {
  // Reflections first, painted as broken horizontal strokes, then the houses.
  for (const [hi, h] of HOUSES.entries()) {
    const water = h.base + 26;
    const tall = (h.h + h.roof) * 0.95;
    const rolls = r.houseRipples[hi] ?? [];
    let n = 0;
    for (let d = 2; d < tall; d += 4.5) {
      const t = d / tall;
      const half = d < h.h ? h.w / 2 : (h.w / 2) * (1 - (d - h.h) / h.roof);
      const roll = rolls[n];
      n += 1;
      if (roll === undefined) continue;
      v.line(
        roll.cx - half - roll.left,
        water + d,
        roll.cx + half + roll.right,
        water + d,
        {
          stroke: `rgba(44,34,70,${(0.7 - t * 0.45).toFixed(2)})`,
          weight: 4.5,
          brush: { preset: "bristle", bristles: 8, load: 0.9, flow: 0.75 },
          gesture: { pressure: "taper", wobble: 1 },
        },
      );
    }
    // Window light, stretched by the ripples.
    const glint: Style = {
      stroke: "#ffc979",
      weight: 10,
      brush: { preset: "wash", opacity: 0.55 },
      gesture: { pressure: "taper-out", wobble: 3 },
    };
    const wy = water + (h.base - h.h * 0.7 - water) * -1;
    for (const fx of [0.28, 0.66]) {
      const wx = h.x + h.w * fx;
      v.line(wx, wy - 6, wx + 1, wy + 34, glint);
    }
  }
  for (const h of HOUSES) drawHouse(v, h);
  drawBoat(v);
}

/** The last boat still out, far off on the right, with its own small light. */
function drawBoat(v: View): void {
  const bx = 778;
  const by = HORIZON + 4;
  v.circle(bx + 4, by - 12, 44, {
    fill: v.radialGradient(bx + 4, by - 12, 22, [
      [0, "rgba(255,214,130,0.7)"],
      [1, "rgba(255,190,110,0)"],
    ]),
  });
  v.polygon(
    [
      [bx - 16, by - 4],
      [bx + 18, by - 4],
      [bx + 12, by + 2],
      [bx - 12, by + 2],
    ],
    { fill: "#3a2c4d" },
  );
  v.line(bx - 2, by - 4, bx - 2, by - 26, { stroke: "#3a2c4d", weight: 1.4 });
  v.circle(bx + 5, by - 12, 3.4, { fill: "#fff0b8" });
}

/** Dark reeds in the near corners, for depth: filled tapering leaves. */
export function drawReeds(v: View, r: SceneRandom): void {
  for (const [ci, c] of REED_CLUMPS.entries()) {
    for (const [i, lf] of (r.leaves[ci] ?? []).entries()) {
      const pts: Vec2[] = [
        [lf.x, 815],
        [lf.x + lf.lean * 0.15, 815 - lf.h * 0.45],
        [lf.x + lf.lean * 0.5, 815 - lf.h * 0.8],
        [lf.x + lf.lean, 815 - lf.h],
      ];
      const leaf = v.tube(pts, {
        width: lf.width,
        profile: [
          [0, 1],
          [0.6, 0.7],
          [1, 0],
        ],
      });
      v.path(leaf, { fill: i % 3 === 0 ? "#2c2543" : "#1a172d" });
      v.clip(leaf, () => {
        v.curve(
          pts.map(([px, py]): Vec2 => [px - 5 * c.dir, py]),
          false,
          {
            stroke: "#6a4f78",
            weight: 5,
            brush: { preset: "wash", opacity: 0.6 },
            gesture: { pressure: "taper-in" },
          },
        );
      });
    }
    // A few cattail heads on stems.
    for (const ct of r.cattails[ci] ?? []) {
      const { x, y } = ct;
      v.line(x, 815, x + 4 * c.dir, y, {
        stroke: "#1a172d",
        weight: 3,
        brush: "ink",
        gesture: { pressure: "even", wobble: 1 },
      });
      const head = v.tube(
        [
          [x + 4 * c.dir, y + 6],
          [x + 5 * c.dir, y + 36],
        ],
        { width: 11 },
      );
      v.path(head, { fill: "#4a2f2c" });
      v.clip(head, () => {
        v.line(
          x + 4 * c.dir + 4 * c.dir,
          y + 8,
          x + 5 * c.dir + 4 * c.dir,
          y + 34,
          {
            stroke: "#c47a5e",
            weight: 5,
            brush: { preset: "wash", opacity: 0.8 },
            gesture: { pressure: "swell" },
          },
        );
      });
    }
  }
}
