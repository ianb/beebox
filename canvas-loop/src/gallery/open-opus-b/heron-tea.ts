// Old Pell the heron, in a red knitted scarf, reaching the lighting pole up to
// the last lamp. Local coordinates: origin between the feet, facing +x.
import type { Style, Vec2, View } from "@ianbicking/canvas-loop";

import { deckFront, deckTop, LAMP } from "./pier-tea.js";

const FEET_X = 560;
const FEET_Y = (deckTop(FEET_X) + deckFront(FEET_X)) / 2 - 2;
const SCALE = 1.2;

const H = {
  body: "#8593ae",
  bodyShade: "#4e587a",
  belly: "#d3d8e2",
  wing: "#5b6788",
  wingDark: "#363e5e",
  rim: "#ffc98c",
  ink: "#1d1c2c",
  leg: "#c99e55",
  bill: "#e3ad45",
  scarf: "#c63a36",
  scarfDark: "#7e1f2c",
  pole: "#4a2f24",
} as const;

const BODY: readonly Vec2[] = [
  [52, -150],
  [48, -110],
  [22, -84],
  [-28, -78],
  [-84, -66],
  [-68, -116],
  [-30, -158],
  [16, -172],
];

const WING: readonly Vec2[] = [
  [30, -148],
  [32, -114],
  [6, -92],
  [-60, -76],
  [-104, -62],
  [-64, -104],
  [-18, -150],
];

const NECK: readonly Vec2[] = [
  [30, -164],
  [48, -190],
  [32, -212],
  [34, -228],
  [42, -234],
];

const HEAD = { x: 48, y: -236 } as const;
const GRIP: Vec2 = [50, -116];

type Tint = (pts: readonly Vec2[]) => void;

/** Fill a shape, then inside it a warm rim on the lamp side and a cool shade on the far side. */
function litShape(
  v: View,
  pts: readonly Vec2[],
  base: string,
  extra?: Tint,
): void {
  v.curve(pts, true, { fill: H.rim });
  v.clip(v.curvePath(pts, true), () => {
    v.curve(
      v.offset(pts, -1).map(([x, y]): Vec2 => [x - 4, y + 2.5]),
      true,
      { fill: base },
    );
    v.group({ opacity: 0.35 }, () => {
      v.curve(
        v.offset(pts, -2).map(([x, y]): Vec2 => [x - 26, y + 22]),
        true,
        { fill: H.bodyShade },
      );
    });
    if (extra) extra(pts);
  });
}

export function drawHeron(v: View): void {
  drawShadow(v);
  v.at({ translate: [FEET_X, FEET_Y], scale: SCALE }, () => {
    drawLegs(v);
    drawPole(v);
    drawBody(v);
    drawNeckAndHead(v);
    drawScarf(v);
    drawGrip(v);
  });
}

function drawLegs(v: View): void {
  const leg: Style = {
    stroke: H.leg,
    weight: 4.5,
    brush: "ink",
    gesture: { pressure: "even", wobble: 0.3 },
  };
  const legs: Vec2[][] = [
    [
      [-8, -84],
      [-4, -40],
      [-10, 0],
    ],
    [
      [8, -84],
      [18, -44],
      [14, -2],
    ],
  ];
  for (const l of legs) v.curve(l, false, leg);
  // Shade on the back edge of each leg, warm light on the lamp side.
  for (const l of legs)
    v.curve(
      l.map(([x, y]): Vec2 => [x - 1.6, y]),
      false,
      { ...leg, stroke: "#6e4e30", weight: 1.6 },
    );
  for (const l of legs)
    v.curve(
      l.map(([x, y]): Vec2 => [x + 1.5, y]),
      false,
      { ...leg, stroke: "#ffe0a0", weight: 1.1 },
    );
  const toe: Style = {
    stroke: H.leg,
    weight: 2.5,
    brush: "ink",
    gesture: { pressure: "taper-out" },
  };
  for (const [fx, fy] of [
    [-10, 0],
    [14, -2],
  ] as const) {
    v.line(fx, fy, fx + 16, fy + 3, toe);
    v.line(fx, fy, fx - 12, fy + 2, toe);
    v.line(fx, fy, fx + 6, fy + 6, toe);
  }
}

function drawBody(v: View): void {
  litShape(v, BODY, H.body, () => {
    // Brushed feather tone following the body's curve.
    const feather: Style = {
      weight: 10,
      brush: {
        preset: "bristle",
        bristles: 10,
        load: 0.9,
        flow: 0.45,
        spread: 0.6,
      },
      gesture: { pressure: "taper", wobble: 1.5 },
    };
    for (let i = 0; i < 7; i += 1) {
      v.curve(
        [
          [40 - i * 4, -160 + i * 3],
          [10 - i * 6, -150 + i * 9],
          [-40 - i * 4, -110 + i * 6],
          [-80, -72 + i],
        ],
        false,
        {
          ...feather,
          stroke: i % 2 === 0 ? "#a4afc6" : "#6f7c9c",
        },
      );
    }
    v.curve(
      [
        [52, -150],
        [44, -104],
        [26, -90],
        [30, -130],
        [40, -158],
      ],
      true,
      { fill: H.belly },
    );
    // Pencil hatching in the shadow under the belly.
    const hatch: Style = {
      stroke: "#434b6c",
      weight: 1.8,
      brush: { preset: "pencil", opacity: 0.85 },
      gesture: { pressure: "taper", wobble: 0.4 },
    };
    for (let x = -50; x < 40; x += 4) v.line(x, -78, x + 10, -100, hatch);
  });
  litShape(v, WING, H.wing, () => {
    // A dark band of flight feathers along the lower wing.
    v.curve(
      [
        [20, -100],
        [-30, -86],
        [-100, -64],
      ],
      false,
      {
        stroke: H.wingDark,
        weight: 22,
        brush: { preset: "wash", opacity: 0.8 },
        gesture: { pressure: "swell", wobble: 1 },
      },
    );
    // Feather edges inside the band.
    const edge: Style = {
      stroke: "#8e9abb",
      weight: 1.3,
      brush: "ink",
      gesture: { pressure: "taper", wobble: 0.4 },
    };
    for (let i = 0; i < 5; i += 1) {
      v.curve(
        [
          [8 - i * 9, -108 + i * 5],
          [-44 - i * 6, -88 + i * 4],
          [-98 + i * 3, -66 + i],
        ],
        false,
        edge,
      );
    }
    // Pale covert feathers in rows across the shoulder, back rows first.
    const seam: Style = {
      stroke: "#2e3552",
      weight: 1.6,
      brush: "ink",
      gesture: { pressure: "swell", wobble: 0.3 },
    };
    for (let row = 0; row < 3; row += 1) {
      for (let j = 0; j < 6 - row; j += 1) {
        const cx = 22 - j * 12 - row * 5;
        const cy = -142 + j * 7 + row * 12;
        const f: Vec2[] = [
          [cx - 8, cy - 8],
          [cx + 8, cy - 8],
          [cx + 7, cy + 3],
          [cx, cy + 9],
          [cx - 7, cy + 3],
        ];
        v.curve(f, true, {
          fill: row === 0 ? "#9aa6c2" : row === 1 ? "#8592b2" : "#7280a2",
        });
        v.curve(
          [
            [cx - 7, cy + 2],
            [cx, cy + 9],
            [cx + 7, cy + 2],
          ],
          false,
          seam,
        );
      }
    }
  });
  // Split primary tips at the wing's end.
  v.polygon(
    [
      [-80, -70],
      [-112, -58],
      [-86, -64],
      [-108, -50],
      [-80, -60],
      [-98, -44],
      [-70, -62],
    ],
    { fill: H.wingDark },
  );
  // Cool shadow over the lower body, away from the lamp.
  v.clip(v.curvePath(BODY, true), () => {
    v.curve(
      [
        [-90, -66],
        [-40, -76],
        [20, -80],
      ],
      false,
      {
        stroke: "#2c3150",
        weight: 26,
        brush: { preset: "wash", opacity: 0.45 },
        gesture: { pressure: "swell", wobble: 2 },
      },
    );
  });
  // Heavier line on the shadow side (front-lower edge round to the tail), thin toward the lamp.
  const outline: Style = {
    stroke: H.ink,
    weight: 3.6,
    brush: { preset: "ink", thinning: 0.8 },
    gesture: {
      pressure: [
        [0, 0.3],
        [0.2, 0.7],
        [0.45, 1],
        [0.62, 0.9],
        [0.8, 0.45],
        [1, 0.3],
      ],
      wobble: 0.6,
    },
  };
  v.curve(BODY, true, outline);
  v.curve(WING, true, outline);
}

function drawNeckAndHead(v: View): void {
  const neckProfile: [number, number][] = [
    [0, 1.4],
    [1, 0.8],
  ];
  const neck = v.tube(NECK, { width: 19, profile: neckProfile });
  v.path(neck, { fill: H.rim });
  v.clip(neck, () => {
    v.path(
      v.tube(
        NECK.map(([x, y]): Vec2 => [x - 3, y + 1]),
        { width: 19, profile: neckProfile },
      ),
      { fill: H.belly },
    );
    v.path(
      v.tube(
        NECK.map(([x, y]): Vec2 => [x - 13, y + 1]),
        { width: 19, profile: neckProfile },
      ),
      { fill: H.body },
    );
    // The dark dashed streak down the front of a heron's neck.
    const streak: Style = {
      stroke: "#2b2f48",
      weight: 2,
      brush: "ink",
      gesture: { pressure: "swell", wobble: 0.3 },
    };
    const front = NECK.map(([x, y]): Vec2 => [x + 3, y]);
    for (let i = 0; i < front.length - 1; i += 1) {
      const [ax, ay] = front[i] ?? [0, 0];
      const [bx, by] = front[i + 1] ?? [0, 0];
      v.line(
        ax + (bx - ax) * 0.2,
        ay + (by - ay) * 0.2,
        ax + (bx - ax) * 0.65,
        ay + (by - ay) * 0.65,
        streak,
      );
    }
  });
  // Head.
  const head: Vec2[] = [
    [HEAD.x + 18, HEAD.y - 1],
    [HEAD.x + 4, HEAD.y - 11],
    [HEAD.x - 14, HEAD.y - 6],
    [HEAD.x - 12, HEAD.y + 8],
    [HEAD.x + 8, HEAD.y + 10],
  ];
  litShape(v, head, H.body, () => {
    v.ellipse(HEAD.x + 6, HEAD.y + 6, 22, 9, { fill: H.belly });
  });
  // Bill.
  v.polygon(
    [
      [HEAD.x + 13, HEAD.y - 5],
      [HEAD.x + 46, HEAD.y + 7],
      [HEAD.x + 12, HEAD.y + 6],
    ],
    { fill: H.bill },
  );
  v.polygon(
    [
      [HEAD.x + 13, HEAD.y - 5],
      [HEAD.x + 46, HEAD.y + 7],
      [HEAD.x + 13, HEAD.y + 1],
    ],
    { fill: "#f6d27e" },
  );
  // Black crest stripe and plume.
  const crest: Style = {
    stroke: H.ink,
    brush: "ink",
    gesture: { pressure: "taper-out", wobble: 0.5 },
  };
  v.curve(
    [
      [HEAD.x + 8, HEAD.y - 9],
      [HEAD.x - 10, HEAD.y - 9],
      [HEAD.x - 30, HEAD.y - 3],
      [HEAD.x - 46, HEAD.y + 8],
    ],
    false,
    { ...crest, weight: 5 },
  );
  v.curve(
    [
      [HEAD.x - 4, HEAD.y - 6],
      [HEAD.x - 22, HEAD.y + 2],
      [HEAD.x - 38, HEAD.y + 18],
    ],
    false,
    { ...crest, weight: 3 },
  );
  const fine: Style = {
    stroke: H.ink,
    brush: "ink",
    gesture: { pressure: "taper", wobble: 0.5 },
  };
  v.line(HEAD.x + 14, HEAD.y + 1, HEAD.x + 42, HEAD.y + 6, {
    ...fine,
    weight: 1.6,
  });
  v.curve(
    NECK.map(([x, y]): Vec2 => [x - 9, y]),
    false,
    { ...fine, weight: 2.2 },
  );
  v.curve(head, true, { ...fine, weight: 2.2 });
  // Eye.
  v.circle(HEAD.x + 6, HEAD.y - 2, 7, { fill: "#fff2c8" });
  v.circle(HEAD.x + 7, HEAD.y - 2, 3.5, { fill: H.ink });
}

function drawScarf(v: View): void {
  // One band: knot at the front of the neck, round the back, out into the wind.
  const band: Vec2[] = [
    [52, -160],
    [44, -174],
    [24, -176],
    [6, -168],
    [-14, -158],
    [-38, -170],
    [-66, -160],
  ];
  const shape = v.tube(band, {
    width: 14,
    profile: [
      [0, 1.2],
      [0.3, 1],
      [1, 0.85],
    ],
  });
  v.path(shape, { fill: H.scarf });
  v.clip(shape, () => {
    // Knit ribs, and a shadow along the lower edge.
    const rib: Style = {
      stroke: H.scarfDark,
      weight: 1.6,
      brush: { preset: "pencil", opacity: 0.9 },
      gesture: { pressure: "even", wobble: 0.3 },
    };
    for (let x = -74; x < 64; x += 4.5) v.line(x, -192, x - 3, -146, rib);
    v.curve(
      band.map(([x, y]): Vec2 => [x - 2, y + 7]),
      false,
      {
        ...rib,
        weight: 8,
        brush: { preset: "wash", opacity: 0.6 },
      },
    );
    v.curve(
      band.slice(0, 4).map(([x, y]): Vec2 => [x + 2, y - 5]),
      false,
      {
        ...rib,
        stroke: "#ff9a7a",
        weight: 5,
        brush: { preset: "wash", opacity: 0.5 },
      },
    );
  });
  // Fringe.
  const fringe: Style = {
    stroke: H.scarf,
    weight: 2.4,
    brush: "ink",
    gesture: { pressure: "taper-out", wobble: 0.6 },
  };
  for (let i = 0; i < 4; i += 1)
    v.line(-64, -166 + i * 4, -78, -164 + i * 6, fringe);
  v.path(shape, {
    stroke: H.ink,
    weight: 1.8,
    brush: "ink",
    gesture: { pressure: "taper", wobble: 0.5 },
  });
}

function tip(): Vec2 {
  return [(LAMP.hx - 2 - FEET_X) / SCALE, (LAMP.hy + 48 - FEET_Y) / SCALE];
}

function drawPole(v: View): void {
  const [tx, ty] = tip();
  const dx = tx - GRIP[0];
  const dy = ty - GRIP[1];
  const back: Vec2 = [GRIP[0] - dx * 0.45, GRIP[1] - dy * 0.45];
  v.line(back[0], back[1], tx, ty, {
    stroke: H.pole,
    weight: 3.6,
    brush: "ink",
    gesture: { pressure: "even", wobble: 0.4 },
  });
  // Taper flame.
  v.circle(tx, ty - 4, 36, {
    fill: v.radialGradient(tx, ty - 4, 18, [
      [0, "rgba(255,240,180,0.95)"],
      [1, "rgba(255,160,80,0)"],
    ]),
  });
  v.ellipse(tx, ty - 6, 5, 11, { fill: "#fff3c0" });
}

function drawGrip(v: View): void {
  // Three primary feathers curled round the pole, like fingers.
  const [gx, gy] = GRIP;
  const feathers: Vec2[][] = [
    [
      [gx - 30, gy - 6],
      [gx - 8, gy - 12],
      [gx + 8, gy - 8],
      [gx + 6, gy - 2],
      [gx - 10, gy - 3],
    ],
    [
      [gx - 30, gy - 1],
      [gx - 6, gy - 4],
      [gx + 10, gy + 1],
      [gx + 6, gy + 6],
      [gx - 12, gy + 4],
    ],
    [
      [gx - 28, gy + 4],
      [gx - 8, gy + 4],
      [gx + 6, gy + 10],
      [gx + 1, gy + 14],
      [gx - 14, gy + 10],
    ],
  ];
  for (const f of feathers) {
    litShape(v, f, H.wing);
    v.curve(f, true, {
      stroke: H.ink,
      weight: 1.8,
      brush: "ink",
      gesture: { pressure: "taper", wobble: 0.3 },
    });
  }
}

/** Cast shadow on the deck, thrown back and left by the lamp, and a contact shadow under the feet. */
function drawShadow(v: View): void {
  const deck: Vec2[] = [
    [180, deckTop(180)],
    [740, deckTop(740)],
    [740, deckFront(740)],
    [180, deckFront(180)],
  ];
  v.clip(deck, () => {
    v.group({ opacity: 0.85, blend: "multiply" }, () => {
      v.ellipse(FEET_X - 80, FEET_Y - 5, 210, 24, {
        fill: v.ellipseGradient(FEET_X - 80, FEET_Y - 5, 210, 24, [
          [0, "#5a3a58"],
          [0.55, "rgba(90,58,88,0.7)"],
          [1, "rgba(90,58,88,0)"],
        ]),
      });
      v.ellipse(FEET_X + 2, FEET_Y + 2, 54, 10, {
        fill: v.ellipseGradient(FEET_X + 2, FEET_Y + 2, 54, 10, [
          [0, "#3a2236"],
          [1, "rgba(58,34,54,0)"],
        ]),
      });
    });
  });
}
