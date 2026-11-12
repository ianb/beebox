import type { Sketch, Vec2 } from "@ianbicking/canvas-loop";
import { ALIEN_LINE, AX, ellipsePts, GREEN, type Pts, tube, W, H } from "./common.js";
import { fireflies, grass, hatch, hatchBloom, land, paperTone, ship, sky } from "./scene.js";

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

export function setup(s: Sketch): void {
  s.createCanvas(W, H);
}

function shape(s: Sketch, pts: Pts, fillColor: string, shade: () => void, weight = 3.2, rim = true): void {
  s.noStroke();
  s.fill(fillColor);
  s.curve(pts, true);
  s.clip(s.curvePath(pts, true), () => {
    s.noFill();
    shade();
    if (rim) {
      // warm rim light: the same outline shifted left, so its band falls just
      // inside the right-hand edge (the side facing the hatch)
      s.push();
      s.translate(-5, 2);
      s.brush("airbrush", { opacity: 1 });
      s.stroke("#fff0a8");
      s.strokeWeight(11);
      s.gesture({ pressure: "even" });
      s.curve(pts, true);
      s.pop();
    }
  });
  s.noFill();
  s.stroke(ALIEN_LINE);
  s.strokeWeight(weight);
  s.brush("ink", { thinning: 0.75 });
  // heavier along the bottom-left (shadow side), light along the top
  s.gesture({
    pressure: [
      [0, 0.7],
      [0.25, 1],
      [0.5, 0.95],
      [0.75, 0.5],
      [1, 0.7],
    ],
    wobble: 0.5,
  });
  s.curve(pts, true);
  s.noBrush();
}

/**
 * Form shadow for a part: its own outline shifted up-right, so a crescent of
 * violet falls inside the bottom-left edge (away from the hatch light), plus
 * pencil contour lines along the same crescent for tooth. `r` is the part's
 * rough radius.
 */
function shadeSide(s: Sketch, pts: Pts, r: number): void {
  const d = Math.max(4, r * 0.22);
  s.gesture({ pressure: "even" });
  s.push();
  s.translate(d, -d * 0.7);
  s.brush("wash", { opacity: 0.85, blend: "multiply", grain: 0.25 });
  s.stroke("#7a70b4");
  s.strokeWeight(d * 2.4);
  s.curve(pts, true);
  s.pop();
  s.brush("pencil", { opacity: 0.3 });
  s.stroke("#2c4f45");
  s.strokeWeight(1.6);
  s.gesture({ pressure: "taper", wobble: 0.6 });
  for (let k = 1; k <= 3; k += 1) {
    s.push();
    s.translate(d * (0.25 + k * 0.18), -d * (0.2 + k * 0.12));
    s.curve(pts, true);
    s.pop();
  }
}

/** Broad bristle strokes in a lighter green that follow the form, so the
 * lit skin looks painted. */
function skin(s: Sketch, strokes: readonly Pts[]): void {
  s.brush("bristle", { load: 0.7, opacity: 0.55 });
  s.stroke("#b4e488");
  s.strokeWeight(26);
  s.gesture({ pressure: "taper", wobble: 1.5 });
  for (const st of strokes) s.curve(st);
}

function flower(s: Sketch, base: Vec2): void {
  const top: Vec2 = [base[0] - 18, base[1] - 56];
  s.noFill();
  s.stroke("#2f5b3a");
  s.strokeWeight(3);
  s.brush("ink");
  s.gesture({ pressure: "taper-out" });
  s.curve([base, [base[0] - 4, base[1] - 30], top]);
  s.curve([
    [base[0] - 5, base[1] - 26],
    [base[0] + 6, base[1] - 34],
    [base[0] + 12, base[1] - 30],
  ]);
  s.noBrush();
  for (let i = 0; i < 6; i += 1) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    const px = top[0] + Math.cos(a) * 8;
    const py = top[1] + Math.sin(a) * 8;
    s.noStroke();
    s.fill("#f6b9cf");
    s.push();
    s.translate(px, py);
    s.rotate(a);
    s.ellipse(0, 0, 16, 9);
    s.pop();
  }
  s.fill("#f2c94c");
  s.circle(top[0], top[1], 8);
}

function alien(s: Sketch): void {
  // ground shadow
  s.noStroke();
  // cast shadow, thrown away from the hatch light toward the left
  s.fill(
    s.radialGradient(AX - 40, 524, 120, [
      [0, "rgba(14,26,34,0.5)"],
      [0.7, "rgba(14,26,34,0.3)"],
      [1, "rgba(14,26,34,0)"],
    ]),
  );
  s.ellipse(AX - 50, 524, 260, 30);

  // legs, arms and body first, then the tilted head on top
  body(s);
  s.push();
  s.translate(AX, 320);
  s.rotate(-0.12);
  s.translate(-AX, -320);
  // antennae
  s.noFill();
  s.stroke(ALIEN_LINE);
  s.strokeWeight(4.5);
  s.brush("ink");
  s.gesture({ pressure: "taper-out" });
  s.curve(ANT_L);
  s.curve(ANT_R);
  s.noBrush();
  for (const tip of [ANT_L[2], ANT_R[2]]) {
    if (tip === undefined) continue;
    s.noStroke();
    s.fill(
      s.radialGradient(tip[0], tip[1], 26, [
        [0, "rgba(255,230,120,0.7)"],
        [1, "rgba(255,230,120,0)"],
      ]),
    );
    s.circle(tip[0], tip[1], 52);
    shape(s, ellipsePts(tip[0], tip[1], 10, 10, 8), "#f6d548", () => {
      s.brush("airbrush", { opacity: 0.8 });
      s.stroke("#fffbe0");
      s.strokeWeight(6);
      s.line(tip[0] - 3, tip[1] - 4, tip[0] - 2, tip[1] - 3);
    }, 2.6, false);
  }

  // head
  shape(s, HEAD, GREEN, () => {
    skin(s, [
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
    shadeSide(s, HEAD, 90);
  }, 3.6);
  // eyes
  for (const e of [EYE_L, EYE_R]) {
    shape(s, ellipsePts(e.x, e.y, 25, 29, 10), "#fbfaf2", () => {
      s.brush("wash", { opacity: 0.4 });
      s.stroke("#b9c4d6");
      s.strokeWeight(14);
      s.curve([
        [e.x - 22, e.y - 10],
        [e.x - 10, e.y + 18],
        [e.x + 16, e.y + 22],
      ]);
    }, 3, false);
    s.noStroke();
    s.fill("#1e2a26");
    s.circle(e.x + 3, e.y + 6, 26);
    s.fill("#fefefe");
    s.circle(e.x + 8, e.y, 9);
    s.circle(e.x - 2, e.y + 12, 4);
  }
  // cheeks
  s.noStroke();
  for (const [x, y] of [
    [EYE_L.x - 14, 282],
    [EYE_R.x + 14, 282],
  ] as const) {
    s.fill(
      s.radialGradient(x, y, 15, [
        [0, "rgba(255,120,140,0.6)"],
        [1, "rgba(255,120,140,0)"],
      ]),
    );
    s.ellipse(x, y, 34, 22);
  }
  // smile
  s.noFill();
  s.brush("ink");
  s.stroke(ALIEN_LINE);
  s.strokeWeight(3.4);
  s.gesture({ pressure: "taper" });
  s.curve([
    [AX - 20, 290],
    [AX, 300],
    [AX + 20, 290],
  ]);
  s.noBrush();
  s.pop();
}

function body(s: Sketch): void {
  // legs and feet
  for (const leg of [LEG_L, LEG_R]) {
    shape(s, leg, GREEN, () => shadeSide(s, leg, 14));
  }
  for (const foot of [FOOT_L, FOOT_R]) {
    shape(s, foot, GREEN, () => shadeSide(s, foot, 14));
  }
  // hanging arm, holding a flower picked from the meadow
  shape(s, ARM_DOWN, GREEN, () => shadeSide(s, ARM_DOWN, 16));
  shape(s, ellipsePts(HAND_DOWN[0], HAND_DOWN[1], 14, 14, 10), GREEN, () =>
    shadeSide(s, ellipsePts(HAND_DOWN[0], HAND_DOWN[1], 14, 14, 10), 14),
  );
  flower(s, [HAND_DOWN[0] + 2, HAND_DOWN[1] - 4]);
  // body
  shape(s, BODY, GREEN, () => {
    skin(s, [
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
    s.brush("wash", { opacity: 0.35 });
    s.stroke("#5da956");
    s.strokeWeight(36);
    s.curve(BELLY, true);
    shadeSide(s, BODY, 60);
  });
  // waving arm
  shape(s, ARM_UP, GREEN, () => shadeSide(s, ARM_UP, 16));
  shape(s, ellipsePts(HAND_UP[0], HAND_UP[1], 16, 16, 10), GREEN, () =>
    shadeSide(s, ellipsePts(HAND_UP[0], HAND_UP[1], 16, 16, 10), 16),
  );
  // wave lines
  s.noFill();
  s.stroke("#fff3c4");
  s.strokeWeight(3);
  s.brush("ink");
  s.gesture({ pressure: "taper" });
  s.curve([
    [HAND_UP[0] + 26, HAND_UP[1] - 26],
    [HAND_UP[0] + 34, HAND_UP[1] - 8],
    [HAND_UP[0] + 30, HAND_UP[1] + 12],
  ]);
  s.curve([
    [HAND_UP[0] + 40, HAND_UP[1] - 34],
    [HAND_UP[0] + 50, HAND_UP[1] - 10],
    [HAND_UP[0] + 44, HAND_UP[1] + 18],
  ]);
  s.noBrush();

}

export function draw(s: Sketch): void {
  sky(s);
  land(s);
  ship(s);
  hatch(s);
  alien(s);
  hatchBloom(s);
  grass(s);
  fireflies(s);
  paperTone(s);
}

/** The hatch light, spilling softly over the ramp and the alien's right
 * side, screened over everything so it only ever brightens. */
