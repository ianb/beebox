// "Nell Rows Out" — a picture book about a girl who rows onto the lake at dusk
// to give back a lantern the old carp lost long ago. This page: "The water went
// quiet, and something very old came up to see."
// Dusk lake, far shore with one lit window, the girl kneeling in the bow holding
// the lantern out, and the great carp lifting its head under it. Reeds frame
// the foreground.
import type { Gesture, Style, Vec2, View } from "@ianbicking/canvas-loop";

const W = 800;
const H = 800;
const HORIZON = 300;
const WATERLINE = 560; // where the carp's head meets the water

const LANTERN: Vec2 = [498, 490];

export const canvas = { width: W, height: H };

export type Model = Record<string, never>;

export function init(): Model {
  return {};
}

export function update(model: Model): Model {
  return model;
}

export function draw(v: View): void {
  v.paper({ scale: 3, contrast: 0.6, seed: 7 });
  sky(v);
  farShore(v);
  water(v);
  fishBody(v);
  lanternReflection(v);
  ringsBack(v);
  boatBack(v);
  girl(v);
  boatFront(v);
  oar(v);
  fishHead(v);
  ringsFront(v);
  lantern(v);
  moths(v);
  lilyPads(v);
  reeds(v);
  vignette(v);
  v.paperTexture(0.35);
}

// ── helpers ─────────────────────────────────────────────────────────

function shift(pts: readonly Vec2[], dx: number, dy: number): Vec2[] {
  return pts.map(([x, y]): Vec2 => [x + dx, y + dy]);
}

/** Points on part of an ellipse, from angle a0 to a1 (radians). */
function ellipseArc(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  a0: number,
  a1: number,
  n = 12,
): Vec2[] {
  const pts: Vec2[] = [];
  for (let i = 0; i <= n; i += 1) {
    const a = a0 + ((a1 - a0) * i) / n;
    pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return pts;
}

/** Linear interpolation through colour stops, as an rgb() string. */
function sample(
  stops: readonly (readonly [number, string])[],
  t: number,
  dl = 0,
): string {
  const rgb = (h: string): [number, number, number] => [
    parseInt(h.slice(1, 3), 16),
    parseInt(h.slice(3, 5), 16),
    parseInt(h.slice(5, 7), 16),
  ];
  // the pair of stops around t (the last pair if t is past the end)
  const pairs = stops
    .slice(1)
    .map((hi, j): [readonly [number, string], readonly [number, string]] => [
      stops[j] ?? hi,
      hi,
    ]);
  const [[t0, c0], [t1, c1]] = pairs.find(([, hi]) => t <= hi[0]) ??
    pairs.at(-1) ?? [stops[0] ?? [0, "#000000"], stops[0] ?? [1, "#000000"]];
  const k = t1 === t0 ? 0 : Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
  const a = rgb(c0);
  const b = rgb(c1);
  const mix = (j: 0 | 1 | 2): number =>
    Math.round(Math.min(255, Math.max(0, a[j] + (b[j] - a[j]) * k + dl)));
  return `rgb(${mix(0)},${mix(1)},${mix(2)})`;
}

/**
 * One row of horizontal paint strokes across the canvas: strokes of varied
 * length that overlap, each tapering in and out so no seam lines up. Returns
 * the style of the last stroke.
 */
function paintRow(
  v: View,
  y: number,
  seed: number,
  wobble: number,
  base: Style,
): Style {
  let x = -120 + ((seed * 97) % 140);
  let k = 0;
  let last = base;
  while (x < W - 30) {
    const len = 220 + ((seed * 53 + k * 131) % 260);
    const dy = ((seed + k * 7) % 5) - 2;
    last = {
      ...base,
      gesture: {
        pressure: [
          [0, 0.35],
          [0.18, 1],
          [0.8, 1],
          [1, 0.25],
        ],
        wobble,
        seed: seed * 10 + k,
      },
    };
    v.curve(
      [
        [x, y + dy],
        [x + len / 2, y + dy + ((k % 2) * 2 - 1) * 2],
        [x + len, y + dy + 1],
      ],
      false,
      last,
    );
    x += len - 60 - ((seed * 31 + k * 17) % 50);
    k += 1;
  }
  return last;
}

function glow(
  v: View,
  x: number,
  y: number,
  r: number,
  rgb: string,
  a: number,
): void {
  v.circle(x, y, r, {
    fill: v.radialGradient(x, y, r, [
      [0, `rgba(${rgb},${a})`],
      [1, `rgba(${rgb},0)`],
    ]),
  });
}

// ── sky and shore ──────────────────────────────────────────────────

const SKY_STOPS: [number, string][] = [
  [0, "#181d44"],
  [0.45, "#3a3a74"],
  [0.8, "#9c7590"],
  [1, "#e3ae8a"],
];
const WATER_STOPS: [number, string][] = [
  [0, "#a98896"],
  [0.1, "#585a84"],
  [0.38, "#2b3f58"],
  [1, "#0e1c28"],
];

function sky(v: View): void {
  v.rect(0, 0, W, HORIZON + 4, {
    fill: v.linearGradient(0, 0, 0, HORIZON, SKY_STOPS),
  });
  // paint over the gradient in long loaded strokes, row by row
  for (let i = 0; i < 24; i += 1) {
    const y = 6 + i * 12.5;
    paintRow(v, y, i, 3, {
      stroke: sample(SKY_STOPS, y / HORIZON, i % 2 === 0 ? 30 : -22),
      weight: 26,
      brush: { preset: "bristle", opacity: 0.6, load: 0.7 },
    });
  }
  const cloud: Style = {
    brush: { preset: "wash", opacity: 0.5 },
    gesture: { pressure: "taper", wobble: 3 },
  };
  const violet: Style = { ...cloud, stroke: "#6a5a8c", weight: 30 };
  v.curve(
    [
      [60, 150],
      [220, 140],
      [380, 150],
    ],
    false,
    violet,
  );
  v.curve(
    [
      [420, 110],
      [600, 100],
      [760, 115],
    ],
    false,
    violet,
  );
  const rose: Style = { ...cloud, stroke: "#c9919a", weight: 18 };
  v.curve(
    [
      [0, 230],
      [180, 222],
      [330, 228],
    ],
    false,
    rose,
  );
  v.curve(
    [
      [480, 215],
      [650, 210],
      [800, 220],
    ],
    false,
    rose,
  );
  for (const [x, y, d] of [
    [140, 40, 1.6],
    [320, 22, 1.3],
    [470, 58, 1.2],
    [720, 30, 1.5],
    [250, 92, 1.1],
  ] as const) {
    v.circle(x, y, d / 2, { fill: "rgba(240,236,255,0.7)" });
  }
  glow(v, 612, 66, 16, "255,240,210", 0.5);
  v.circle(612, 66, 1.75, { fill: "#fff4d8" });
}

const HILLS: Vec2[] = [
  [-20, 302],
  [-10, 268],
  [90, 252],
  [200, 270],
  [300, 286],
  [420, 292],
  [560, 284],
  [700, 266],
  [820, 272],
  [820, 302],
];

function farShore(v: View): void {
  v.curve(HILLS, true, { fill: "#3d3f66" });
  for (let i = 0; i < 26; i += 1) {
    const x = 20 + i * 11 + (i % 3) * 3;
    const base = 290 - Math.sin(i * 0.4) * 6 - (x < 200 ? 12 : 0);
    const h = 12 + (i % 4) * 4;
    v.triangle(x - 4, base + 4, x + 4, base + 4, x, base - h, {
      fill: "#2e3054",
    });
  }
  // one lit window: home
  v.rect(146, 270, 4, 4, { fill: "#ffcf7a" });
  glow(v, 148, 272, 10, "255,200,110", 0.6);
}

// ── water ──────────────────────────────────────────────────────────

function water(v: View): void {
  v.rect(0, HORIZON, W, H - HORIZON, {
    fill: v.linearGradient(0, HORIZON, 0, H, WATER_STOPS),
  });
  let lastRow: Style = {};
  for (let i = 0; i < 30; i += 1) {
    const y = HORIZON + 8 + i * 16.5;
    lastRow = paintRow(v, y, 100 + i, 1.5, {
      stroke: sample(
        WATER_STOPS,
        (y - HORIZON) / (H - HORIZON),
        i % 2 === 0 ? 24 : -16,
      ),
      weight: 22 + i * 0.5,
      brush: { preset: "bristle", opacity: 0.45, load: 0.6 },
    });
  }
  // the far shore mirrored, softened. It is painted with the last water row's
  // thick bristle stroke still in hand, so its outline is a brushed stroke too.
  v.group({ opacity: 0.4 }, () => {
    v.curve(
      HILLS.map(([x, y]): Vec2 => [x, HORIZON + (HORIZON - y) * 0.6 + 1]),
      true,
      { ...lastRow, fill: "#3a3c62" },
    );
  });
  // evening mist lying on the far water
  v.curve(
    [
      [-40, 300],
      [200, 304],
      [420, 298],
      [640, 302],
      [840, 298],
    ],
    false,
    {
      stroke: "#c8a8b4",
      weight: 28,
      brush: { preset: "airbrush", opacity: 0.35 },
      gesture: { pressure: "taper", wobble: 4 },
    },
  );
  // brushed bands: reflected sky near the horizon, dark swell nearer
  const swell: Gesture = { pressure: "taper", wobble: 1 };
  for (let i = 0; i < 30; i += 1) {
    const t = i / 30;
    const y = HORIZON + 6 + t * t * 480;
    const x = (i * 211) % 700;
    const len = 60 + t * 220 + ((i * 37) % 80);
    v.line(x - len / 2, y, x + len / 2, y + 1, {
      stroke: t < 0.25 ? "#d0a2a0" : i % 2 === 0 ? "#536c8c" : "#1a2a3a",
      weight: 3 + t * 16,
      brush: { preset: "wash", opacity: 0.25 + t * 0.15 },
      gesture: swell,
    });
  }
  // little light glints on the near water
  for (let i = 0; i < 8; i += 1) {
    const x = 60 + ((i * 173) % 680);
    const y = 600 + ((i * 59) % 180);
    v.line(x, y, x + 18 + (i % 4) * 8, y, {
      stroke: "#8aa0bc",
      weight: 1.4,
      brush: { preset: "ink", opacity: 0.5 },
      gesture: swell,
    });
  }
}

// The carp's whole body, under the water: seen dim and blue-shifted.
const FISH_BODY: Vec2[] = [
  [556, 554],
  [662, 552],
  [730, 600],
  [772, 680],
  [776, 770],
  [740, 820],
  [650, 800],
  [606, 714],
  [574, 630],
];

function fishBody(v: View): void {
  v.group({ opacity: 0.4 }, () => {
    v.curve(FISH_BODY, true, { fill: "#98865a" });
    v.clip(v.curvePath(FISH_BODY, true), () => {
      v.curve(shift(v.offset(FISH_BODY, 4), 26, 4), true, { fill: "#5a5a46" });
      const scale: Style = {
        stroke: "#2e2a1e",
        weight: 2.2,
        brush: { preset: "ink", opacity: 0.8 },
        gesture: { pressure: "taper" },
      };
      // rows across the body, following its axis down and to the right,
      // each scale a small arc opening toward the tail
      const ax: Vec2 = [0.42, 0.91]; // unit vector down the body
      const px: Vec2 = [0.91, -0.42]; // across the body
      for (let r = 0; r < 8; r += 1) {
        const along = 30 + r * 26;
        const half = 2 + Math.min(r, 4);
        for (let c = -half; c <= half; c += 1) {
          const across = (c + (r % 2) * 0.5) * 24;
          const cx = 612 + ax[0] * along + px[0] * across;
          const cy = 556 + ax[1] * along + px[1] * across;
          const size = 12 - r * 0.5;
          const pts: Vec2[] = [];
          for (let k = 0; k <= 6; k += 1) {
            const a = -1.2 + (k / 6) * 2.4;
            const u = Math.sin(a) * size;
            const w = Math.cos(a) * size * 0.75;
            pts.push([cx + px[0] * u + ax[0] * w, cy + px[1] * u + ax[1] * w]);
          }
          v.curve(pts, false, scale);
        }
      }
    });
    // dorsal fin, along the back
    v.curve(
      [
        [680, 578],
        [740, 590],
        [796, 650],
        [778, 690],
        [736, 640],
      ],
      true,
      { fill: "#2a2a20" },
    );
  });
  // deep water over the lower body
  v.ellipse(690, 800, 180, 220, {
    fill: v.ellipseGradient(690, 800, 180, 220, [
      [0, "rgba(14,28,40,0.75)"],
      [0.6, "rgba(14,28,40,0.4)"],
      [1, "rgba(14,28,40,0)"],
    ]),
  });
}

function lanternReflection(v: View): void {
  glowEllipse(v, LANTERN[0] + 10, 548, 300, 90, "255,176,90", 0.3);
  // broken glints, wider and fainter as they come toward us
  const dxs = [0, -6, 5, -3, 8, -9, 2, 10, -12, 4, -6, 13, -2, 7];
  for (const [i, dx] of dxs.entries()) {
    const y = 528 + i * 8 + i * i * 0.55;
    const half = 12 + ((i * 7) % 11) + i * 1.2;
    const x = LANTERN[0] + 4 + dx;
    const glint: Style = {
      stroke: "#f4b058",
      weight: 2 + (i % 2),
      brush: { preset: "ink", opacity: 0.8 - i * 0.045, thinning: 0.8 },
      gesture: { pressure: "taper", wobble: 1.2, seed: 300 + i },
    };
    v.line(x - half, y, x + half * 0.4, y + 1, glint);
    if (i % 2 === 1)
      v.line(x + half * 0.6, y + 2, x + half * 1.2, y + 2, glint);
  }
  v.line(LANTERN[0] + 4, 530, LANTERN[0] + 6, 640, {
    stroke: "#f4b058",
    weight: 26,
    brush: { preset: "wash", opacity: 0.4 },
    gesture: { pressure: "taper" },
  });
}

function glowEllipse(
  v: View,
  x: number,
  y: number,
  w: number,
  h: number,
  rgb: string,
  a: number,
): void {
  v.ellipse(x, y, w / 2, h / 2, {
    fill: v.ellipseGradient(x, y, w / 2, h / 2, [
      [0, `rgba(${rgb},${a})`],
      [1, `rgba(${rgb},0)`],
    ]),
  });
}

// Rings spreading from where the carp broke the surface.
const RINGS = [
  { rx: 82, ry: 14 },
  { rx: 116, ry: 21 },
  { rx: 158, ry: 30 },
];
const RING_C: Vec2 = [606, WATERLINE];

function ringsBack(v: View): void {
  for (const [i, r] of RINGS.entries()) {
    v.curve(
      ellipseArc(
        RING_C[0],
        RING_C[1],
        r.rx,
        r.ry,
        Math.PI * 1.05,
        Math.PI * 1.95,
      ),
      false,
      {
        stroke: "#e7c49a",
        weight: 2 - i * 0.4,
        brush: { preset: "ink", opacity: 0.55 },
        gesture: { pressure: "taper", wobble: 0.6 },
      },
    );
  }
}

function ringsFront(v: View): void {
  for (const [i, r] of RINGS.entries()) {
    v.curve(
      ellipseArc(
        RING_C[0],
        RING_C[1],
        r.rx,
        r.ry,
        Math.PI * 0.08,
        Math.PI * 0.92,
      ),
      false,
      {
        stroke: "#f0d2a6",
        weight: 2.6 - i * 0.5,
        brush: { preset: "ink", opacity: 0.75 },
        gesture: { pressure: "taper", wobble: 0.6 },
      },
    );
  }
}

// ── the carp's head above water ─────────────────────────────────────

const HEAD_F: Vec2[] = [
  [538, 496],
  [558, 478],
  [600, 468],
  [642, 482],
  [664, 520],
  [672, 566],
  [566, 568],
  [550, 532],
  [534, 512],
];

function fishHead(v: View): void {
  const above: Vec2[] = [
    [500, 440],
    [700, 440],
    [700, WATERLINE + 2],
    [500, WATERLINE + 2],
  ];
  v.clip(above, () => {
    v.curve(HEAD_F, true, { fill: "#d6ae62" });
    v.clip(v.curvePath(HEAD_F, true), () => {
      // shade on the far side, away from the lantern
      v.curve(shift(v.offset(HEAD_F, 2), 40, 14), true, { fill: "#7a6034" });
      // lantern light on the face
      glow(v, 520, 492, 90, "255,214,150", 0.8);
      // old colour patches, like a koi's
      const patch: Style = {
        stroke: "#c0662e",
        weight: 26,
        brush: { preset: "wash", opacity: 0.6 },
        gesture: { pressure: "swell", wobble: 2 },
      };
      v.curve(
        [
          [596, 476],
          [624, 486],
          [648, 512],
        ],
        false,
        patch,
      );
      v.curve(
        [
          [640, 540],
          [656, 556],
        ],
        false,
        { ...patch, weight: 16 },
      );
      // wet highlight along the crown
      v.curve(
        [
          [556, 482],
          [580, 472],
          [610, 472],
        ],
        false,
        {
          stroke: "#fff0c8",
          weight: 3,
          brush: { preset: "ink", opacity: 0.85 },
          gesture: { pressure: "taper" },
        },
      );
      // gill cover
      const gill: Style = {
        stroke: "#5e4826",
        weight: 2.6,
        brush: { preset: "ink", opacity: 0.85 },
        gesture: { pressure: "swell", wobble: 0.5 },
      };
      v.curve(
        [
          [614, 474],
          [630, 512],
          [630, 566],
        ],
        false,
        gill,
      );
      // cheek line under the eye
      v.curve(
        [
          [560, 524],
          [584, 532],
          [608, 524],
        ],
        false,
        { ...gill, weight: 1.8 },
      );
      // scales begin behind the gill
      const scales: Style = {
        ...gill,
        weight: 2.5,
        brush: { preset: "pencil", opacity: 0.8 },
      };
      for (let r = 0; r < 3; r += 1) {
        for (let c = 0; c < 2; c += 1) {
          v.curve(
            ellipseArc(
              644 + c * 16,
              506 + r * 18 + c * 8,
              9,
              7,
              0.3,
              Math.PI - 0.3,
              6,
            ),
            false,
            scales,
          );
        }
      }
    });
    // mouth, a round "O" toward the lantern
    v.ellipse(538, 504, 9, 11, { fill: "#e8c48a" });
    v.ellipse(537, 503, 5.5, 7.5, { fill: "#3a2216" });
    v.ellipse(538, 505, 2.5, 4, { fill: "#b0603e" });
    // eye: large and old and kind, looking up at the lantern
    v.circle(580, 496, 10, { fill: "#f2e2b4" });
    v.circle(577, 494, 6.5, { fill: "#20160e" });
    v.circle(574, 491, 2, { fill: "#fff6dc" });
    v.curve(
      [
        [568, 486],
        [580, 482],
        [592, 487],
      ],
      false,
      {
        stroke: "#5e4826",
        weight: 1.6,
        brush: "ink",
        gesture: { pressure: "taper" },
      },
    );
    // barbels
    const barbel: Style = {
      stroke: "#5e4826",
      weight: 2.4,
      brush: "ink",
      gesture: { pressure: "taper-out", wobble: 0.4 },
    };
    v.curve(
      [
        [542, 514],
        [528, 532],
        [522, 556],
      ],
      false,
      barbel,
    );
    v.curve(
      [
        [548, 518],
        [544, 538],
        [548, 560],
      ],
      false,
      barbel,
    );
    // outline
    const outline: Style = {
      stroke: "#2c1e10",
      weight: 3,
      brush: "ink",
      gesture: { pressure: "swell", wobble: 0.8 },
    };
    v.curve(HEAD_F.slice(0, 6), false, outline);
    v.curve([...HEAD_F.slice(6), ...HEAD_F.slice(0, 1)], false, {
      ...outline,
      weight: 2.2,
    });
  });
  // drops falling from the chin, lit by the lantern
  for (const [x, y, d] of [
    [530, 540, 3.5],
    [527, 550, 2.5],
    [534, 528, 2],
  ] as const) {
    v.circle(x, y, d / 2, { fill: "#ffe2b0" });
  }
  // water lapping at the waterline
  v.curve(
    [
      [540, WATERLINE + 2],
      [600, WATERLINE - 2],
      [672, WATERLINE + 2],
    ],
    false,
    {
      stroke: "#e9caa0",
      weight: 2.6,
      brush: { preset: "ink", opacity: 0.85 },
      gesture: { pressure: "taper", wobble: 1 },
    },
  );
}

// ── the boat ───────────────────────────────────────────────────────

const HULL: Vec2[] = [
  [170, 496],
  [300, 500],
  [420, 490],
  [486, 466],
  [470, 506],
  [430, 534],
  [330, 548],
  [230, 546],
  [186, 528],
];
const INSIDE: Vec2[] = [
  [176, 494],
  [260, 476],
  [380, 470],
  [474, 464],
  [420, 492],
  [300, 500],
];

function boatBack(v: View): void {
  v.group({ opacity: 0.4 }, () => {
    v.curve(
      [
        [190, 540],
        [330, 552],
        [440, 538],
        [430, 572],
        [320, 594],
        [220, 582],
      ],
      true,
      { fill: "#120e0c" },
    );
  });
  glowEllipse(v, 450, 556, 120, 40, "240,150,70", 0.35);
  v.curve(INSIDE, true, { fill: "#3b2618" });
  v.clip(v.curvePath(INSIDE, true), () => {
    v.curve(
      [
        [180, 488],
        [300, 478],
        [470, 466],
      ],
      false,
      {
        stroke: "#5c3a22",
        weight: 14,
        brush: { preset: "bristle", opacity: 0.6 },
        gesture: { pressure: "even" },
      },
    );
    glow(v, LANTERN[0], LANTERN[1], 90, "255,170,80", 0.45);
  });
  v.curve(
    [
      [176, 494],
      [260, 476],
      [380, 470],
      [474, 464],
    ],
    false,
    {
      stroke: "#22140c",
      weight: 2.2,
      brush: "ink",
      gesture: { pressure: "taper", wobble: 0.6 },
    },
  );
}

function oar(v: View): void {
  // resting in its lock, blade trailing in the water off the stern
  const shaft = v.tube(
    [
      [262, 468],
      [196, 508],
      [140, 548],
    ],
    { width: 7 },
  );
  v.path(shaft, { fill: "#9a6a40" });
  const blade: Vec2[] = [
    [148, 540],
    [120, 552],
    [92, 572],
    [104, 582],
    [134, 566],
  ];
  v.curve(blade, true, { fill: "#8a5c36" });
  // the water closes over the lower half of the blade
  v.curve(
    [
      [160, 556],
      [120, 562],
      [86, 578],
      [110, 590],
      [150, 570],
    ],
    true,
    { fill: "rgba(40,58,80,0.65)" },
  );
  const edge: Style = {
    stroke: "#22140c",
    weight: 1.8,
    brush: "ink",
    gesture: { pressure: "taper", wobble: 0.4 },
  };
  v.path(shaft, edge);
  v.curve(blade, true, edge);
  v.curve(ellipseArc(124, 566, 42, 8, Math.PI * 0.1, Math.PI * 0.9), false, {
    ...edge,
    stroke: "#a8b4c8",
    weight: 1.5,
    brush: { preset: "ink", opacity: 0.6 },
  });
}

function boatFront(v: View): void {
  v.curve(HULL, true, { fill: "#7a4a2c" });
  v.clip(v.curvePath(HULL, true), () => {
    const plank: Style = {
      brush: { preset: "bristle", opacity: 0.85 },
      gesture: { pressure: "even", wobble: 1 },
    };
    v.curve(
      [
        [160, 506],
        [320, 510],
        [480, 480],
      ],
      false,
      { ...plank, stroke: "#a8693c", weight: 16 },
    );
    v.curve(
      [
        [170, 536],
        [320, 544],
        [470, 512],
      ],
      false,
      { ...plank, stroke: "#4a2a16", weight: 20 },
    );
    const seam: Style = {
      stroke: "#3a2214",
      weight: 1.5,
      brush: "ink",
      gesture: { pressure: "taper" },
    };
    v.curve(
      [
        [180, 512],
        [320, 518],
        [476, 484],
      ],
      false,
      seam,
    );
    v.curve(
      [
        [190, 528],
        [320, 533],
        [462, 506],
      ],
      false,
      seam,
    );
    glow(v, LANTERN[0], LANTERN[1], 120, "255,170,80", 0.6);
  });
  const rim: Style = {
    stroke: "#22140c",
    brush: "ink",
    gesture: { pressure: "swell", wobble: 0.8 },
  };
  v.curve(
    [
      [170, 496],
      [300, 500],
      [420, 490],
      [486, 466],
    ],
    false,
    { ...rim, weight: 3.5 },
  );
  v.curve(
    [
      [486, 466],
      [470, 506],
      [430, 534],
      [330, 548],
      [230, 546],
      [186, 528],
      [170, 496],
    ],
    false,
    {
      ...rim,
      weight: 2.4,
    },
  );
}

// ── the girl ───────────────────────────────────────────────────────

const COAT: Vec2[] = [
  [352, 510],
  [354, 470],
  [368, 440],
  [394, 424],
  [420, 426],
  [436, 446],
  [442, 478],
  [440, 510],
];
const FACE: Vec2[] = [
  [404, 384],
  [420, 376],
  [436, 382],
  [442, 396],
  [449, 402],
  [442, 408],
  [440, 416],
  [428, 422],
  [412, 420],
  [400, 404],
];
const HAT: Vec2[] = [
  [398, 396],
  [396, 376],
  [408, 362],
  [428, 360],
  [442, 372],
  [446, 388],
];

function girl(v: View): void {
  // braid hanging down her back
  v.curve(
    [
      [404, 400],
      [396, 420],
      [386, 446],
    ],
    false,
    {
      stroke: "#3a2416",
      weight: 9,
      brush: "ink",
      gesture: { pressure: "taper-out", wobble: 0.5 },
    },
  );
  // coat
  v.curve(COAT, true, { fill: "#2f5a5e" });
  v.clip(v.curvePath(COAT, true), () => {
    v.curve(shift(v.offset(COAT, 4), -18, 6), true, { fill: "#1a343c" });
    glow(v, 470, 470, 60, "240,170,90", 0.7);
    const fold: Style = {
      brush: { preset: "bristle", opacity: 0.55, load: 0.9 },
      gesture: { pressure: "even", wobble: 1 },
    };
    const dark: Style = { ...fold, stroke: "#122a30", weight: 18 };
    v.curve(
      [
        [360, 500],
        [364, 462],
        [384, 436],
      ],
      false,
      dark,
    );
    v.curve(
      [
        [376, 506],
        [380, 470],
        [396, 444],
      ],
      false,
      dark,
    );
    v.curve(
      [
        [404, 432],
        [424, 450],
        [432, 504],
      ],
      false,
      { ...fold, stroke: "#4a8282", weight: 16 },
    );
    v.curve(
      [
        [426, 440],
        [438, 466],
        [440, 504],
      ],
      false,
      { ...fold, stroke: "#c99a5c", weight: 10 },
    );
  });
  // scarf
  v.curve(
    [
      [402, 416],
      [420, 418],
      [434, 424],
      [430, 432],
      [412, 432],
      [400, 428],
    ],
    true,
    { fill: "#d9a334" },
  );
  v.curve(
    [
      [404, 426],
      [388, 436],
      [366, 438],
      [352, 446],
      [360, 432],
      [384, 424],
    ],
    true,
    { fill: "#d9a334" },
  );
  // arm reaching to the lantern
  const arm = v.tube(
    [
      [418, 438],
      [452, 448],
      [482, 452],
    ],
    {
      width: 16,
      profile: [
        [0, 1],
        [1, 0.75],
      ],
    },
  );
  v.path(arm, { fill: "#2f5a5e" });
  v.clip(arm, () => {
    v.rect(400, 440, 100, 8, { fill: "#1a343c" });
    glow(v, 488, 470, 40, "250,180,100", 0.8);
  });
  v.path(arm, {
    stroke: "#14100c",
    weight: 2,
    brush: "ink",
    gesture: { pressure: "taper", wobble: 0.4 },
  });
  // mitten
  v.circle(486, 452, 7, { fill: "#c4402e" });
  // face in profile
  v.curve(FACE, true, { fill: "#e8b896" });
  v.clip(v.curvePath(FACE, true), () => {
    v.curve(shift(FACE, -22, -4), true, { fill: "#4a2c1a" });
    v.curve(
      [
        [420, 392],
        [424, 404],
        [418, 414],
        [414, 404],
      ],
      true,
      { fill: "#c9967a" },
    );
    glow(v, 470, 440, 56, "255,196,120", 0.8);
    v.circle(428, 408, 5, { fill: "rgba(214,110,90,0.45)" });
  });
  v.circle(433, 395, 1.8, { fill: "#1c140c" });
  const line: Style = {
    stroke: "#3a2214",
    weight: 1.6,
    brush: "ink",
    gesture: { pressure: "taper" },
  };
  v.curve(
    [
      [428, 386],
      [433, 383],
      [438, 386],
    ],
    false,
    line,
  );
  v.curve(FACE.slice(2, 8), false, line);
  v.ellipse(441, 411, 2, 2.5, { fill: "#5a2418" });
  // hat with a turned-up band and a pompom
  v.curve(HAT, true, { fill: "#c4402e" });
  v.clip(v.curvePath(HAT, true), () => {
    v.curve(shift(HAT, -10, -4), true, { fill: "#8e2a20" });
    v.line(410, 366, 440, 380, {
      stroke: "#e56a4a",
      weight: 10,
      brush: { preset: "chalk", opacity: 0.6 },
      gesture: { pressure: "even" },
    });
  });
  const band: Vec2[] = [
    [396, 384],
    [420, 378],
    [446, 382],
    [446, 392],
    [420, 388],
    [398, 394],
  ];
  v.curve(band, true, { fill: "#a8322a" });
  v.clip(v.curvePath(band, true), () => {
    const stitch: Style = {
      stroke: "#6e1e18",
      weight: 1.6,
      brush: { preset: "pencil", opacity: 0.7 },
      gesture: { pressure: "even" },
    };
    for (let x = 400; x < 446; x += 5) v.line(x, 376, x + 1, 396, stitch);
  });
  v.circle(400, 362, 6.5, { fill: "#efe0c8" });
  const edge: Style = {
    stroke: "#14100c",
    weight: 2.2,
    brush: "ink",
    gesture: { pressure: "swell", wobble: 0.5 },
  };
  v.curve(HAT, true, edge);
  v.curve(COAT.slice(0, 6), false, edge);
}

// ── the lantern ────────────────────────────────────────────────────

function lantern(v: View): void {
  const [x, y] = LANTERN;
  glow(v, x, y, 150, "255,190,100", 0.35);
  glow(v, x, y, 50, "255,220,150", 0.7);
  // bail from the mitten
  const bail: Style = {
    stroke: "#14100c",
    weight: 1.6,
    brush: "ink",
    gesture: { pressure: "even" },
  };
  v.curve(
    [
      [480, 456],
      [488, 466],
      [x - 6, y - 16],
    ],
    false,
    bail,
  );
  v.curve(
    [
      [492, 456],
      [x + 6, y - 16],
    ],
    false,
    bail,
  );
  // body: cap, glass, base
  v.rect(x - 8, y - 12, 16, 22, { fill: "#fff2c4" });
  v.circle(x, y, 9, {
    fill: v.radialGradient(x, y, 9, [
      [0, "#ffffff"],
      [1, "rgba(255,240,190,0)"],
    ]),
  });
  v.triangle(x - 11, y - 12, x + 11, y - 12, x, y - 20, { fill: "#2a1c12" });
  v.rect(x - 10, y + 9, 20, 4, { fill: "#2a1c12" });
  v.rect(x - 9, y - 12, 2, 22, { fill: "#2a1c12" });
  v.rect(x + 7, y - 12, 2, 22, { fill: "#2a1c12" });
}

// ── lily pads in the near water ────────────────────────────────────

function lilyPad(
  v: View,
  x: number,
  y: number,
  w: number,
  notch: number,
): void {
  const h = w * 0.32;
  const pts: Vec2[] = [];
  for (let i = 0; i <= 14; i += 1) {
    const a = notch + 0.16 + (i / 14) * (Math.PI * 2 - 0.32);
    pts.push([x + Math.cos(a) * w * 0.5, y + Math.sin(a) * h * 0.5]);
  }
  pts.push([x, y]);
  v.polygon(pts, { fill: "#152a28" });
  v.clip(pts, () => {
    const gesture: Gesture = { pressure: "even", wobble: 1 };
    v.line(x - w * 0.5, y - h * 0.2, x + w * 0.5, y - h * 0.25, {
      stroke: "#22403a",
      weight: h * 0.5,
      brush: { preset: "bristle", opacity: 0.7, load: 0.8 },
      gesture,
    });
    // the sky caught on the far rim
    v.curve(
      ellipseArc(x, y, w * 0.5, h * 0.5, Math.PI * 1.1, Math.PI * 1.9),
      false,
      {
        stroke: "#6c6c92",
        weight: 6,
        brush: { preset: "wash", opacity: 0.55 },
        gesture,
      },
    );
  });
  v.curve(ellipseArc(x, y, w * 0.5, h * 0.5, 0, Math.PI), false, {
    stroke: "#08120e",
    weight: 1.8,
    brush: "ink",
    gesture: { pressure: "swell", wobble: 0.6 },
  });
}

function lilyPads(v: View): void {
  lilyPad(v, 250, 742, 150, 4.2);
  lilyPad(v, 380, 778, 120, 4.9);
  lilyPad(v, 170, 690, 80, 3.9);
  // one shut bud, its tip catching the sky
  v.curve(
    [
      [285, 730],
      [289, 716],
      [292, 711],
      [296, 716],
      [299, 730],
    ],
    true,
    { fill: "#7a5a72" },
  );
  v.curve(
    [
      [289, 718],
      [292, 711],
      [295, 718],
    ],
    true,
    { fill: "#c8a8b8" },
  );
}

function moths(v: View): void {
  const m: [number, number, number][] = [
    [522, 448, 0.3],
    [470, 520, -0.5],
  ];
  for (const [x, y, a] of m) {
    // two triangular wings each side of a small body, tilted by `a`
    const wing = (sx: number): Vec2[] => [
      [x, y],
      [x + sx * 9, y - 5 + sx * a * 6],
      [x + sx * 7, y + 3 + sx * a * 6],
    ];
    v.polygon(wing(-1), { fill: "rgba(255,242,210,0.95)" });
    v.polygon(wing(1), { fill: "rgba(255,242,210,0.95)" });
    v.ellipse(x, y, 1.25, 3, { fill: "#5a4632" });
  }
}

/** Darken the corners a little, to hold the eye on the lantern. */
function vignette(v: View): void {
  v.group({ blend: "multiply" }, () => {
    v.rect(0, 0, W, H, {
      fill: v.radialGradient(470, 470, 640, [
        [0, "rgba(255,255,255,0)"],
        [0.55, "rgba(255,255,255,0)"],
        [1, "rgba(120,110,150,1)"],
      ]),
    });
  });
}

// ── foreground reeds ───────────────────────────────────────────────

function reeds(v: View): void {
  const reed = (weight: number): Style => ({
    stroke: "#09121a",
    weight,
    brush: "ink",
    gesture: { pressure: "taper-out", wobble: 1.5 },
  });
  for (let i = 0; i < 14; i += 1) {
    const x = 10 + i * 12 + (i % 3) * 5;
    const top = 600 + ((i * 47) % 120);
    const tip: Vec2 = [x + 14 + (i % 4) * 6, top];
    v.curve(
      [[x, 820], [x + 4, (820 + top) / 2], tip],
      false,
      reed(3 + (i % 3)),
    );
  }
  for (let i = 0; i < 9; i += 1) {
    const x = 722 + i * 10;
    const top = 570 + ((i * 53) % 140);
    const tip: Vec2 = [x - 12 - (i % 3) * 5, top];
    v.curve(
      [[x, 820], [x - 2, (820 + top) / 2], tip],
      false,
      reed(3 + (i % 3)),
    );
  }
  // cattails on stiff stalks
  const stalk: Style = {
    stroke: "#09121a",
    weight: 2.5,
    brush: "ink",
    gesture: { pressure: "even" },
  };
  v.line(56, 820, 58, 620, stalk);
  v.line(712, 820, 706, 580, stalk);
  v.ellipse(58, 640, 5, 18, { fill: "#2a1a10" });
  v.ellipse(706, 600, 5, 17, { fill: "#2a1a10" });
}
