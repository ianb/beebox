import type { DeepReadonly, Drawing, Gesture, Style, Util, Vec2, View } from "@ianbicking/canvas-loop";
import { AX, ellipsePts, H, INK, W, WARM } from "./common-tea.js";

// The setting: dusk sky, hills, the landed saucer, the meadow.

// ── the saucer ──────────────────────────────────────────────────────
const SHIP = { x: 620, y: 432 };
const SAUCER = ellipsePts(SHIP.x, SHIP.y, 150, 34, 16);
const DOME = ellipsePts(SHIP.x, SHIP.y - 30, 72, 54, 14);

// ── random values, drawn once in init ───────────────────────────────
export interface Blade {
  readonly lift: number;
  readonly lean: number;
}
export interface Clump {
  readonly x: number;
  readonly y: number;
  readonly blades: readonly Blade[];
}
export interface Scene {
  readonly stars: readonly { x: number; y: number; r: number; a: number }[];
  readonly trees: readonly { dx: number; h: number; dark: boolean }[];
  readonly chalkA: readonly { dy: number; x: number; len: number }[];
  readonly chalkB: readonly { x: number }[];
  readonly clumps: readonly Clump[];
  readonly flowers: readonly { x: number; y: number; pink: boolean }[];
  readonly cornersLeft: readonly (readonly Blade[])[];
  readonly cornersRight: readonly (readonly Blade[])[];
}

function blades(u: Util): Blade[] {
  const n = 5 + Math.floor(u.random(5));
  const out: Blade[] = [];
  for (let i = 0; i < n; i += 1) {
    const lift = u.random(0.45);
    const lean = u.random(-3, 3);
    out.push({ lift, lean });
  }
  return out;
}

/** Draws every random value in the order the picture consumes them. */
export function makeScene(u: Util): Scene {
  const stars: { x: number; y: number; r: number; a: number }[] = [];
  for (let i = 0; i < 70; i += 1) {
    const x = u.random(0, W);
    const y = u.random(0, 300);
    const r = u.random(0.6, 2.2);
    const a = u.random(0.6);
    stars.push({ x, y, r, a });
  }
  const trees: { dx: number; h: number; dark: boolean }[] = [];
  for (let i = 0; i < 26; i += 1) {
    const dx = u.random(-10, 10);
    const h = u.random(14, 34);
    const dark = u.random() < 0.5;
    trees.push({ dx, h, dark });
  }
  const chalkA: { dy: number; x: number; len: number }[] = [];
  for (let i = 0; i < 18; i += 1) {
    const dy = u.random(-3, 3);
    const x = u.random(-80, 700);
    const len = u.random(120, 260);
    chalkA.push({ dy, x, len });
  }
  const chalkB: { x: number }[] = [];
  for (let i = 0; i < 8; i += 1) chalkB.push({ x: u.random(-80, 700) });
  const clumps: Clump[] = [];
  for (let i = 0; i < 70; i += 1) {
    const x = u.random(-10, W + 10);
    const y = u.random(496, H + 6);
    if (Math.abs(x - AX) < 64 && y < 518) continue;
    clumps.push({ x, y, blades: blades(u) });
  }
  const flowers: { x: number; y: number; pink: boolean }[] = [];
  for (let i = 0; i < 26; i += 1) {
    const x = u.random(0, W);
    const y = u.random(500, H - 6);
    if (Math.abs(x - AX) < 90 && y < 540) continue;
    flowers.push({ x, y, pink: u.random() < 0.6 });
  }
  const cornersLeft: Blade[][] = [];
  const cornersRight: Blade[][] = [];
  for (let i = 0; i < 6; i += 1) {
    cornersLeft.push(blades(u));
    cornersRight.push(blades(u));
  }
  return {
    stars,
    trees,
    chalkA,
    chalkB,
    clumps,
    flowers,
    cornersLeft,
    cornersRight,
  };
}

export function sky(v: View, scene: DeepReadonly<Scene>): Drawing {
  const out: Drawing[] = [];
  out.push(v.background(
    v.linearGradient(0, 0, 0, 440, [
      [0, "#1a1f4a"],
      [0.45, "#4b3f86"],
      [0.8, "#c3708a"],
      [1, "#f2b07a"],
    ]),
  ));
  // moon glow and moon
  out.push(v.circle(140, 110, 140, {
    fill: v.radialGradient(140, 110, 140, [
      [0, "rgba(255,240,200,0.45)"],
      [1, "rgba(255,240,200,0)"],
    ]),
  }));
  out.push(v.circle(140, 110, 35, { fill: "#fbf1d2" }));
  out.push(v.clip(ellipsePts(140, 110, 35, 35, 16), ((): Drawing => {
    const crater: Style = {
      stroke: "#d8c9a2",
      weight: 16,
      brush: { preset: "wash", opacity: 0.25 },
      gesture: { pressure: "even" },
    };
    return [
      v.circle(150, 118, 7, crater),
      v.circle(128, 98, 4, crater),
    ];
  })()));
  // stars
  for (const star of scene.stars) {
    out.push(v.circle(star.x, star.y, star.r, {
      fill: `rgba(255,248,225,${(0.4 + star.a).toFixed(2)})`,
    }));
  }
  // a shooting star across the empty upper right
  const taperIn: Gesture = { pressure: "taper-in" };
  out.push(v.curve(
    [
      [760, 40],
      [690, 70],
      [610, 112],
    ],
    false,
    {
      stroke: "#ffe9c4",
      weight: 12,
      brush: { preset: "airbrush", opacity: 0.5 },
      gesture: taperIn,
    },
  ));
  out.push(v.curve(
    [
      [740, 50],
      [680, 76],
      [610, 112],
    ],
    false,
    {
      stroke: "#fff9ea",
      weight: 3,
      brush: { preset: "ink", opacity: 0.9 },
      gesture: taperIn,
    },
  ));
  out.push(v.circle(608, 113, 16, {
    fill: v.radialGradient(608, 113, 16, [
      [0, "rgba(255,250,230,0.9)"],
      [1, "rgba(255,250,230,0)"],
    ]),
  }));
  // soft clouds near the horizon
  const cloud: Style = {
    brush: { preset: "airbrush", opacity: 0.35 },
    gesture: { pressure: "taper" },
  };
  out.push(v.curve(
    [
      [380, 300],
      [480, 290],
      [600, 300],
      [720, 290],
    ],
    false,
    { ...cloud, stroke: "#f6c3a6", weight: 40 },
  ));
  out.push(v.curve(
    [
      [40, 340],
      [160, 330],
      [280, 342],
    ],
    false,
    { ...cloud, stroke: "#e19aa8", weight: 30 },
  ));
  return out;
}

export function land(v: View, scene: DeepReadonly<Scene>): Drawing {
  const out: Drawing[] = [];
  // far hills
  const farTop: Vec2[] = [
    [-20, 384],
    [110, 356],
    [250, 382],
    [420, 362],
    [580, 384],
    [720, 352],
    [820, 366],
  ];
  const far = [
    ...v.curvePath(farTop),
    ["line", W, H] as const,
    ["line", 0, H] as const,
    ["close"] as const,
  ];
  out.push(v.path(far, {
    fill: v.linearGradient(0, 350, 0, 460, [
      [0, "#7a68a8"],
      [1, "#53517f"],
    ]),
  }));
  out.push(v.clip(far, ((): Drawing => {
    const haze: Style = {
      stroke: "#c58aa6",
      weight: 26,
      brush: { preset: "wash", opacity: 0.45 },
      gesture: { pressure: "taper" },
    };
    return [
      v.curve(
        [
          [80, 370],
          [130, 362],
          [240, 380],
        ],
        false,
        haze,
      ),
      v.curve(
        [
          [620, 372],
          [720, 358],
          [800, 366],
        ],
        false,
        haze,
      ),
    ];
  })()));
  // a far farmhouse on the left hill, its window lit: someone is watching
  const house = { x: 120, y: 360 };
  out.push(v.polygon(
    [
      [house.x - 16, house.y + 4],
      [house.x - 16, house.y - 12],
      [house.x, house.y - 24],
      [house.x + 16, house.y - 12],
      [house.x + 16, house.y + 4],
    ],
    { fill: "#3b3763" },
  ));
  out.push(v.rect(house.x + 6, house.y - 26, 5, 10, { fill: "#3b3763" }));
  out.push(v.circle(house.x - 5, house.y - 6, 12, {
    fill: v.radialGradient(house.x - 5, house.y - 6, 12, [
      [0, "rgba(255,214,120,0.7)"],
      [1, "rgba(255,214,120,0)"],
    ]),
  }));
  out.push(v.rect(house.x - 8, house.y - 9, 6, 6, { fill: "#ffd27a" }));
  // a line of trees along the middle distance
  const midTop: Vec2[] = [
    [-20, 420],
    [160, 404],
    [360, 426],
    [560, 410],
    [820, 418],
  ];
  const mid = [
    ...v.curvePath(midTop),
    ["line", W, H] as const,
    ["line", 0, H] as const,
    ["close"] as const,
  ];
  out.push(v.path(mid, { fill: "#3e4f6e" }));
  for (const [i, t] of scene.trees.entries()) {
    const x = i * 32 + t.dx;
    const yb = 418 + Math.sin(i * 0.7) * 6;
    const h = t.h;
    const tree: Vec2[] = [
      [x - h * 0.35, yb],
      [x - h * 0.3, yb - h * 0.5],
      [x, yb - h],
      [x + h * 0.32, yb - h * 0.45],
      [x + h * 0.35, yb],
    ];
    out.push(v.curve(tree, true, { fill: t.dark ? "#3a4a69" : "#34425f" }));
    // sky light catching the top of each tree
    out.push(v.clip(v.curvePath(tree, true), [
      v.at({ translate: [2, 3] }, [
        v.curve(tree, true, {
          stroke: "#8a7aa8",
          weight: 4,
          brush: { preset: "airbrush", opacity: 0.6 },
          gesture: { pressure: "even" },
        }),
      ]),
    ]));
  }
  // meadow
  const meadowTop: Vec2[] = [
    [0, 446],
    [200, 470],
    [400, 486],
    [600, 474],
    [800, 452],
  ];
  const meadow = [
    ...v.curvePath(meadowTop),
    ["line", W, H] as const,
    ["line", 0, H] as const,
    ["close"] as const,
  ];
  out.push(v.path(meadow, {
    fill: v.linearGradient(0, 446, 0, H, [
      [0, "#4f7f5c"],
      [1, "#24443f"],
    ]),
  }));
  out.push(v.clip(meadow, ((): Drawing => {
    const drawn: Drawing[] = [];
    // soft lighter patches of meadow catching the last sky light
    const patch: Style = {
      stroke: "#7fae6a",
      weight: 60,
      brush: { preset: "wash", opacity: 0.5 },
      gesture: { pressure: "taper" },
    };
    drawn.push(v.curve(
      [
        [-40, 480],
        [160, 490],
        [330, 506],
      ],
      false,
      patch,
    ));
    drawn.push(v.curve(
      [
        [470, 500],
        [640, 486],
        [840, 470],
      ],
      false,
      patch,
    ));
    // warm pool of hatch light on the grass
    drawn.push(v.curve(
      [
        [380, 520],
        [480, 516],
        [600, 520],
      ],
      false,
      {
        ...patch,
        brush: { preset: "airbrush", opacity: 0.55 },
        stroke: "#f2d27a",
        weight: 70,
      },
    ));
    // chalky texture, following the slope of the ground
    const chalk: Style = {
      stroke: "#93c07a",
      weight: 14,
      brush: { preset: "chalk", opacity: 0.5 },
      gesture: { pressure: "taper", wobble: 2 },
    };
    for (const [i, c] of scene.chalkA.entries()) {
      const y = 486 + i * 6 + c.dy;
      drawn.push(v.curve(
        [
          [c.x, y + (c.x / W) * -10],
          [c.x + c.len / 2, y + 2],
          [c.x + c.len, y - 2],
        ],
        false,
        chalk,
      ));
    }
    const chalkDark: Style = {
      ...chalk,
      stroke: "#173229",
      brush: { preset: "chalk", opacity: 0.45 },
      weight: 18,
    };
    for (const [i, c] of scene.chalkB.entries()) {
      const y = 556 + i * 7;
      drawn.push(v.curve(
        [
          [c.x, y],
          [c.x + 160, y - 3],
          [c.x + 300, y + 2],
        ],
        false,
        chalkDark,
      ));
    }
    return drawn;
  })()));
  return out;
}

export function ship(v: View): Drawing {
  const out: Drawing[] = [];
  // glow on the ground under the ship
  out.push(v.ellipse(SHIP.x - 60, 490, 220, 70, {
    fill: v.radialGradient(SHIP.x - 60, 490, 220, [
      [0, "rgba(255,214,130,0.55)"],
      [1, "rgba(255,214,130,0)"],
    ]),
  }));
  // legs
  const leg: Style = {
    stroke: INK,
    weight: 4,
    brush: "ink",
    gesture: { pressure: "even" },
  };
  out.push(v.line(SHIP.x - 90, 452, SHIP.x - 110, 490, leg));
  out.push(v.line(SHIP.x + 90, 452, SHIP.x + 110, 490, leg));
  // dome
  out.push(v.curve(DOME, true, {
    fill: v.linearGradient(SHIP.x - 60, SHIP.y - 80, SHIP.x + 40, SHIP.y - 10, [
      [0, "#e8f6ff"],
      [1, "#7aa4c8"],
    ]),
  }));
  out.push(v.clip(v.curvePath(DOME, true), [
    v.curve(
      [
        [SHIP.x - 52, SHIP.y - 40],
        [SHIP.x - 36, SHIP.y - 66],
        [SHIP.x - 6, SHIP.y - 78],
      ],
      false,
      {
        stroke: "#ffffff",
        weight: 14,
        brush: { preset: "airbrush", opacity: 0.7 },
        gesture: { pressure: "taper" },
      },
    ),
    v.curve(
      [
        [SHIP.x - 70, SHIP.y - 22],
        [SHIP.x, SHIP.y - 30],
        [SHIP.x + 70, SHIP.y - 22],
      ],
      false,
      {
        stroke: "#e7a3b8",
        weight: 18,
        brush: { preset: "wash", opacity: 0.55 },
        gesture: { pressure: "taper" },
      },
    ),
  ]));
  const outline: Style = {
    stroke: INK,
    weight: 3,
    brush: "ink",
    gesture: { pressure: "even", wobble: 0.6 },
  };
  out.push(v.curve(DOME, true, outline));
  // saucer
  out.push(v.curve(SAUCER, true, {
    fill: v.linearGradient(0, SHIP.y - 34, 0, SHIP.y + 34, [
      [0, "#d9dde6"],
      [0.5, "#9aa3b8"],
      [1, "#5d6582"],
    ]),
  }));
  out.push(v.clip(v.curvePath(SAUCER, true), [
    // dusk sky reflected on the top, shadowed underside, a band seam
    v.curve(
      [
        [SHIP.x - 150, SHIP.y - 4],
        [SHIP.x - 40, SHIP.y - 22],
        [SHIP.x + 120, SHIP.y - 18],
      ],
      false,
      {
        stroke: "#e6a6b8",
        weight: 22,
        brush: { preset: "wash", opacity: 0.5 },
        gesture: { pressure: "taper" },
      },
    ),
    v.curve(
      [
        [SHIP.x - 150, SHIP.y + 26],
        [SHIP.x, SHIP.y + 40],
        [SHIP.x + 150, SHIP.y + 22],
      ],
      false,
      {
        stroke: "#5e5a92",
        weight: 30,
        brush: { preset: "wash", opacity: 0.7, blend: "multiply" },
        gesture: { pressure: "taper" },
      },
    ),
    v.curve(
      [
        [SHIP.x - 110, SHIP.y - 10],
        [SHIP.x - 40, SHIP.y - 20],
        [SHIP.x + 30, SHIP.y - 22],
      ],
      false,
      {
        stroke: "#ffffff",
        weight: 10,
        brush: { preset: "bristle", load: 0.9, opacity: 0.6 },
        gesture: { pressure: "taper", wobble: 1 },
      },
    ),
    v.curve(
      [
        [SHIP.x - 148, SHIP.y + 2],
        [SHIP.x, SHIP.y + 14],
        [SHIP.x + 148, SHIP.y + 2],
      ],
      false,
      {
        stroke: "#4b5170",
        weight: 2,
        brush: "ink",
        gesture: { pressure: "taper" },
      },
    ),
  ]));
  // lights along the rim, each with a glow
  for (let i = 0; i < 7; i += 1) {
    const t = (i - 3) / 3.4;
    const x = SHIP.x + t * 140;
    const y = SHIP.y + 12 - t * t * 8;
    out.push(v.circle(x, y, 14, {
      fill: v.radialGradient(x, y, 14, [
        [0, "rgba(255,220,120,0.8)"],
        [1, "rgba(255,220,120,0)"],
      ]),
    }));
    out.push(v.circle(x, y, 4, { fill: WARM }));
    out.push(v.circle(x - 1, y - 1, 1.5, { fill: "#fffbe6" }));
  }
  // outlines
  out.push(v.curve(SAUCER, true, outline));
  return out;
}

export function hatch(v: View): Drawing {
  const drawn: Drawing[] = [];
  const top: Vec2 = [SHIP.x - 58, SHIP.y + 26];
  // beam of light falling from the open hatch
  drawn.push(v.path(
    [
      ["move", top[0] - 34, top[1]],
      ["line", top[0] + 34, top[1]],
      ["line", top[0] + 70, 520],
      ["line", top[0] - 110, 520],
      ["close"],
    ],
    {
      fill: v.linearGradient(0, SHIP.y + 26, 0, 520, [
        [0, "rgba(255,236,170,0.85)"],
        [1, "rgba(255,236,170,0.05)"],
      ]),
    },
  ));
  // glowing doorway on the underside
  drawn.push(v.ellipse(top[0], top[1], 35, 6, { fill: "#fff4c8" }));
  // ramp
  const rampFill = v.linearGradient(top[0], top[1], top[0] - 90, 508, [
    [0, "#d8d0cc"],
    [1, "#948ca6"],
  ]);
  const ramp: Vec2[] = [
    [top[0] - 26, top[1] + 2],
    [top[0] + 10, top[1] + 4],
    [top[0] - 70, 512],
    [top[0] - 128, 506],
  ];
  const side: Vec2[] = [
    [top[0] - 128, 506],
    [top[0] - 70, 512],
    [top[0] - 70, 519],
    [top[0] - 128, 512],
  ];
  drawn.push(v.polygon(side, { fill: "#4d4868" }));
  drawn.push(v.polygon(ramp, { fill: rampFill }));
  drawn.push(v.clip(ramp, ((): Drawing => {
    const parts: Drawing[] = [];
    parts.push(v.line(top[0] - 6, top[1] + 4, top[0] - 90, 506, {
      stroke: "#fff0bf",
      weight: 30,
      brush: { preset: "airbrush", opacity: 0.8 },
      gesture: { pressure: "taper-out" },
    }));
    const seam: Style = {
      stroke: "#7d7690",
      weight: 1.5,
      brush: "ink",
      gesture: { pressure: "even" },
    };
    for (let i = 1; i < 6; i += 1) {
      const t = i / 6;
      parts.push(v.line(
        top[0] - 26 - t * 102,
        top[1] + 2 + t * 178,
        top[0] + 10 - t * 80,
        top[1] + 4 + t * 182,
        seam,
      ));
    }
    return parts;
  })()));
  const edge: Style = {
    stroke: INK,
    weight: 2.6,
    brush: "ink",
    gesture: { pressure: "even", wobble: 0.4 },
  };
  drawn.push(v.polygon(ramp, edge));
  drawn.push(v.polygon(side, edge));
  return drawn;
}

function clump(
  v: View,
  c: {
    x: number;
    y: number;
    h: number;
    dark: string;
    light: string;
    blades: readonly Blade[];
  },
): Drawing {
  const drawn: Drawing[] = [];
  const { x, y, h, blades: bl } = c;
  const n = bl.length;
  for (const [i, b] of bl.entries()) {
    const t = (i / (n - 1)) * 2 - 1; // -1..1 across the clump
    const bh = h * (0.55 + b.lift) * (1 - Math.abs(t) * 0.35);
    const lean = t * h * 0.45 + b.lean;
    const bx = x + t * h * 0.12;
    drawn.push(v.curve(
      [
        [bx, y],
        [bx + lean * 0.3, y - bh * 0.6],
        [bx + lean, y - bh],
      ],
      false,
      {
        stroke: i % 2 === 0 ? c.dark : c.light,
        weight: Math.max(1.2, h * 0.09),
        brush: { preset: "ink", thinning: 0.8 },
        gesture: { pressure: "taper-out", wobble: 0.4 },
      },
    ));
  }
  return drawn;
}

function meadowFlower(
  v: View,
  x: number,
  y: number,
  r: number,
  color: string,
): Drawing {
  const out: Drawing[] = [];
  for (let i = 0; i < 5; i += 1) {
    const a = (i / 5) * Math.PI * 2;
    out.push(v.circle(x + Math.cos(a) * r, y + Math.sin(a) * r * 0.7, (r * 1.3) / 2, {
      fill: color,
    }));
  }
  out.push(v.circle(x, y, (r * 0.9) / 2, { fill: "#f2c94c" }));
  return out;
}

export function grass(v: View, scene: DeepReadonly<Scene>): Drawing {
  const out: Drawing[] = [];
  // clumps, bigger toward the bottom of the page
  for (const c of scene.clumps) {
    const depth = (c.y - 480) / 120; // 0 far .. 1 near
    const lit = Math.hypot(c.x - 520, (c.y - 520) * 2) < 130;
    out.push(clump(v, {
      x: c.x,
      y: c.y,
      h: 8 + depth * 16,
      dark: lit ? "#5f7a3c" : "#183329",
      light: lit ? "#e7d98a" : "#6f9c5c",
      blades: c.blades,
    }));
  }
  // meadow flowers like the one in the alien's hand
  for (const f of scene.flowers) {
    const r = 1.6 + ((f.y - 500) / 100) * 2.6;
    out.push(meadowFlower(v, f.x, f.y, r, f.pink ? "#f6b9cf" : "#f4efe2"));
  }
  // tall dark grass framing the bottom corners
  for (let i = 0; i < 6; i += 1) {
    out.push(clump(v, {
      x: 10 + i * 22,
      y: H + 4,
      h: 70 - i * 8,
      dark: "#0f241e",
      light: "#22412f",
      blades: scene.cornersLeft[i] ?? [],
    }));
    out.push(clump(v, {
      x: W - 10 - i * 24,
      y: H + 4,
      h: 64 - i * 8,
      dark: "#0f241e",
      light: "#22412f",
      blades: scene.cornersRight[i] ?? [],
    }));
  }
  return out;
}

export function fireflies(v: View): Drawing {
  const out: Drawing[] = [];
  const spots: Vec2[] = [
    [70, 420],
    [150, 470],
    [110, 540],
    [200, 380],
    [520, 360],
    [560, 300],
    [700, 340],
    [750, 400],
    [680, 520],
    [470, 450],
    [40, 330],
  ];
  for (const [x, y] of spots) {
    out.push(v.circle(x, y, 14, {
      fill: v.radialGradient(x, y, 14, [
        [0, "rgba(255,240,150,0.85)"],
        [1, "rgba(255,240,150,0)"],
      ]),
    }));
    out.push(v.circle(x, y, 1.5, { fill: "#fff8d0" }));
  }
  return out;
}

/** The hatch light, spilling softly over the ramp and the alien's right
 * side, screened over everything so it only ever brightens. */
export function hatchBloom(v: View): Drawing {
  return v.group({ opacity: 0.5, blend: "screen" }, [
    v.circle(500, 470, 190, {
      fill: v.radialGradient(500, 470, 190, [
        [0, "rgba(255,200,110,0.55)"],
        [0.5, "rgba(255,190,110,0.2)"],
        [1, "rgba(255,190,110,0)"],
      ]),
    }),
  ]);
}

/** A faint warm wash over the whole page, so the paper's tooth shows
 * everywhere and the colours sit on one sheet. */
export function paperTone(v: View): Drawing {
  return v.group({ opacity: 0.13, blend: "multiply" }, ((): Drawing => {
    const drawn: Drawing[] = [];
    const band: Style = {
      stroke: "#d8c4a4",
      weight: 80,
      brush: { preset: "wash", opacity: 1, grain: 1 },
      gesture: { pressure: "even" },
    };
    for (let y = -20; y < H + 40; y += 60) drawn.push(v.line(-40, y, W + 40, y, band));
    return drawn;
  })());
}
