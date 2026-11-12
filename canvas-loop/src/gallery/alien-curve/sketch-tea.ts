import type { PathCommand, Style, Vec2, View } from "@ianbicking/canvas-loop";

// A friendly green alien, picture-book style: ink outlines drawn with s.curve,
// bristle and pencil shading clipped inside each shape. One frame, no state:
// the model is empty.

const INK = "#1f2a1c";
const GREEN = "#79c96a";
const GREEN_DARK = "#3a8236";
const GREEN_LIGHT = "#c2eeab";

type Pts = readonly Vec2[];

/** Points around an ellipse, for a closed curve. */
function ellipsePts(e: {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  n?: number;
}): Vec2[] {
  const { cx, cy, rx, ry } = e;
  const n = e.n ?? 10;
  const out: Vec2[] = [];
  for (let i = 0; i < n; i += 1) {
    const a = (i / n) * Math.PI * 2;
    out.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return out;
}

/** The same Catmull-Rom curve as v.curve(points, true), as path commands for clip(). */
function closedCurvePath(points: Pts): PathCommand[] {
  const n = points.length;
  const at = (i: number): Vec2 => points[(i + n) % n] ?? [0, 0];
  const first = at(0);
  const cmds: PathCommand[] = [["move", first[0], first[1]]];
  for (let i = 0; i < n; i += 1) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    cmds.push([
      "bezier",
      p1[0] + (p2[0] - p0[0]) / 6,
      p1[1] + (p2[1] - p0[1]) / 6,
      p2[0] - (p3[0] - p1[0]) / 6,
      p2[1] - (p3[1] - p1[1]) / 6,
      p2[0],
      p2[1],
    ]);
  }
  cmds.push(["close"]);
  return cmds;
}

// ── shapes ───────────────────────────────────────────────────────────
const HEAD = ellipsePts({ cx: 200, cy: 175, rx: 106, ry: 84, n: 12 });
const BODY: Pts = [
  [200, 249],
  [236, 254],
  [248, 290],
  [256, 345],
  [255, 380],
  [238, 395],
  [200, 399],
  [162, 395],
  [145, 380],
  [144, 345],
  [152, 290],
  [164, 254],
];
const ARM_R: Pts = [
  [242, 262],
  [290, 258],
  [318, 236],
  [336, 232],
  [326, 262],
  [296, 284],
  [248, 294],
];
const ARM_L: Pts = [
  [156, 282],
  [126, 314],
  [114, 350],
  [114, 376],
  [136, 374],
  [138, 348],
  [152, 326],
];
const LEG_L: Pts = [
  [166, 386],
  [190, 386],
  [191, 438],
  [165, 438],
];
const LEG_R: Pts = [
  [210, 386],
  [234, 386],
  [235, 438],
  [209, 438],
];
const FOOT_L = ellipsePts({ cx: 172, cy: 443, rx: 24, ry: 11, n: 8 });
const FOOT_R = ellipsePts({ cx: 228, cy: 443, rx: 24, ry: 11, n: 8 });
const HAND_R = ellipsePts({ cx: 330, cy: 222, rx: 14, ry: 14, n: 8 });
const HAND_L = ellipsePts({ cx: 122, cy: 380, rx: 13, ry: 13, n: 8 });
const BELLY = ellipsePts({ cx: 200, cy: 345, rx: 30, ry: 36, n: 8 });
const EYE_L = ellipsePts({ cx: 160, cy: 164, rx: 26, ry: 31, n: 8 });
const EYE_R = ellipsePts({ cx: 240, cy: 164, rx: 26, ry: 31, n: 8 });

interface Part {
  readonly pts: Pts;
  readonly color?: string;
  readonly weight?: number;
  readonly closed?: boolean;
  readonly marks?: () => void;
  readonly pressure?: "even" | "taper";
  /** Where along a closed outline (0..1 from its first point) the ink is heaviest. */
  readonly heavy?: number;
}

/** Closed-outline pressure: heaviest at `heavy`, lightest opposite it. */
function heavyAt(heavy: number): [number, number][] {
  const keys: [number, number][] = [];
  for (let i = 0; i <= 8; i += 1) {
    const t = i / 8;
    keys.push([t, 0.68 + 0.32 * Math.cos(2 * Math.PI * (t - heavy))]);
  }
  return keys;
}

function flatFill(v: View, part: Part): void {
  v.curve(part.pts, true, { fill: part.color ?? GREEN });
}

function outline(v: View, part: Part): void {
  const closed = part.closed ?? true;
  v.curve(part.pts, closed, {
    stroke: INK,
    weight: part.weight ?? 3.6,
    brush: { preset: "ink", thinning: 0.35 },
    gesture: {
      pressure: closed
        ? heavyAt(part.heavy ?? 0.3)
        : (part.pressure ?? "taper"),
      wobble: 0.6,
    },
  });
}

/** Run `part.marks` clipped to the part's outline. */
function shade(v: View, part: Part): void {
  const marks = part.marks;
  if (marks === undefined) return;
  v.clip(closedCurvePath(part.pts), marks);
}

interface Stroke {
  readonly color: string;
  readonly weight: number;
  readonly pts: Pts;
  readonly opacity?: number;
}

function bristleStroke(v: View, st: Stroke): void {
  const style: Style = {
    stroke: st.color,
    weight: st.weight,
    brush: {
      preset: "bristle",
      opacity: st.opacity ?? 0.75,
      flow: 0.8,
      bristles: 22,
      load: 1.4,
    },
    gesture: { pressure: "taper", wobble: 1.5 },
  };
  v.curve(st.pts, false, style);
}

function greenPart(v: View, part: Part): void {
  flatFill(v, part);
  shade(v, part);
  outline(v, part);
}

// ── draw ─────────────────────────────────────────────────────────────
export const canvas = { width: 400, height: 500 };

export type Model = Record<string, never>;

export function init(): Model {
  return {};
}

export function update(model: Model): Model {
  return model;
}

const D = GREEN_DARK;
const L = GREEN_LIGHT;

export function draw(v: View): void {
  v.background("#f4f1ea");

  // ground shadow
  const shadow = ellipsePts({ cx: 200, cy: 450, rx: 95, ry: 13, n: 10 });
  flatFill(v, { pts: shadow, color: "rgba(120,110,80,0.14)" });
  shade(v, {
    pts: shadow,
    marks: () => {
      const pencil: Style = {
        stroke: "#8f8668",
        weight: 2.2,
        brush: { preset: "pencil", opacity: 0.6 },
        gesture: { pressure: "taper" },
      };
      for (let i = 0; i < 34; i += 1)
        v.line(104 + i * 6, 466, 116 + i * 6, 436, pencil);
    },
  });

  // antennae
  for (const [base, tip] of [
    [
      [168, 100],
      [140, 42],
    ],
    [
      [232, 100],
      [262, 36],
    ],
  ] as const) {
    const mid: Vec2 = [
      (base[0] + tip[0]) / 2 + (tip[0] < 200 ? 3 : -3),
      (base[1] + tip[1]) / 2,
    ];
    outline(v, {
      pts: [base, mid, tip],
      weight: 3.6,
      closed: false,
      pressure: "even",
    });
    const ball = ellipsePts({ cx: tip[0], cy: tip[1], rx: 11, ry: 11, n: 8 });
    flatFill(v, { pts: ball, color: "#f2d34a" });
    shade(v, {
      pts: ball,
      marks: () => {
        const pencil: Style = {
          stroke: "#d99a2b",
          weight: 2,
          brush: "pencil",
          gesture: { pressure: 0.8 },
        };
        for (let i = 0; i < 5; i += 1)
          v.line(
            tip[0] - 12 + i * 3,
            tip[1] + 12,
            tip[0] - 2 + i * 3,
            tip[1] - 2,
            pencil,
          );
      },
    });
    outline(v, { pts: ball, weight: 3 });
  }

  // legs and feet
  for (const leg of [LEG_L, LEG_R]) {
    const x = (leg[1]?.[0] ?? 0) - 4;
    greenPart(v, {
      pts: leg,
      heavy: 0.6,
      marks: () =>
        bristleStroke(v, {
          color: D,
          weight: 9,
          pts: [
            [x, 386],
            [x, 438],
          ],
        }),
    });
  }
  for (const foot of [FOOT_L, FOOT_R]) {
    const x = foot[0]?.[0] ?? 0;
    greenPart(v, {
      pts: foot,
      marks: () =>
        bristleStroke(v, {
          color: D,
          weight: 12,
          pts: [
            [x - 48, 450],
            [x - 22, 456],
            [x + 2, 450],
          ],
        }),
    });
  }

  // arms and hands (behind the body)
  greenPart(v, {
    pts: ARM_L,
    heavy: 0.3,
    marks: () =>
      bristleStroke(v, {
        color: D,
        weight: 9,
        pts: [
          [152, 304],
          [128, 338],
          [130, 374],
        ],
      }),
  });
  greenPart(v, {
    pts: HAND_L,
    marks: () =>
      bristleStroke(v, {
        color: D,
        weight: 12,
        pts: [
          [108, 382],
          [120, 394],
          [136, 388],
        ],
      }),
  });
  greenPart(v, {
    pts: ARM_R,
    heavy: 0.7,
    marks: () =>
      bristleStroke(v, {
        color: D,
        weight: 10,
        pts: [
          [250, 292],
          [298, 282],
          [328, 258],
        ],
      }),
  });
  greenPart(v, {
    pts: HAND_R,
    marks: () =>
      bristleStroke(v, {
        color: D,
        weight: 12,
        pts: [
          [316, 226],
          [328, 238],
          [346, 230],
        ],
      }),
  });

  // body
  greenPart(v, {
    pts: BODY,
    heavy: 0.6,
    marks: () => {
      bristleStroke(v, {
        color: D,
        weight: 30,
        pts: [
          [160, 258],
          [150, 320],
          [156, 396],
        ],
        opacity: 0.35,
      });
      bristleStroke(v, {
        color: D,
        weight: 14,
        pts: [
          [156, 264],
          [147, 324],
          [152, 392],
        ],
      });
      bristleStroke(v, {
        color: D,
        weight: 26,
        pts: [
          [150, 396],
          [200, 404],
          [252, 392],
        ],
        opacity: 0.4,
      });
      bristleStroke(v, {
        color: D,
        weight: 10,
        pts: [
          [244, 300],
          [252, 350],
          [246, 388],
        ],
        opacity: 0.45,
      });
      bristleStroke(v, {
        color: L,
        weight: 10,
        pts: [
          [226, 268],
          [236, 304],
          [238, 340],
        ],
        opacity: 0.5,
      });
    },
  });
  flatFill(v, { pts: BELLY, color: "#62ad56" });
  shade(v, {
    pts: BELLY,
    marks: () =>
      bristleStroke(v, {
        color: D,
        weight: 12,
        pts: [
          [176, 326],
          [180, 362],
          [202, 380],
        ],
      }),
  });

  // head
  greenPart(v, {
    pts: HEAD,
    marks: () => {
      bristleStroke(v, {
        color: D,
        weight: 40,
        pts: [
          [98, 150],
          [118, 226],
          [200, 268],
          [282, 230],
          [304, 160],
        ],
        opacity: 0.3,
      });
      bristleStroke(v, {
        color: D,
        weight: 20,
        pts: [
          [100, 160],
          [122, 226],
          [200, 262],
          [276, 236],
          [302, 176],
        ],
      });
      bristleStroke(v, {
        color: D,
        weight: 12,
        pts: [
          [104, 190],
          [140, 236],
          [190, 252],
        ],
      });
      bristleStroke(v, {
        color: L,
        weight: 22,
        pts: [
          [130, 120],
          [188, 100],
          [256, 110],
        ],
        opacity: 0.45,
      });
      bristleStroke(v, {
        color: L,
        weight: 10,
        pts: [
          [150, 110],
          [190, 100],
          [230, 104],
        ],
        opacity: 0.7,
      });
    },
  });

  // eyes
  for (const [eye, px] of [
    [EYE_L, 165],
    [EYE_R, 235],
  ] as const) {
    flatFill(v, { pts: eye, color: "#ffffff" });
    shade(v, {
      pts: eye,
      marks: () => {
        const pencil: Style = {
          stroke: "#9aa6b2",
          weight: 2.2,
          brush: "pencil",
          gesture: { pressure: 0.8 },
        };
        for (let i = 0; i < 9; i += 1)
          v.line(px - 34 + i * 4, 198, px - 18 + i * 4, 180, pencil);
      },
    });
    outline(v, { pts: eye, weight: 3 });
    v.circle(px, 172, 26, { fill: INK });
    v.circle(px + 6, 165, 8, { fill: "#ffffff" });
  }

  // cheeks: a soft pink oval with a few pencil marks over it
  for (const cx of [132, 268]) {
    v.group({ opacity: 0.8 }, () => {
      flatFill(v, {
        pts: ellipsePts({ cx, cy: 205, rx: 11, ry: 6.5, n: 8 }),
        color: "#f1a19c",
      });
      const pencil: Style = {
        stroke: "#e0736f",
        weight: 2,
        brush: "pencil",
        gesture: { pressure: 0.7 },
      };
      for (let i = 0; i < 4; i += 1)
        v.line(cx - 8 + i * 4, 210, cx - 3 + i * 4, 200, pencil);
    });
  }

  // smile
  outline(v, {
    pts: [
      [179, 211],
      [188, 218],
      [200, 221],
      [212, 218],
      [221, 211],
    ],
    weight: 3.6,
    closed: false,
  });
}
