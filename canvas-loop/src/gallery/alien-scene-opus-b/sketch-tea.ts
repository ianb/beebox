// "Hello, Earth!" — a friendly green alien has just stepped down the ramp of
// its landed saucer onto a dusk meadow, and waves to us. Picture-book
// illustration painted with canvas-loop brushes.
import type {
  DeepReadonly,
  Style,
  Util,
  Vec2,
  View,
} from "@ianbicking/canvas-loop";

const W = 800;
const H = 600;

const LINE = "#2a2433";
const GREEN = "#6fbf62";
const GREEN_LIGHT = "#b8ea8f";
const WARM = "#ffd98a";
const SHADE = "#5f6aa0";

// ── helpers ────────────────────────────────────────────────────────────
function oval(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  n: number,
  rot = 0,
): Vec2[] {
  const pts: Vec2[] = [];
  for (let i = 0; i < n; i += 1) {
    const a = (i / n) * Math.PI * 2 + rot;
    pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return pts;
}

/** Closed outline of a tube of `width` around a centerline. */
function tube(
  center: readonly Vec2[],
  width: number,
  endWidth = width,
): Vec2[] {
  const left: Vec2[] = [];
  const right: Vec2[] = [];
  const n = center.length;
  const at = (i: number): Vec2 => {
    const p = center[i];
    if (!p) throw new Error(`tube: no point ${i}`);
    return p;
  };
  for (let i = 0; i < n; i += 1) {
    const a = at(Math.max(0, i - 1));
    const b = at(Math.min(n - 1, i + 1));
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const t = n === 1 ? 0 : i / (n - 1);
    const hw = (width + (endWidth - width) * t) / 2;
    const [x, y] = at(i);
    left.push([x + nx * hw, y + ny * hw]);
    right.push([x - nx * hw, y - ny * hw]);
  }
  return [...left, ...right.reverse()];
}

/** Tapered ink line; weight and wobble vary per use. */
function ink(color: string, weight: number, wobble = 0.6): Style {
  return {
    stroke: color,
    weight,
    brush: { preset: "ink", thinning: 0.55 },
    gesture: { pressure: "taper", wobble },
  };
}

function closedBelow(top: readonly Vec2[]): Vec2[] {
  return [...top, [W + 20, H + 20], [-20, H + 20]];
}

// ── geometry ───────────────────────────────────────────────────────────
const HEAD = oval(330, 278, 100, 76, 14);
const BODY: Vec2[] = [
  [294, 348],
  [274, 392],
  [262, 445],
  [266, 492],
  [296, 508],
  [364, 508],
  [394, 492],
  [398, 445],
  [386, 392],
  [366, 348],
];
const ARM_WAVE: Vec2[] = [
  [372, 392],
  [410, 380],
  [438, 350],
  [452, 314],
];
const ARM_DOWN: Vec2[] = [
  [296, 400],
  [264, 420],
  [244, 450],
  [234, 476],
];
const LEG_L: Vec2[] = [
  [314, 500],
  [312, 524],
  [310, 546],
];
const LEG_R: Vec2[] = [
  [346, 500],
  [348, 524],
  [350, 546],
];
const ANT_L: Vec2[] = [
  [302, 210],
  [292, 180],
  [276, 150],
];
const ANT_R: Vec2[] = [
  [360, 208],
  [372, 176],
  [392, 146],
];

const HILL_FAR: Vec2[] = [
  [-20, 350],
  [120, 322],
  [260, 340],
  [420, 312],
  [560, 330],
  [700, 305],
  [820, 322],
];
const HILL_MID: Vec2[] = [
  [-20, 410],
  [150, 388],
  [330, 402],
  [520, 374],
  [680, 388],
  [820, 380],
];
const GROUND: Vec2[] = [
  [-20, 468],
  [180, 452],
  [380, 462],
  [560, 448],
  [820, 470],
];

const SAUCER = { x: 610, y: 335 };

// ── random values, drawn once in init ──────────────────────────────────
interface Star {
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly a: number;
}
interface Blade {
  readonly x: number;
  readonly y: number;
  readonly h: number;
  readonly lean: number;
  readonly color: string;
}
interface Flower {
  readonly x: number;
  readonly y: number;
  readonly color: string;
}
export interface Model {
  readonly stars: readonly Star[];
  readonly meadowBlades: readonly Blade[];
  readonly flowers: readonly Flower[];
  readonly foreBlades: readonly Blade[];
}

const MEADOW_GREENS = ["#2c4a31", "#3d6a40", "#5e9455", "#86b46a"];
const FORE_GREENS = ["#2c4a31", "#3d6a40", "#5e9455"];

export const canvas = { width: W, height: H };

export function init(u: Util): Model {
  const stars: Star[] = [];
  for (let i = 0; i < 80; i += 1) {
    const x = u.random(W);
    const y = u.random(250) * u.random(0.3, 1);
    const r = u.random(0.8, 2.6);
    const a = u.random(0.65);
    stars.push({ x, y, r, a });
  }
  const meadowBlades: Blade[] = [];
  for (let i = 0; i < 520; i += 1) {
    const x = u.random(-10, W + 10);
    const y = u.random(452, 605);
    const depth = (y - 450) / 150;
    const h = 5 + depth * 20 + u.random(4);
    const lean = u.random(-4, 4) + depth * 2;
    const lit = Math.hypot(x - SAUCER.x, (y - BEAM_FOOT) * 2.5) < 150;
    const color = lit
      ? u.randomChoice(["#b9c86a", "#d8d07a", "#7fae5e"])
      : u.randomChoice(MEADOW_GREENS);
    meadowBlades.push({ x, y, h, lean, color });
  }
  const flowers: Flower[] = [];
  for (let i = 0; i < 24; i += 1) {
    const x = u.random(W);
    const y = u.random(480, 595);
    if (x > 250 && x < 420 && y < 560) continue;
    flowers.push({
      x,
      y,
      color: u.randomChoice(["#f6d6e0", "#fff3c4", "#c9d8ff"]),
    });
  }
  const foreBlades: Blade[] = [];
  for (let i = 0; i < 46; i += 1) {
    const x = u.random(262, 400);
    const y = u.random(553, 566);
    const h = u.random(8, 20);
    const lean = u.random(-5, 5);
    foreBlades.push({ x, y, h, lean, color: u.randomChoice(FORE_GREENS) });
  }
  return { stars, meadowBlades, flowers, foreBlades };
}

export function update(model: DeepReadonly<Model>): Model {
  return model;
}

// ── layers ─────────────────────────────────────────────────────────────
function sky(v: View, model: DeepReadonly<Model>): void {
  v.background(
    v.linearGradient(0, 0, 0, 420, [
      [0, "#1c2150"],
      [0.42, "#4a3a7a"],
      [0.72, "#b06a8e"],
      [1, "#f5b67c"],
    ]),
  );
  // soft cloud bands, wash
  const band: Style = {
    brush: { preset: "wash", opacity: 0.35 },
    gesture: { pressure: "swell", wobble: 6 },
  };
  v.curve(
    [
      [380, 230],
      [520, 214],
      [700, 226],
      [830, 210],
    ],
    false,
    { ...band, stroke: "#e9a0a6", weight: 34 },
  );
  v.curve(
    [
      [-20, 200],
      [120, 186],
      [300, 196],
    ],
    false,
    { ...band, stroke: "#7a5a9a", weight: 26 },
  );
  // two soft cumulus clouds near the horizon, lit pink from below
  for (const [cx, cy, k] of [
    [110, 238, 1],
    [560, 196, 0.8],
  ] as const) {
    const puffs: [number, number, number][] = [
      [-62, 4, 22],
      [-30, -10, 30],
      [8, -18, 34],
      [44, -6, 26],
      [70, 6, 18],
      [0, 8, 30],
    ];
    const cmds = puffs.flatMap(([dx, dy, r]) =>
      v.curvePath(oval(cx + dx * k, cy + dy * k, r * k, r * k * 0.8, 10), true),
    );
    // flat underside: clip away everything below the base line
    v.clip(
      [
        [0, 0],
        [W, 0],
        [W, cy + 16 * k],
        [0, cy + 16 * k],
      ],
      () => {
        v.path(cmds, { fill: "#7d5a98" });
        v.clip(cmds, () => {
          v.line(cx - 100 * k, cy + 12 * k, cx + 100 * k, cy + 12 * k, {
            stroke: "#f4a9a2",
            weight: 20 * k,
            brush: { preset: "wash", opacity: 0.85 },
            gesture: { pressure: "even", wobble: 1 },
          });
          v.line(cx - 30 * k, cy - 30 * k, cx + 30 * k, cy - 34 * k, {
            stroke: "#a07cc0",
            weight: 30 * k,
            brush: { preset: "airbrush", opacity: 0.5 },
            gesture: { pressure: "even", wobble: 1 },
          });
        });
      },
    );
  }
  // moon glow
  v.circle(140, 108, 80, {
    stroke: "#fff1c9",
    weight: 90,
    brush: { preset: "airbrush", opacity: 0.22 },
    gesture: { pressure: "even" },
  });
  v.circle(140, 108, 70, { fill: "#fbf0cf" });
  v.clip(v.curvePath(oval(140, 108, 35, 35, 12), true), () => {
    const crater: Style = {
      stroke: "#d9c79a",
      weight: 16,
      brush: { preset: "wash", opacity: 0.45 },
      gesture: { pressure: "swell", wobble: 4 },
    };
    v.curve(
      [
        [112, 92],
        [128, 100],
        [140, 96],
      ],
      false,
      crater,
    );
    v.curve(
      [
        [146, 124],
        [160, 120],
        [168, 128],
      ],
      false,
      crater,
    );
    v.curve(
      [
        [124, 128],
        [132, 136],
      ],
      false,
      crater,
    );
  });
  // stars
  for (const star of model.stars) {
    v.circle(star.x, star.y, star.r, {
      fill: `rgba(255,248,220,${(0.35 + star.a).toFixed(2)})`,
    });
  }
}

function hills(v: View): void {
  v.curve(closedBelow(HILL_FAR), true, { fill: "#6a5490" });
  v.clip(v.curvePath(closedBelow(HILL_FAR), true), () => {
    v.curve(
      [
        [-20, 345],
        [120, 318],
        [260, 336],
        [420, 308],
        [560, 326],
        [700, 300],
        [820, 318],
      ],
      false,
      {
        stroke: "#8a6aa2",
        weight: 40,
        brush: { preset: "wash", opacity: 0.5 },
        gesture: { pressure: "taper", wobble: 4 },
      },
    );
  });
  v.curve(closedBelow(HILL_MID), true, { fill: "#3d5872" });
  v.clip(v.curvePath(closedBelow(HILL_MID), true), () => {
    const streak: Style = {
      stroke: "#55708a",
      weight: 14,
      brush: { preset: "chalk", opacity: 0.45 },
      gesture: { pressure: "taper", wobble: 3 },
    };
    for (let i = 0; i < 6; i += 1) {
      const y = 400 + i * 10;
      v.curve(
        [
          [-20 + i * 30, y],
          [200, y - 14],
          [420, y - 6],
          [640, y - 20],
          [820, y - 10],
        ],
        false,
        streak,
      );
    }
  });
  // dark rounded trees along the middle hill, left
  for (const [x, h] of [
    [24, 46],
    [58, 34],
    [92, 54],
    [130, 40],
    [168, 30],
  ] as const) {
    const base = 398 - x * 0.05;
    v.curve(oval(x, base - h / 2, h * 0.38, h / 2, 9), true, {
      fill: "#263649",
    });
    v.rect(x - 2, base - 4, 4, 10, { fill: "#1d2a3a" });
    v.curve(
      arcPts(
        x,
        base - h / 2,
        h * 0.3,
        h * 0.4,
        Math.PI * 1.1,
        Math.PI * 1.6,
        4,
      ),
      false,
      {
        stroke: "#3d5470",
        weight: 6,
        brush: { preset: "chalk", opacity: 0.6 },
        gesture: { pressure: "taper", wobble: 1 },
      },
    );
  }
  // a tiny cottage on the far hill, one lit window
  v.polygon(
    [
      [742, 312],
      [770, 312],
      [770, 296],
      [756, 284],
      [742, 296],
    ],
    { fill: "#3a2f55" },
  );
  v.rect(752, 300, 7, 7, { fill: "#ffd36e" });
  v.line(755, 303, 756, 303, {
    stroke: "#ffd36e",
    weight: 22,
    brush: { preset: "airbrush", opacity: 0.4 },
    gesture: { pressure: "even" },
  });
  // ground
  v.curve(closedBelow(GROUND), true, { fill: "#3e6a45" });
}

function arcPts(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  a0: number,
  a1: number,
  n: number,
): Vec2[] {
  const pts: Vec2[] = [];
  for (let i = 0; i <= n; i += 1) {
    const a = a0 + ((a1 - a0) * i) / n;
    pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return pts;
}

const BEAM_FOOT = 456;

function saucer(v: View): void {
  const { x: cx, y: cy } = SAUCER;
  // beam of warm light from the underside down to the grass
  v.group({ opacity: 0.55 }, () => {
    const beam: Style = {
      stroke: "#ffd27a",
      weight: 34,
      brush: { preset: "wash", opacity: 0.45 },
      gesture: {
        pressure: [
          [0, 0.45],
          [1, 1],
        ],
        wobble: 1,
      },
    };
    for (let i = -3; i <= 3; i += 1) {
      v.line(cx + i * 7, cy + 20, cx + i * 26, BEAM_FOOT, beam);
    }
  });
  // bright core of the beam
  v.line(cx, cy + 24, cx, BEAM_FOOT - 8, {
    stroke: "#fff3c4",
    weight: 24,
    brush: { preset: "airbrush", opacity: 0.45 },
    gesture: {
      pressure: [
        [0, 0.5],
        [1, 1],
      ],
    },
  });
  for (const [x, y] of [
    [596, 380],
    [628, 398],
    [612, 424],
    [582, 436],
    [642, 440],
    [606, 404],
  ] as const) {
    v.line(x, y, x + 1, y, {
      stroke: "#fff6d0",
      weight: 14,
      brush: { preset: "airbrush", opacity: 0.7 },
      gesture: { pressure: "even" },
    });
    v.circle(x, y, 3, { fill: "#ffffff" });
  }
  // dome
  v.ellipse(cx, cy - 20, 112, 82, {
    fill: v.radialGradient(cx - 16, cy - 40, 64, [
      [0, "#f4ffff"],
      [0.6, "#a9dde4"],
      [1, "#6fa9bd"],
    ]),
  });
  // disc
  v.ellipse(cx, cy, 224, 54, {
    fill: v.linearGradient(cx, cy - 27, cx, cy + 27, [
      [0, "#dfe2ee"],
      [0.5, "#a3a9c0"],
      [1, "#565b78"],
    ]),
  });
  // underside
  v.ellipse(cx, cy + 18, 120, 20, { fill: "#3f4260" });
  v.ellipse(cx, cy + 20, 60, 10, { fill: "#ffe7a8" });
  // windows
  for (let i = -2; i <= 2; i += 1) {
    v.circle(cx + i * 38, cy + 2 - Math.abs(i) * 2, 12, { fill: "#ffe08a" });
  }
  // rim highlight
  const rim: Style = {
    stroke: "#ffffff",
    weight: 3,
    brush: { preset: "ink", opacity: 0.7 },
    gesture: { pressure: "taper" },
  };
  v.curve(arcPts(cx, cy, 104, 22, Math.PI * 1.1, Math.PI * 1.6, 8), false, rim);
  v.curve(
    arcPts(cx - 10, cy - 30, 34, 26, Math.PI * 1.15, Math.PI * 1.45, 6),
    false,
    rim,
  );
  v.ellipse(cx, cy, 224, 54, ink(LINE, 3));
  v.curve(
    arcPts(cx, cy - 20, 56, 41, Math.PI * 1.04, Math.PI * 1.96, 12),
    false,
    ink(LINE, 3),
  );
}

function meadow(v: View, model: DeepReadonly<Model>): void {
  v.clip(v.curvePath(closedBelow(GROUND), true), () => {
    // value variation: soft wash bands, darker toward the front
    const bands: [number, string, number][] = [
      [470, "#5a8f55", 0.6],
      [500, "#2f5236", 0.5],
      [540, "#4a7d48", 0.5],
      [585, "#24402c", 0.6],
    ];
    for (const [y, c, o] of bands) {
      v.curve(
        [
          [-60, y],
          [220, y - 10],
          [480, y + 6],
          [860, y - 6],
        ],
        false,
        {
          stroke: c,
          weight: 46,
          brush: { preset: "wash", opacity: o },
          gesture: { pressure: "even", wobble: 6 },
        },
      );
    }
    // pool of light where the beam lands
    v.group({ blend: "screen", opacity: 0.9 }, () => {
      for (const [w, dy, half] of [
        [60, 0, 200],
        [40, 14, 150],
        [30, -4, 100],
      ] as const) {
        v.line(
          SAUCER.x - half,
          BEAM_FOOT + dy,
          SAUCER.x + half,
          BEAM_FOOT + dy,
          {
            stroke: "#d9b860",
            weight: w,
            brush: { preset: "wash", opacity: 0.55 },
            gesture: { pressure: "swell", wobble: 3 },
          },
        );
      }
    });
    // grass blades
    for (const b of model.meadowBlades) {
      const depth = (b.y - 450) / 150;
      v.curve(
        [
          [b.x, b.y],
          [b.x + b.lean * 0.4, b.y - b.h * 0.5],
          [b.x + b.lean, b.y - b.h],
        ],
        false,
        {
          stroke: b.color,
          weight: 1.2 + depth * 2.4,
          brush: { preset: "ink", thinning: 0.8 },
          gesture: { pressure: "taper-out", wobble: 0.5 },
        },
      );
    }
  });
}

function grassTufts(v: View, model: DeepReadonly<Model>): void {
  // flowers
  for (const f of model.flowers) {
    v.circle(f.x, f.y, 4 + (f.y - 470) * 0.03, { fill: f.color });
  }
}

const shadeStyle = (weight: number, opacity: number): Style => ({
  stroke: SHADE,
  weight,
  brush: { preset: "wash", opacity, blend: "multiply" },
  gesture: { pressure: "swell", wobble: 2 },
});

const rimStyle = (weight: number, opacity: number): Style => ({
  stroke: WARM,
  weight,
  brush: { preset: "wash", opacity, blend: "screen" },
  gesture: { pressure: "swell", wobble: 1 },
});

const PENCIL: Style = {
  stroke: "#2d5a3c",
  weight: 2.2,
  brush: { preset: "pencil", opacity: 0.55, blend: "multiply" },
  gesture: { pressure: "taper", wobble: 0.6 },
};

/** Fill a shape, shade inside it, then outline it. */
function part(
  v: View,
  shape: readonly Vec2[],
  shade: (() => void) | null,
  outline = 3.5,
): void {
  v.curve(shape, true, { fill: GREEN });
  v.clip(v.curvePath(shape, true), () => {
    shade?.();
    // scene light over every part: violet sky side, warm beam side
    v.rect(0, 0, W, H, {
      fill: v.linearGradient(220, 0, 470, 0, [
        [0, "#c2bbe8"],
        [0.5, "#f1edf6"],
        [1, "#fff4dc"],
      ]),
      blend: "multiply",
    });
  });
  v.curve(shape, true, ink(LINE, outline));
}

function shadeStroke(
  v: View,
  weight: number,
  pts: readonly Vec2[],
  opacity = 0.75,
): void {
  v.curve(pts, false, shadeStyle(weight, opacity));
}

function rimStroke(
  v: View,
  weight: number,
  pts: readonly Vec2[],
  opacity = 0.7,
): void {
  v.curve(pts, false, rimStyle(weight, opacity));
}

function alien(v: View): void {
  // ground shadow
  v.line(250, 552, 420, 552, {
    stroke: "#1b2a20",
    weight: 30,
    brush: { preset: "wash", opacity: 0.85, blend: "multiply" },
    gesture: { pressure: "swell", wobble: 2 },
  });

  for (const center of [LEG_L, LEG_R]) {
    const leg = tube(center, 24);
    const x = leg[0]?.[0] ?? 0;
    part(v, leg, () => {
      shadeStroke(v, 16, [
        [x - 14, 500],
        [x - 12, 550],
      ]);
    });
  }
  // feet
  for (const fx of [304, 356]) {
    const foot = oval(fx, 548, 24, 10, 10);
    part(v, foot, () =>
      shadeStroke(v, 12, [
        [fx - 26, 556],
        [fx + 26, 556],
      ]),
    );
  }
  // lowered arm (behind body)
  const armDown = tube(ARM_DOWN, 26, 20);
  part(v, armDown, () =>
    shadeStroke(v, 18, [
      [262, 400],
      [230, 440],
      [222, 480],
    ]),
  );
  part(v, oval(232, 484, 16, 15, 10), () =>
    shadeStroke(v, 14, [
      [218, 488],
      [238, 502],
    ]),
  );
  // waving arm (behind body)
  const armWave = tube(ARM_WAVE, 26, 20);
  part(v, armWave, () => {
    shadeStroke(v, 16, [
      [372, 404],
      [420, 392],
      [452, 350],
      [466, 316],
    ]);
    rimStroke(
      v,
      8,
      [
        [380, 382],
        [420, 368],
        [440, 336],
      ],
      0.6,
    );
  });

  // body
  part(
    v,
    BODY,
    () => {
      shadeStroke(
        v,
        60,
        [
          [256, 360],
          [262, 440],
          [296, 516],
        ],
        0.8,
      );
      shadeStroke(
        v,
        40,
        [
          [280, 350],
          [330, 366],
          [380, 350],
        ],
        0.7,
      );
      shadeStroke(
        v,
        30,
        [
          [270, 512],
          [330, 520],
          [400, 506],
        ],
        0.6,
      );
      rimStroke(
        v,
        10,
        [
          [392, 380],
          [398, 440],
          [390, 500],
        ],
        0.95,
      );
      rimStroke(
        v,
        22,
        [
          [396, 390],
          [404, 444],
          [396, 496],
        ],
        0.5,
      );
      // tummy: a lighter soft oval
      v.line(338, 430, 338, 470, {
        stroke: GREEN_LIGHT,
        weight: 46,
        brush: { preset: "airbrush", opacity: 0.55, blend: "screen" },
        gesture: { pressure: "even" },
      });
      // pencil hatching on the shadow side, following the body's curve
      for (let j = 0; j < 7; j += 1) {
        const x = 262 + j * 7;
        v.curve(
          [
            [x - 6, 500 - j * 2],
            [x + 2, 450],
            [x + 12, 396 + j * 4],
          ],
          false,
          PENCIL,
        );
      }
    },
    4,
  );

  // hand that waves, with three little fingers
  const HX = 456;
  const HY = 302;
  for (const [dx, dy, a] of [
    [-12, -18, -0.5],
    [0, -22, 0],
    [12, -17, 0.5],
  ] as const) {
    part(v, oval(HX + dx, HY + dy, 6, 10, 8, a), null, 2.5);
  }
  part(v, oval(HX, HY, 18, 16, 10), () => {
    shadeStroke(v, 14, [
      [440, 314],
      [460, 320],
      [472, 306],
    ]);
    rimStroke(
      v,
      6,
      [
        [466, 290],
        [474, 302],
      ],
      0.7,
    );
  });

  // heavier line on the shadow side of the body
  v.curve(BODY.slice(0, 5), false, ink(LINE, 7, 0.3));

  v.at({ translate: [330, 352], rotate: 0.08 }, () => {
    v.at({ translate: [-330, -352] }, () => {
      // head over the body
      part(
        v,
        HEAD,
        () => {
          shadeStroke(
            v,
            70,
            [
              [220, 240],
              [242, 330],
              [330, 368],
              [432, 330],
            ],
            0.75,
          );
          for (const k of [0.93, 0.86, 0.79]) {
            v.curve(
              arcPts(
                330,
                278,
                100 * k,
                76 * k,
                Math.PI * (0.62 + (1 - k)),
                Math.PI * (1.02 - (1 - k)),
                8,
              ),
              false,
              {
                ...PENCIL,
                weight: 3,
                brush: { preset: "pencil", opacity: 0.85, blend: "multiply" },
              },
            );
          }
          v.curve(
            [
              [280, 226],
              [340, 216],
              [392, 236],
            ],
            false,
            {
              stroke: GREEN_LIGHT,
              weight: 60,
              brush: { preset: "airbrush", opacity: 0.7 },
              gesture: { pressure: "swell" },
            },
          );
          rimStroke(
            v,
            12,
            [
              [416, 232],
              [428, 270],
              [418, 312],
            ],
            0.95,
          );
          rimStroke(
            v,
            30,
            [
              [410, 228],
              [430, 272],
              [416, 322],
            ],
            0.5,
          );
        },
        4,
      );

      // antennae
      v.curve(ANT_L, false, ink(LINE, 4, 0.4));
      v.curve(ANT_R, false, ink(LINE, 4, 0.4));
      for (const [x, y] of [
        [274, 146],
        [394, 142],
      ] as const) {
        v.line(x, y, x + 1, y, {
          stroke: "#ffe27a",
          weight: 40,
          brush: { preset: "airbrush", opacity: 0.45 },
          gesture: { pressure: "even" },
        });
        v.circle(x, y, 20, { fill: "#ffd84a" });
        v.circle(x - 3, y - 3, 6, { fill: "#fff6c0" });
        v.circle(x, y, 20, ink(LINE, 3));
      }

      // face
      v.ellipse(290, 276, 54, 62, { fill: "#ffffff" });
      v.ellipse(372, 276, 54, 62, { fill: "#ffffff" });
      v.circle(294, 282, 26, { fill: LINE });
      v.circle(368, 282, 26, { fill: LINE });
      v.circle(299, 276, 8, { fill: "#ffffff" });
      v.circle(373, 276, 8, { fill: "#ffffff" });
      v.ellipse(290, 276, 54, 62, ink(LINE, 3, 0.2));
      v.ellipse(372, 276, 54, 62, ink(LINE, 3, 0.2));
      // heavier line on the shadow side of the head
      v.curve(
        arcPts(330, 278, 100, 76, Math.PI * 0.55, Math.PI * 1.1, 8),
        false,
        ink(LINE, 7, 0.3),
      );
      // cheeks
      for (const cx of [254, 408]) {
        v.line(cx - 6, 314, cx + 6, 314, {
          stroke: "#f5939b",
          weight: 22,
          brush: { preset: "airbrush", opacity: 0.55 },
          gesture: { pressure: "even" },
        });
        v.ellipse(cx, 314, 20, 10, { fill: "#f4a0a4" });
      }
      // smile
      v.curve(
        [
          [310, 318],
          [320, 328],
          [331, 331],
          [342, 328],
          [352, 318],
        ],
        false,
        ink(LINE, 4, 0),
      );
    });
  });

  // wave motion lines
  const wave = ink("#fff3d0", 3, 0.2);
  v.curve(arcPts(456, 296, 42, 42, -1.6, -1.0, 4), false, wave);
  v.curve(arcPts(456, 296, 42, 42, -0.75, -0.2, 4), false, wave);
  v.curve(arcPts(456, 296, 42, 42, -2.5, -1.95, 4), false, wave);
}

function fireflies(v: View): void {
  const flies: Vec2[] = [
    [180, 420],
    [482, 430],
    [530, 250],
    [90, 505],
    [700, 525],
    [210, 330],
    [745, 430],
  ];
  for (const [x, y] of flies) {
    v.line(x, y, x + 1, y, {
      stroke: "#fff3a0",
      weight: 34,
      brush: { preset: "airbrush", opacity: 0.55, blend: "screen" },
      gesture: { pressure: "even" },
    });
    v.circle(x, y, 5, { fill: "#fffbe0" });
  }
}

/** A few blades in front of the feet so he stands in the grass, not on it. */
function foreGrass(v: View, model: DeepReadonly<Model>): void {
  for (const b of model.foreBlades) {
    v.curve(
      [
        [b.x, b.y],
        [b.x + b.lean * 0.4, b.y - b.h * 0.5],
        [b.x + b.lean, b.y - b.h],
      ],
      false,
      {
        stroke: b.color,
        weight: 2.2,
        brush: { preset: "ink", thinning: 0.8 },
        gesture: { pressure: "taper-out", wobble: 0.5 },
      },
    );
  }
}

export function draw(v: View, model: DeepReadonly<Model>): void {
  sky(v, model);
  hills(v);
  saucer(v);
  meadow(v, model);
  grassTufts(v, model);
  alien(v);
  foreGrass(v, model);
  fireflies(v);
}
