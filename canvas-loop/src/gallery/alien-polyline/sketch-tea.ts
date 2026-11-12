// Friendly green alien, picture-book style. Every outline is a straight-segment
// polyline (polygon for closed shapes, move/line paths for open ones); the
// smoothness comes from sampling ellipses and Catmull-Rom splines into dense
// point lists here, in the sketch. Shading uses pencil and bristle marks clipped
// to the shapes.
import type { PathCommand, Style, Vec2, View } from "@ianbicking/canvas-loop";

const INK = "#1f2a1c";
const GREEN = "#78c96a";
const GREEN_DARK = "#3f8538";
const GREEN_LIGHT = "#a6e08f";
const BELLY = "#5fae52";
const PAPER = "#f4f0e6";
const YELLOW = "#f3d54b";
const PINK = "#ec8f8a";

// ── geometry helpers (all produce straight-segment point lists) ──────────
/** An ellipse as a polygon, about one vertex per 3px of perimeter. */
function oval(c: Vec2, r: Vec2): Vec2[] {
  const [cx, cy] = c;
  const [rx, ry] = r;
  const n = Math.max(24, Math.round((Math.PI * (rx + ry)) / 3));
  const pts: Vec2[] = [];
  for (let i = 0; i < n; i += 1) {
    const a = Math.PI / 2 + (i / n) * Math.PI * 2;
    pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return pts;
}

function at(pts: readonly Vec2[], i: number): Vec2 {
  const n = pts.length;
  const p = pts[((i % n) + n) % n];
  return p ?? [0, 0];
}

const PER_SEGMENT = 12;

function catmull(
  q: readonly [number, number, number, number],
  t: number,
): number {
  const [a, b, c, d] = q;
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * b +
      (-a + c) * t +
      (2 * a - 5 * b + 4 * c - d) * t2 +
      (-a + 3 * b - 3 * c + d) * t3)
  );
}

/** Sample a Catmull-Rom spline through `ctrl` into a dense polyline. */
function spline(ctrl: readonly Vec2[], closed: boolean): Vec2[] {
  const per = PER_SEGMENT;
  const out: Vec2[] = [];
  const n = ctrl.length;
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i += 1) {
    const p0 = closed || i > 0 ? at(ctrl, i - 1) : at(ctrl, 0);
    const p1 = at(ctrl, i);
    const p2 = at(ctrl, i + 1);
    const p3 = closed || i + 2 < n ? at(ctrl, i + 2) : at(ctrl, n - 1);
    for (let k = 0; k < per; k += 1) {
      const t = k / per;
      out.push([
        catmull([p0[0], p1[0], p2[0], p3[0]], t),
        catmull([p0[1], p1[1], p2[1], p3[1]], t),
      ]);
    }
  }
  if (!closed) out.push(at(ctrl, n - 1));
  return out;
}

/** A closed outline around a centerline, width tapering from w0 to w1. */
function tube(center: readonly Vec2[], widths: Vec2): Vec2[] {
  const [w0, w1] = widths;
  const left: Vec2[] = [];
  const right: Vec2[] = [];
  const n = center.length;
  for (let i = 0; i < n; i += 1) {
    const a = at(center, Math.max(0, i - 1));
    const b = at(center, Math.min(n - 1, i + 1));
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const w = (w0 + (w1 - w0) * (i / (n - 1))) / 2;
    const p = at(center, i);
    left.push([p[0] + nx * w, p[1] + ny * w]);
    right.push([p[0] - nx * w, p[1] - ny * w]);
  }
  return [...left, ...right.toReversed()];
}

function openPath(pts: readonly Vec2[]): PathCommand[] {
  return pts.map(
    (p, i): PathCommand =>
      i === 0 ? ["move", p[0], p[1]] : ["line", p[0], p[1]],
  );
}

// ── shapes ───────────────────────────────────────────────────────────────
const HEAD = oval([200, 175], [105, 85]);
const EYE_L = oval([160, 164], [26, 31]);
const EYE_R = oval([240, 164], [26, 31]);
const BODY = spline(
  [
    [158, 252],
    [200, 246],
    [242, 252],
    [254, 300],
    [258, 360],
    [250, 390],
    [200, 398],
    [150, 390],
    [142, 360],
    [146, 300],
  ],
  true,
);
const BELLY_SHAPE = oval([200, 345], [30, 35]);
const ARM_L_CENTER = spline(
  [
    [168, 290],
    [146, 300],
    [130, 322],
    [122, 350],
    [122, 378],
  ],
  false,
);
const ARM_L = tube(ARM_L_CENTER, [22, 18]);
const ARM_R_CENTER = spline(
  [
    [228, 284],
    [252, 280],
    [285, 272],
    [315, 252],
    [330, 224],
  ],
  false,
);
const ARM_R = tube(ARM_R_CENTER, [24, 18]);
const HAND_L = oval([122, 380], [13, 13]);
const HAND_R = oval([330, 222], [14, 14]);
const LEG_L: Vec2[] = [
  [166, 385],
  [190, 385],
  [190, 440],
  [166, 440],
];
const LEG_R: Vec2[] = [
  [210, 385],
  [234, 385],
  [234, 440],
  [210, 440],
];
const FOOT_L = oval([172, 443], [24, 11]);
const FOOT_R = oval([228, 443], [24, 11]);
const ANT_L = spline(
  [
    [168, 96],
    [156, 70],
    [140, 42],
  ],
  false,
);
const ANT_R = spline(
  [
    [232, 96],
    [246, 66],
    [261, 36],
  ],
  false,
);
const BALL_L = oval([140, 40], [11, 11]);
const BALL_R = oval([261, 34], [11, 11]);
const SMILE = spline(
  [
    [179, 213],
    [190, 222],
    [200, 224],
    [210, 222],
    [221, 213],
  ],
  false,
);

// ── drawing ──────────────────────────────────────────────────────────────
interface Part {
  pts: readonly Vec2[];
  fill: string;
  weight?: number;
  shade?: () => void;
}

const OUTLINE: Style = {
  stroke: INK,
  brush: "ink",
  gesture: { pressure: "even", wobble: 0.6 },
};

/** Flat fill, then shading clipped inside, then the ink outline on top. */
function part(v: View, o: Part): void {
  v.polygon(o.pts, { fill: o.fill });
  const shade = o.shade;
  if (shade !== undefined) v.clip(o.pts, shade);
  v.polygon(o.pts, { ...OUTLINE, weight: o.weight ?? 3.2 });
}

interface Arc {
  c: Vec2;
  r: Vec2;
  /** start and end angle, radians (0 = right, pi/2 = down) */
  a: Vec2;
}

/** Points along part of an ellipse. */
function arcPts(o: Arc): Vec2[] {
  const pts: Vec2[] = [];
  const steps = 24;
  for (let i = 0; i <= steps; i += 1) {
    const t = o.a[0] + ((o.a[1] - o.a[0]) * i) / steps;
    pts.push([o.c[0] + Math.cos(t) * o.r[0], o.c[1] + Math.sin(t) * o.r[1]]);
  }
  return pts;
}

/** Concentric arc strokes stepping inward from the rim: form-following shading. */
function rimShade(
  v: View,
  o: Arc & { count: number; inset: number; style: Style },
): void {
  for (let i = 0; i < o.count; i += 1) {
    const d = o.inset * (i + 0.5);
    const shrink = 1 - i / (o.count * 2.5);
    const span = (o.a[1] - o.a[0]) * shrink;
    const mid = (o.a[0] + o.a[1]) / 2;
    v.path(
      openPath(
        arcPts({
          c: o.c,
          r: [o.r[0] - d, o.r[1] - d],
          a: [mid - span / 2, mid + span / 2],
        }),
      ),
      o.style,
    );
  }
}

/** A stroke along a centerline, shifted sideways by `offset`. */
function offsetLine(center: readonly Vec2[], offset: number): Vec2[] {
  const n = center.length;
  return center.map((p, i): Vec2 => {
    const a = at(center, Math.max(0, i - 1));
    const b = at(center, Math.min(n - 1, i + 1));
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [
      p[0] - ((b[1] - a[1]) / len) * offset,
      p[1] + ((b[0] - a[0]) / len) * offset,
    ];
  });
}

function darkBristle(weight: number): Style {
  return {
    stroke: GREEN_DARK,
    weight,
    brush: { preset: "bristle", opacity: 0.75, load: 1.5 },
    gesture: { pressure: "swell", wobble: 1 },
  };
}

function lightBristle(weight: number): Style {
  return {
    stroke: GREEN_LIGHT,
    weight,
    brush: { preset: "bristle", opacity: 0.7 },
    gesture: { pressure: "taper", wobble: 1 },
  };
}

function drawLimbs(v: View): void {
  // legs and feet
  for (const leg of [LEG_L, LEG_R]) {
    const x = at(leg, 1)[0];
    part(v, {
      pts: leg,
      fill: GREEN,
      shade: () => {
        v.line(x - 6, 386, x - 6, 440, darkBristle(10));
      },
    });
  }
  for (const [foot, c] of [
    [FOOT_L, [172, 443]],
    [FOOT_R, [228, 443]],
  ] as const) {
    part(v, {
      pts: foot,
      fill: GREEN,
      shade: () => {
        v.path(
          openPath(arcPts({ c, r: [21, 8], a: [0.2, 2.9] })),
          darkBristle(7),
        );
      },
    });
  }

  // arms behind the body
  part(v, {
    pts: ARM_L,
    fill: GREEN,
    shade: () => {
      v.path(openPath(offsetLine(ARM_L_CENTER, -4)), darkBristle(11));
    },
  });
  part(v, {
    pts: ARM_R,
    fill: GREEN,
    shade: () => {
      v.path(openPath(offsetLine(ARM_R_CENTER, 5)), darkBristle(11));
    },
  });
  for (const [hand, c] of [
    [HAND_L, [122, 380]],
    [HAND_R, [330, 222]],
  ] as const) {
    part(v, {
      pts: hand,
      fill: GREEN,
      shade: () => {
        v.path(
          openPath(arcPts({ c, r: [8, 8], a: [-0.3, 2.3] })),
          darkBristle(8),
        );
      },
    });
  }
}

function drawAntennae(v: View): void {
  // antennae (behind the head)
  const stalk: Style = {
    stroke: INK,
    weight: 4,
    brush: "ink",
    gesture: { pressure: "taper-out", wobble: 0.5 },
  };
  v.path(openPath(ANT_L), stalk);
  v.path(openPath(ANT_R), stalk);
  for (const [ball, c] of [
    [BALL_L, [140, 40]],
    [BALL_R, [261, 34]],
  ] as const) {
    part(v, {
      pts: ball,
      fill: YELLOW,
      weight: 3,
      shade: () => {
        v.path(openPath(arcPts({ c, r: [8, 8], a: [-0.2, 2.4] })), {
          stroke: "#c78a1a",
          weight: 5,
          brush: { preset: "bristle", opacity: 0.8 },
          gesture: { pressure: "taper" },
        });
        v.circle(c[0] - 3, c[1] - 3, 6, { fill: "#fffbe6" });
      },
    });
  }
}

export const canvas = { width: 400, height: 500 };

export type Model = Record<string, never>;

export function init(): Model {
  return {};
}

export function update(model: Model): Model {
  return model;
}

export function draw(v: View): void {
  v.background(PAPER);

  // ground shadow: a pale flat oval with pencil scribbles, darker near the feet
  v.polygon(oval([200, 450], [96, 14]), { fill: "#ddd6c3" });
  const scribble: Style = {
    stroke: "#a9a08a",
    weight: 3,
    brush: { preset: "pencil", opacity: 0.7 },
    gesture: { pressure: "taper", wobble: 1.2 },
  };
  for (let i = 0; i < 7; i += 1) {
    const y = 440 + i * 3;
    const half = 80 - Math.abs(i - 3) * 14;
    v.line(200 - half, y, 200 + half, y + 1, scribble);
  }

  drawAntennae(v);
  drawLimbs(v);

  // body
  part(v, {
    pts: BODY,
    fill: GREEN,
    shade: () => {
      const dark = darkBristle(10);
      v.line(248, 262, 252, 394, dark);
      v.line(240, 266, 244, 394, dark);
      v.path(
        openPath(
          spline(
            [
              [150, 262],
              [200, 272],
              [250, 262],
            ],
            false,
          ),
        ),
        dark,
      );
      v.path(
        openPath(
          spline(
            [
              [152, 388],
              [200, 394],
              [248, 388],
            ],
            false,
          ),
        ),
        dark,
      );
      // pencil texture following the body's right curve
      const pencil: Style = {
        stroke: GREEN_DARK,
        weight: 2,
        brush: { preset: "pencil", opacity: 0.6 },
        gesture: { pressure: "taper", wobble: 0.8 },
      };
      for (let i = 0; i < 6; i += 1) {
        const x = 214 + i * 5;
        v.path(
          openPath(
            spline(
              [
                [x - 4, 268],
                [x + 2, 320],
                [x + 1, 390],
              ],
              false,
            ),
          ),
          pencil,
        );
      }
      v.path(
        openPath(
          spline(
            [
              [162, 272],
              [156, 320],
              [157, 372],
            ],
            false,
          ),
        ),
        lightBristle(9),
      );
      v.polygon(BELLY_SHAPE, { fill: BELLY });
      v.path(
        openPath(arcPts({ c: [200, 345], r: [26, 31], a: [-0.6, 2.2] })),
        darkBristle(6),
      );
    },
  });

  // head
  part(v, {
    pts: HEAD,
    fill: GREEN,
    weight: 3.5,
    shade: () => {
      rimShade(v, {
        c: [200, 175],
        r: [105, 85],
        a: [-0.5, 2.6],
        count: 3,
        inset: 7,
        style: darkBristle(9),
      });
      rimShade(v, {
        c: [200, 175],
        r: [105, 85],
        a: [-0.2, 2.2],
        count: 5,
        inset: 6,
        style: {
          stroke: GREEN_DARK,
          weight: 2.5,
          brush: { preset: "pencil", opacity: 0.8 },
          gesture: { pressure: "taper", wobble: 1 },
        },
      });
      v.path(
        openPath(arcPts({ c: [200, 175], r: [88, 68], a: [3.6, 4.6] })),
        lightBristle(14),
      );
    },
  });

  // eyes
  for (const [eye, pupil] of [
    [EYE_L, [165, 172]],
    [EYE_R, [235, 172]],
  ] as const) {
    const [px, py] = pupil;
    part(v, {
      pts: eye,
      fill: "#ffffff",
      weight: 3,
      shade: () => {
        v.path(
          openPath(arcPts({ c: [px - 5, py - 8], r: [21, 26], a: [3.5, 5.9] })),
          {
            stroke: "#c9d2d6",
            weight: 5,
            brush: { preset: "pencil", opacity: 0.8 },
            gesture: { pressure: "taper" },
          },
        );
        v.circle(px, py, 24, { fill: INK });
        v.circle(px + 6, py - 6, 8, { fill: "#ffffff" });
      },
    });
  }

  // cheeks: flat blush with a pencil scribble over it
  for (const cx of [132, 268]) {
    v.polygon(oval([cx, 205], [11, 5.5]), { fill: PINK });
    const blush: Style = {
      stroke: "#d9625d",
      weight: 2,
      brush: { preset: "pencil", opacity: 0.9 },
      gesture: { pressure: "taper", wobble: 0.4 },
    };
    v.line(cx - 8, 203, cx + 6, 201, blush);
    v.line(cx - 6, 207, cx + 8, 205, blush);
  }

  // smile
  v.path(openPath(SMILE), {
    stroke: INK,
    weight: 3.5,
    brush: "ink",
    gesture: { pressure: "taper", wobble: 0.3 },
  });
}
