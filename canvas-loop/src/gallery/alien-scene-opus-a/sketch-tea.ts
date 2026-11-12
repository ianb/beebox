import type {
  DeepReadonly,
  Gesture,
  Style,
  Util,
  Vec2,
  View,
} from "@ianbicking/canvas-loop";
import {
  ALIEN_LINE,
  AX,
  ellipsePts,
  GREEN,
  type Pts,
  tube,
  W,
  H,
} from "./common-tea.js";
import {
  fireflies,
  grass,
  hatch,
  hatchBloom,
  land,
  makeScene,
  paperTone,
  type Scene,
  ship,
  sky,
} from "./scene-tea.js";

// Picture-book page: a little green alien has just landed in a meadow at dusk.
// The saucer's hatch is open and spilling warm light; the alien waves at us,
// holding a flower it has just picked. (Background lives in scene.ts.)

// ── the alien ───────────────────────────────────────────────────────
const HEAD = ellipsePts(AX, 250, 100, 78, 14);
const BODY: Pts = [
  [AX, 318],
  [AX + 34, 326],
  [AX + 52, 372],
  [AX + 62, 430],
  [AX + 56, 470],
  [AX + 30, 484],
  [AX, 486],
  [AX - 30, 484],
  [AX - 56, 470],
  [AX - 62, 430],
  [AX - 52, 372],
  [AX - 34, 326],
];
const BELLY = ellipsePts(AX + 4, 428, 28, 36, 10);
const ARM_DOWN = tube(
  [
    [AX - 46, 360],
    [AX - 72, 392],
    [AX - 80, 432],
  ],
  24,
  20,
);
const HAND_DOWN: Vec2 = [AX - 80, 440];
const ARM_UP = tube(
  [
    [AX + 48, 366],
    [AX + 100, 352],
    [AX + 132, 312],
    [AX + 140, 276],
  ],
  24,
  20,
);
const HAND_UP: Vec2 = [AX + 142, 266];
const LEG_L = tube(
  [
    [AX - 22, 476],
    [AX - 24, 514],
  ],
  22,
  22,
);
const LEG_R = tube(
  [
    [AX + 24, 476],
    [AX + 26, 514],
  ],
  22,
  22,
);
const FOOT_L = ellipsePts(AX - 30, 520, 26, 10, 10);
const FOOT_R = ellipsePts(AX + 32, 520, 26, 10, 10);
const ANT_L: Pts = [
  [AX - 34, 180],
  [AX - 48, 140],
  [AX - 66, 106],
];
const ANT_R: Pts = [
  [AX + 34, 180],
  [AX + 52, 138],
  [AX + 70, 104],
];
const EYE_L = { x: AX - 36, y: 244 };
const EYE_R = { x: AX + 36, y: 244 };

export const canvas = { width: W, height: H };

export interface Model {
  readonly scene: Scene;
}

export function init(u: Util): Model {
  return { scene: makeScene(u) };
}

export function update(model: DeepReadonly<Model>): Model {
  return model;
}

/** The pen the outlines use; later shading inside clips inherits nothing from it. */
const OUTLINE_GESTURE: Gesture = {
  // heavier along the bottom-left (shadow side), light along the top
  pressure: [
    [0, 0.7],
    [0.25, 1],
    [0.5, 0.95],
    [0.75, 0.5],
    [1, 0.7],
  ],
  wobble: 0.5,
};

function shape(
  v: View,
  pts: Pts,
  fillColor: string,
  shade: () => void,
  weight = 3.2,
  rim = true,
): void {
  v.curve(pts, true, { fill: fillColor });
  v.clip(v.curvePath(pts, true), () => {
    shade();
    if (rim) {
      // warm rim light: the same outline shifted left, so its band falls just
      // inside the right-hand edge (the side facing the hatch)
      v.at({ translate: [-5, 2] }, () => {
        v.curve(pts, true, {
          stroke: "#fff0a8",
          weight: 11,
          brush: { preset: "airbrush", opacity: 1 },
          gesture: { pressure: "even" },
        });
      });
    }
  });
  v.curve(pts, true, {
    stroke: ALIEN_LINE,
    weight,
    brush: { preset: "ink", thinning: 0.75 },
    gesture: OUTLINE_GESTURE,
  });
}

/**
 * Form shadow for a part: its own outline shifted up-right, so a crescent of
 * violet falls inside the bottom-left edge (away from the hatch light), plus
 * pencil contour lines along the same crescent for tooth. `r` is the part's
 * rough radius.
 */
function shadeSide(v: View, pts: Pts, r: number): void {
  const d = Math.max(4, r * 0.22);
  v.at({ translate: [d, -d * 0.7] }, () => {
    v.curve(pts, true, {
      stroke: "#7a70b4",
      weight: d * 2.4,
      brush: { preset: "wash", opacity: 0.85, blend: "multiply", grain: 0.25 },
      gesture: { pressure: "even" },
    });
  });
  const pencil: Style = {
    stroke: "#2c4f45",
    weight: 1.6,
    brush: { preset: "pencil", opacity: 0.3 },
    gesture: { pressure: "taper", wobble: 0.6 },
  };
  for (let k = 1; k <= 3; k += 1) {
    v.at({ translate: [d * (0.25 + k * 0.18), -d * (0.2 + k * 0.12)] }, () => {
      v.curve(pts, true, pencil);
    });
  }
}

/** Broad bristle strokes in a lighter green that follow the form, so the
 * lit skin looks painted. */
const SKIN_GESTURE: Gesture = { pressure: "taper", wobble: 1.5 };
const SKIN: Style = {
  stroke: "#b4e488",
  weight: 26,
  brush: { preset: "bristle", load: 0.7, opacity: 0.55 },
  gesture: SKIN_GESTURE,
};

function skin(v: View, strokes: readonly Pts[]): void {
  for (const st of strokes) v.curve(st, false, SKIN);
}

function flower(v: View, base: Vec2): void {
  const top: Vec2 = [base[0] - 18, base[1] - 56];
  const stem: Style = {
    stroke: "#2f5b3a",
    weight: 3,
    brush: "ink",
    gesture: { pressure: "taper-out" },
  };
  v.curve([base, [base[0] - 4, base[1] - 30], top], false, stem);
  v.curve(
    [
      [base[0] - 5, base[1] - 26],
      [base[0] + 6, base[1] - 34],
      [base[0] + 12, base[1] - 30],
    ],
    false,
    stem,
  );
  for (let i = 0; i < 6; i += 1) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    const px = top[0] + Math.cos(a) * 8;
    const py = top[1] + Math.sin(a) * 8;
    v.at({ translate: [px, py], rotate: a }, () => {
      v.ellipse(0, 0, 16, 9, { fill: "#f6b9cf" });
    });
  }
  v.circle(top[0], top[1], 8, { fill: "#f2c94c" });
}

function alien(v: View): void {
  // cast shadow, thrown away from the hatch light toward the left
  v.ellipse(AX - 50, 524, 260, 30, {
    fill: v.radialGradient(AX - 40, 524, 120, [
      [0, "rgba(14,26,34,0.5)"],
      [0.7, "rgba(14,26,34,0.3)"],
      [1, "rgba(14,26,34,0)"],
    ]),
  });

  // legs, arms and body first, then the tilted head on top
  body(v);
  v.at({ translate: [AX, 320], rotate: -0.12 }, () => {
    v.at({ translate: [-AX, -320] }, () => {
      // antennae
      const antenna: Style = {
        stroke: ALIEN_LINE,
        weight: 4.5,
        brush: "ink",
        gesture: { pressure: "taper-out" },
      };
      v.curve(ANT_L, false, antenna);
      v.curve(ANT_R, false, antenna);
      // the first tip's glint is drawn with the antennae's gesture, the second
      // with the first tip's outline gesture
      let glintGesture: Gesture = { pressure: "taper-out" };
      for (const tip of [ANT_L[2], ANT_R[2]]) {
        if (tip === undefined) continue;
        v.circle(tip[0], tip[1], 52, {
          fill: v.radialGradient(tip[0], tip[1], 26, [
            [0, "rgba(255,230,120,0.7)"],
            [1, "rgba(255,230,120,0)"],
          ]),
        });
        const gesture = glintGesture;
        shape(
          v,
          ellipsePts(tip[0], tip[1], 10, 10, 8),
          "#f6d548",
          () => {
            v.line(tip[0] - 3, tip[1] - 4, tip[0] - 2, tip[1] - 3, {
              stroke: "#fffbe0",
              weight: 6,
              brush: { preset: "airbrush", opacity: 0.8 },
              gesture,
            });
          },
          2.6,
          false,
        );
        glintGesture = OUTLINE_GESTURE;
      }

      // head
      shape(
        v,
        HEAD,
        GREEN,
        () => {
          skin(v, [
            [
              [AX - 86, 236],
              [AX - 40, 196],
              [AX + 30, 190],
              [AX + 84, 220],
            ],
            [
              [AX - 70, 214],
              [AX - 10, 184],
              [AX + 60, 194],
            ],
            [
              [AX - 60, 300],
              [AX, 318],
              [AX + 64, 298],
            ],
          ]);
          shadeSide(v, HEAD, 90);
        },
        3.6,
      );
      // eyes
      for (const e of [EYE_L, EYE_R]) {
        shape(
          v,
          ellipsePts(e.x, e.y, 25, 29, 10),
          "#fbfaf2",
          () => {
            v.curve(
              [
                [e.x - 22, e.y - 10],
                [e.x - 10, e.y + 18],
                [e.x + 16, e.y + 22],
              ],
              false,
              {
                stroke: "#b9c4d6",
                weight: 14,
                brush: { preset: "wash", opacity: 0.4 },
                gesture: OUTLINE_GESTURE,
              },
            );
          },
          3,
          false,
        );
        v.circle(e.x + 3, e.y + 6, 26, { fill: "#1e2a26" });
        v.circle(e.x + 8, e.y, 9, { fill: "#fefefe" });
        v.circle(e.x - 2, e.y + 12, 4, { fill: "#fefefe" });
      }
      // cheeks
      for (const [x, y] of [
        [EYE_L.x - 14, 282],
        [EYE_R.x + 14, 282],
      ] as const) {
        v.ellipse(x, y, 34, 22, {
          fill: v.radialGradient(x, y, 15, [
            [0, "rgba(255,120,140,0.6)"],
            [1, "rgba(255,120,140,0)"],
          ]),
        });
      }
      // smile
      v.curve(
        [
          [AX - 20, 290],
          [AX, 300],
          [AX + 20, 290],
        ],
        false,
        {
          stroke: ALIEN_LINE,
          weight: 3.4,
          brush: "ink",
          gesture: { pressure: "taper" },
        },
      );
    });
  });
}

function body(v: View): void {
  // legs and feet
  for (const leg of [LEG_L, LEG_R]) {
    shape(v, leg, GREEN, () => {
      shadeSide(v, leg, 14);
    });
  }
  for (const foot of [FOOT_L, FOOT_R]) {
    shape(v, foot, GREEN, () => {
      shadeSide(v, foot, 14);
    });
  }
  // hanging arm, holding a flower picked from the meadow
  shape(v, ARM_DOWN, GREEN, () => {
    shadeSide(v, ARM_DOWN, 16);
  });
  const handDown = ellipsePts(HAND_DOWN[0], HAND_DOWN[1], 14, 14, 10);
  shape(v, handDown, GREEN, () => {
    shadeSide(v, handDown, 14);
  });
  flower(v, [HAND_DOWN[0] + 2, HAND_DOWN[1] - 4]);
  // body
  shape(v, BODY, GREEN, () => {
    skin(v, [
      [
        [AX + 20, 332],
        [AX + 36, 400],
        [AX + 34, 470],
      ],
      [
        [AX - 6, 336],
        [AX + 2, 410],
        [AX - 4, 478],
      ],
      [
        [AX - 30, 344],
        [AX - 36, 410],
        [AX - 30, 476],
      ],
    ]);
    v.curve(BELLY, true, {
      stroke: "#5da956",
      weight: 36,
      brush: { preset: "wash", opacity: 0.35 },
      gesture: SKIN_GESTURE,
    });
    shadeSide(v, BODY, 60);
  });
  // waving arm
  shape(v, ARM_UP, GREEN, () => {
    shadeSide(v, ARM_UP, 16);
  });
  const handUp = ellipsePts(HAND_UP[0], HAND_UP[1], 16, 16, 10);
  shape(v, handUp, GREEN, () => {
    shadeSide(v, handUp, 16);
  });
  // wave lines
  const wave: Style = {
    stroke: "#fff3c4",
    weight: 3,
    brush: "ink",
    gesture: { pressure: "taper" },
  };
  v.curve(
    [
      [HAND_UP[0] + 26, HAND_UP[1] - 26],
      [HAND_UP[0] + 34, HAND_UP[1] - 8],
      [HAND_UP[0] + 30, HAND_UP[1] + 12],
    ],
    false,
    wave,
  );
  v.curve(
    [
      [HAND_UP[0] + 40, HAND_UP[1] - 34],
      [HAND_UP[0] + 50, HAND_UP[1] - 10],
      [HAND_UP[0] + 44, HAND_UP[1] + 18],
    ],
    false,
    wave,
  );
}

export function draw(v: View, model: DeepReadonly<Model>): void {
  sky(v, model.scene);
  land(v, model.scene);
  ship(v);
  hatch(v);
  alien(v);
  hatchBloom(v);
  grass(v, model.scene);
  fireflies(v);
  paperTone(v);
}
