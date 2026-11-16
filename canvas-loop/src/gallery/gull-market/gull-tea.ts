// The hero: a herring gull flapping away to the left with a mackerel in its
// beak, one eye half-lidded and glancing back at the fishmonger.
import type { Style, Vec2, View } from "@ianbicking/canvas-loop";
import { fish } from "./fish-tea.js";
import { form, INK, mark, ring } from "./kit-tea.js";

export const GULL_AT: Vec2 = [300, 268];
const WHITE = "#fbfbf7";
const WHITE_SHADE = "#c8d2da";
const GREY = "#b4c2cc";
const GREY_SHADE = "#7f909d";
const BEAK = "#f4c430";

export function gull(v: View): void {
  v.at({ translate: [GULL_AT[0], GULL_AT[1]], rotate: -0.12 }, () => {
    paintGull(v);
  });
}

function wing(v: View, pts: readonly Vec2[], tip: Vec2, seed: number): void {
  form(v, pts, {
    base: GREY,
    shade: GREY_SHADE,
    light: "#dbe4ea",
    depth: 14,
    weight: 2.8,
    seed,
  });
  v.clip(v.curvePath(pts, true), () => {
    // black primaries at the tip, with the white "mirror" spots
    v.ellipse(tip[0], tip[1], 35, 42, { fill: "#23252b" });
    v.circle(tip[0] + 2, tip[1] + 2, 5, { fill: WHITE });
    v.circle(tip[0] - 12, tip[1] + 14, 4, { fill: WHITE });
  });
  // feather texture: bristle strokes from the shoulder out toward the tip
  v.clip(v.curvePath(pts, true), () => {
    const [b0, b1] = [pts[0], pts.at(-1)];
    if (b0 === undefined || b1 === undefined) return;
    for (let i = 0; i < 5; i += 1) {
      const t = i / 4;
      const base: Vec2 = [
        b0[0] + (b1[0] - b0[0]) * t,
        b0[1] + (b1[1] - b0[1]) * t,
      ];
      mark(
        v,
        [
          base,
          [base[0] * 0.5 + tip[0] * 0.5, base[1] * 0.5 + tip[1] * 0.5 + 10],
          [tip[0] - 4 + i * 2, tip[1] + 30],
        ],
        {
          color: i % 2 === 0 ? "#9aabb7" : "#d0dae1",
          weight: 14,
          brush: "bristle",
          opacity: 0.7,
          wobble: 1.5,
          seed: seed + 50 + i,
        },
      );
    }
  });
}

function paintGull(v: View): void {
  // far wing, raised up and back behind the body
  wing(
    v,
    [
      [-26, -18],
      [-16, -62],
      [0, -106],
      [40, -144],
      [100, -164],
      [88, -146],
      [74, -122],
      [56, -84],
      [42, -44],
      [40, -16],
    ],
    [94, -156],
    2001,
  );
  // tail
  form(
    v,
    [
      [86, -10],
      [142, -18],
      [150, 2],
      [140, 16],
      [88, 16],
    ],
    { base: WHITE, shade: WHITE_SHADE, depth: 6, weight: 2.4, seed: 2002 },
  );
  // tucked feet
  for (const [i, dy] of [0, 10].entries()) {
    mark(
      v,
      [
        [50, 18 + dy],
        [72, 30 + dy],
      ],
      { color: "#e0703f", weight: 4, pressure: "even", seed: 2006 + i },
    );
    form(
      v,
      [
        [70, 26 + dy],
        [92, 26 + dy],
        [88, 40 + dy],
      ],
      {
        base: "#f08a5d",
        shade: "#c0603c",
        depth: 2,
        sharp: true,
        weight: 1.6,
        seed: 2003 + i,
      },
    );
  }
  // body
  const body: Vec2[] = [
    [-74, -8],
    [-44, -28],
    [8, -30],
    [60, -18],
    [104, -6],
    [100, 10],
    [52, 24],
    [0, 30],
    [-48, 22],
  ];
  form(v, body, {
    base: WHITE,
    shade: WHITE_SHADE,
    depth: 9,
    weight: 3.4,
    seed: 2004,
  });
  // grey mantle across the back, under where the wings join
  v.clip(v.curvePath(body, true), () => {
    mark(
      v,
      [
        [-40, -32],
        [10, -32],
        [70, -20],
        [108, -10],
      ],
      {
        color: GREY,
        weight: 22,
        brush: "wash",
        opacity: 0.9,
        pressure: "even",
        seed: 2005,
      },
    );
  });
  // the stolen fish, nose clamped in the beak, tail flapping below
  fish(v, {
    at: [-126, 30],
    len: 96,
    angle: 1.32,
    body: "#4d7f8f",
    belly: "#dfe9ea",
    stripes: "#203a46",
    curl: 1.1,
    seed: 2010,
  });
  head(v);
  // near wing, swept up and forward, in front of the body
  wing(
    v,
    [
      [-44, -12],
      [-62, -60],
      [-76, -112],
      [-56, -162],
      [-4, -210],
      [-10, -190],
      [-4, -158],
      [6, -112],
      [18, -64],
      [30, -12],
    ],
    [-10, -200],
    2020,
  );
  // feather fingers along the near wing's trailing edge
  for (let i = 0; i < 6; i += 1) {
    const t = i / 5;
    const x = -6 + t * 26;
    const y = -176 + t * 136;
    mark(
      v,
      [
        [x - 16, y - 6],
        [x - 2, y + 2],
        [x + 2, y + 10],
      ],
      { color: "#5d6a74", weight: 2, seed: 2030 + i },
    );
  }
  // covert feathers: a row of small scallops across the near wing
  for (let i = 0; i < 4; i += 1) {
    const y = -64 - i * 16;
    mark(
      v,
      [
        [-56 + i * 4, y],
        [-36 + i * 4, y + 6],
        [-16 + i * 4, y + 2],
      ],
      { color: GREY_SHADE, weight: 2.2, seed: 2040 + i },
    );
  }
}

function head(v: View): void {
  const hx = -86;
  const hy = -30;
  form(v, ring(hx, hy, 30, 26, 18), {
    base: WHITE,
    shade: WHITE_SHADE,
    light: "#ffffff",
    depth: 10,
    weight: 3,
    seed: 2040,
  });
  // beak with its hooked tip and red spot
  const beak: Vec2[] = [
    [-110, -36],
    [-156, -28],
    [-164, -18],
    [-154, -12],
    [-110, -18],
  ];
  form(v, beak, {
    base: BEAK,
    shade: "#c8901c",
    depth: 4,
    sharp: true,
    weight: 2.4,
    seed: 2041,
  });
  v.circle(-146, -17, 3.5, { fill: "#e0402e" });
  mark(
    v,
    [
      [-112, -24],
      [-140, -22],
      [-156, -20],
    ],
    { color: INK, weight: 1.6, seed: 2042 },
  );
  // eye: yellow iris, pupil glancing back, half lid and a cocky brow
  // (the stroke of the mark just above carries over onto these four circles)
  const eyeEdge: Style = { stroke: INK, weight: 1.6 };
  v.circle(hx - 8, hy - 6, 8.5, { ...eyeEdge, fill: "#e0402e" });
  v.circle(hx - 8, hy - 6, 6.5, { ...eyeEdge, fill: "#f7e05a" });
  v.circle(hx - 4, hy - 5, 3, { ...eyeEdge, fill: INK });
  v.circle(hx - 3, hy - 7, 1, { ...eyeEdge, fill: WHITE });
  v.clip(ring(hx - 8, hy - 6, 9, 9), () => {
    v.rect(hx - 20, hy - 20, 24, 12, { fill: "#d7dde2" });
  });
  mark(
    v,
    [
      [hx - 22, hy - 12],
      [hx - 8, hy - 15],
      [hx + 6, hy - 22],
    ],
    { color: INK, weight: 3.4, pressure: "taper-in", seed: 2043 },
  );
  // smug corner of the mouth
  mark(
    v,
    [
      [-112, -18],
      [-104, -22],
    ],
    { color: INK, weight: 2, seed: 2044 },
  );
}
