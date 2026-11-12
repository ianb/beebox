// Shared brush helpers and the townsfolk painter. Everything here paints in
// sprite-local coordinates; nothing here keeps state.
import type { Style, Vec2, View } from "@ianbicking/canvas-loop";

export const INK = "#3b2a24";

/** A deterministic 0..1 hash of an integer, for scattering marks in draw (which has no randomness). */
export function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43_758.5453;
  return s - Math.floor(s);
}

/** Ink outline style: brushed ink, even pressure, a little hand wobble. No fill. */
export function ink(weight = 2.2, seed?: number): Style {
  return {
    stroke: INK,
    weight,
    brush: { preset: "ink", thinning: 0.35 },
    gesture:
      seed === undefined
        ? { pressure: "even", wobble: 0.7 }
        : { pressure: "even", wobble: 0.7, seed },
  };
}

/** A flat fill outlined in ink. */
export function inked(fill: string, weight = 2.2): Style {
  return { fill, ...ink(weight) };
}

/** A soft wash shadow inside a closed outline. */
export function shadeInside(
  v: View,
  pts: readonly Vec2[],
  shade: string,
  shift: Vec2 = [6, 6],
): void {
  v.clip(v.curvePath(pts, true), () => {
    v.curve(
      v.offset(pts, 2).map(([x, y]): Vec2 => [x + shift[0], y + shift[1]]),
      true,
      { fill: shade },
    );
  });
}

/** An ellipse as points, for curve/clip/offset. */
export function ellipsePts(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  n = 10,
): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < n; i += 1) {
    const a = (i / n) * Math.PI * 2;
    out.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return out;
}

/** Plain text label in ink. */
export function label(
  v: View,
  text: string,
  x: number,
  y: number,
  size = 12,
  color = INK,
): void {
  v.text(
    text,
    { x, y },
    {
      size,
      font: '"Trebuchet MS", Verdana, sans-serif',
      style: "bold",
      fill: color,
      align: "center",
      valign: "middle",
    },
  );
}

// ── Townsfolk (standing, 64×100 sprite, feet at (32, 96)) ─────────────

export type Species =
  | "bear"
  | "rabbit"
  | "fox"
  | "pig"
  | "goat"
  | "duck"
  | "hippo";

export interface Arms {
  readonly l: Vec2;
  readonly r: Vec2;
}

export interface Folk {
  readonly species: Species;
  readonly fur: string;
  readonly muzzle: string;
  readonly shirt: string;
  readonly trim: string;
  readonly hat: "chef" | "cap" | "beret" | "none";
  readonly arms: Arms;
  /** Skip the pencil hatching (for tiny folk, where it is too faint to see). */
  readonly plain?: boolean;
  /** Eyes: open dots, or happy closed arcs. */
  readonly eyes?: "open" | "happy" | "wide";
}

export const FOLK_W = 64;
export const FOLK_H = 100;
const HEAD: Vec2 = [32, 42];
const HEAD_R = 15;
const SHOULDER_L: Vec2 = [21, 62];
const SHOULDER_R: Vec2 = [43, 62];

const BODY: readonly Vec2[] = [
  [32, 55],
  [44, 60],
  [47, 76],
  [44, 90],
  [32, 92],
  [20, 90],
  [17, 76],
  [20, 60],
];

const HATCH: Style = {
  stroke: "rgba(40,20,40,0.6)",
  weight: 1.6,
  brush: { preset: "pencil", opacity: 0.8 },
  gesture: { pressure: "taper", wobble: 0.4 },
};

function arm(v: View, f: Folk, from: Vec2, to: Vec2): void {
  const mid: Vec2 = [
    (from[0] + to[0]) / 2 + (to[0] < from[0] ? -2 : 2),
    (from[1] + to[1]) / 2 + 2,
  ];
  v.path(
    v.tube([from, mid, to], {
      width: 8,
      profile: [
        [0, 1],
        [1, 0.8],
      ],
    }),
    inked(f.shirt, 1.8),
  );
  v.circle(to[0], to[1], 8, inked(f.fur, 1.6));
}

function ears(v: View, f: Folk): void {
  const [hx, hy] = HEAD;
  switch (f.species) {
    case "bear":
    case "hippo": {
      const r = f.species === "bear" ? 6 : 4;
      for (const dx of [-11, 11]) {
        v.circle(hx + dx, hy - 12, r * 2, inked(f.fur));
        v.circle(hx + dx, hy - 12, r, { fill: f.muzzle });
      }
      return;
    }
    case "rabbit": {
      for (const dx of [-6, 6]) {
        const pts = ellipsePts(hx + dx, hy - 25, 5, 15);
        v.curve(pts, true, inked(f.fur));
        v.ellipse(hx + dx, hy - 24, 4, 20, { fill: "#f2a7b8" });
      }
      return;
    }
    case "fox": {
      for (const s of [-1, 1]) {
        const pts: Vec2[] = [
          [hx + s * 5, hy - 12],
          [hx + s * 15, hy - 27],
          [hx + s * 15, hy - 6],
        ];
        v.polygon(pts, inked(f.fur));
        v.polygon(
          [
            [hx + s * 12, hy - 18],
            [hx + s * 15, hy - 26],
            [hx + s * 15, hy - 16],
          ],
          { fill: INK },
        );
      }
      return;
    }
    case "pig": {
      for (const s of [-1, 1]) {
        v.polygon(
          [
            [hx + s * 5, hy - 13],
            [hx + s * 17, hy - 18],
            [hx + s * 13, hy - 5],
          ],
          inked(f.fur),
        );
      }
      return;
    }
    case "goat": {
      for (const s of [-1, 1])
        v.curve(
          ellipsePts(hx + s * 16, hy - 6, 7, 3.5, 8),
          true,
          inked(f.fur, 1.6),
        );
      return;
    }
    case "duck":
      v.curve(
        [
          [hx - 2, hy - 13],
          [hx + 2, hy - 22],
          [hx + 5, hy - 14],
        ],
        false,
        inked(f.fur, 1.6),
      );
      return;
  }
}

function face(v: View, f: Folk): void {
  const [hx, hy] = HEAD;
  if (f.species === "duck") {
    v.curve(ellipsePts(hx, hy + 6, 10, 4.5, 10), true, inked("#f29a2e", 1.8));
    v.line(hx - 8, hy + 6, hx + 8, hy + 6, ink(1.2));
  } else if (f.species === "pig") {
    v.ellipse(hx, hy + 5, 13, 9, inked("#f0a2a8", 1.8));
    v.ellipse(hx - 2.5, hy + 5, 2.2, 3, { fill: INK });
    v.ellipse(hx + 2.5, hy + 5, 2.2, 3, { fill: INK });
  } else {
    const long = f.species === "fox" || f.species === "goat";
    v.ellipse(hx, hy + 6, long ? 14 : 16, long ? 12 : 11, { fill: f.muzzle });
    v.ellipse(hx, hy + 2.5, 5, 3.5, { fill: INK });
    v.curve(
      [
        [hx - 3.5, hy + 7],
        [hx, hy + 8.5],
        [hx + 3.5, hy + 7],
      ],
      false,
      ink(1.3),
    );
  }
  if (f.species === "goat") {
    v.polygon(
      [
        [hx - 3, hy + 11],
        [hx + 3, hy + 11],
        [hx, hy + 20],
      ],
      inked(f.muzzle, 1.4),
    );
  }
  const eyes = f.eyes ?? "open";
  if (eyes === "happy") {
    v.curve(
      [
        [hx - 8, hy - 2],
        [hx - 5.5, hy - 4.5],
        [hx - 3, hy - 2],
      ],
      false,
      ink(1.6),
    );
    v.curve(
      [
        [hx + 3, hy - 2],
        [hx + 5.5, hy - 4.5],
        [hx + 8, hy - 2],
      ],
      false,
      ink(1.6),
    );
  } else {
    const r = eyes === "wide" ? 4.5 : 3;
    if (eyes === "wide") {
      v.circle(hx - 5.5, hy - 3, 9, { fill: "#ffffff" });
      v.circle(hx + 5.5, hy - 3, 9, { fill: "#ffffff" });
    }
    v.ellipse(hx - 5.5, hy - 3, r, r * 1.3, { fill: INK });
    v.ellipse(hx + 5.5, hy - 3, r, r * 1.3, { fill: INK });
    v.circle(hx - 5, hy - 4, 1.4, { fill: "#ffffff" });
    v.circle(hx + 6, hy - 4, 1.4, { fill: "#ffffff" });
  }
  v.circle(hx - 10, hy + 4, 5, { fill: "rgba(240,120,120,0.45)" });
  v.circle(hx + 10, hy + 4, 5, { fill: "rgba(240,120,120,0.45)" });
}

function hat(v: View, f: Folk): void {
  const [hx, hy] = HEAD;
  if (f.species === "goat") {
    // horns sit on top of the head, curling back
    for (const s of [-1, 1]) {
      v.path(
        v.tube(
          [
            [hx + s * 4, hy - 11],
            [hx + s * 8, hy - 20],
            [hx + s * 14, hy - 21],
          ],
          {
            width: 5,
            profile: [
              [0, 1],
              [1, 0.4],
            ],
          },
        ),
        inked("#c9b48e", 1.4),
      );
    }
  }
  switch (f.hat) {
    case "chef":
      v.curve(
        [
          [hx - 11, hy - 12],
          [hx - 15, hy - 24],
          [hx - 6, hy - 32],
          [hx + 6, hy - 32],
          [hx + 15, hy - 24],
          [hx + 11, hy - 12],
        ],
        true,
        inked("#ffffff", 1.8),
      );
      v.rect(hx - 11, hy - 15, 22, 5, inked("#f3eee4", 1.6));
      return;
    case "cap":
      v.path(
        [
          ["move", hx - 13, hy - 9],
          ["quad", hx, hy - 26, hx + 13, hy - 9],
          ["close"],
        ],
        inked(f.trim, 1.8),
      );
      v.rect(hx + 4, hy - 11, 15, 4, inked(f.trim, 1.6));
      return;
    case "beret":
      v.curve(ellipsePts(hx - 2, hy - 13, 15, 6, 10), true, inked(f.trim, 1.8));
      v.rect(hx - 3, hy - 22, 3, 5, { fill: f.trim });
      return;
    case "none":
      return;
  }
}

/** Paint a standing townsperson into a 64×100 sprite. */
export function paintFolk(v: View, f: Folk): void {
  // legs and feet
  v.ellipse(32, 96, 40, 7, { fill: "rgba(60,40,30,0.18)" });
  v.rect(23, 86, 7, 8, inked(f.fur, 1.6));
  v.rect(34, 86, 7, 8, inked(f.fur, 1.6));
  const footColor = f.species === "duck" ? "#f29a2e" : INK;
  v.ellipse(25, 95, 12, 5, { fill: footColor });
  v.ellipse(39, 95, 12, 5, { fill: footColor });
  // body
  v.curve(BODY, true, inked(f.shirt));
  shadeInside(v, BODY, "rgba(40,20,40,0.18)", [7, 5]);
  if (f.plain !== true)
    v.clip(v.curvePath(BODY, true), () => {
      for (let i = 0; i < 7; i += 1)
        v.line(30 + i * 4, 92, 46 + i * 4, 60, HATCH);
    });
  v.rect(18, 80, 28, 4, { fill: f.trim });
  if (f.hat === "chef") {
    // apron
    v.curve(
      [
        [24, 66],
        [40, 66],
        [42, 88],
        [32, 90],
        [22, 88],
      ],
      true,
      inked("#ffffff", 1.6),
    );
  }
  arm(v, f, SHOULDER_L, f.arms.l);
  arm(v, f, SHOULDER_R, f.arms.r);
  ears(v, f);
  const head = ellipsePts(HEAD[0], HEAD[1], HEAD_R, HEAD_R - 1, 12);
  v.curve(head, true, inked(f.fur));
  shadeInside(v, head, "rgba(60,30,20,0.16)", [5, 5]);
  face(v, f);
  hat(v, f);
}

// ── Other creatures ──────────────────────────────────────────────────

/** Sitting cat, 50×56, seat at bottom; the tail is drawn live. `mode` arched = leaping fright. */
export function paintCat(v: View, mode: "sit" | "arch"): void {
  const fur = "#8e8a9a";
  if (mode === "sit") {
    const body: Vec2[] = [
      [25, 22],
      [36, 32],
      [38, 50],
      [25, 54],
      [12, 50],
      [14, 32],
    ];
    v.curve(body, true, inked(fur));
    shadeInside(v, body, "rgba(30,20,50,0.2)", [6, 4]);
    v.ellipse(25, 44, 12, 14, inked("#e9e4ee", 1.4));
  } else {
    const body: Vec2[] = [
      [8, 46],
      [12, 26],
      [25, 18],
      [40, 26],
      [44, 46],
      [38, 36],
      [25, 30],
      [14, 36],
    ];
    v.curve(body, true, inked(fur));
    for (const x of [10, 16, 36, 42]) v.rect(x - 2, 40, 4, 12, inked(fur, 1.4));
  }
  const hy = mode === "sit" ? 18 : 16;
  for (const s of [-1, 1])
    v.polygon(
      [
        [25 + s * 4, hy - 6],
        [25 + s * 11, hy - 16],
        [25 + s * 11, hy - 2],
      ],
      inked(fur, 1.6),
    );
  v.circle(25, hy, 22, inked(fur, 1.8));
  if (mode === "sit") {
    v.curve(
      [
        [18, hy - 1],
        [20.5, hy - 3],
        [23, hy - 1],
      ],
      false,
      ink(1.4),
    );
    v.curve(
      [
        [27, hy - 1],
        [29.5, hy - 3],
        [32, hy - 1],
      ],
      false,
      ink(1.4),
    );
  } else {
    v.circle(20, hy - 2, 7, { fill: "#ffffff" });
    v.circle(30, hy - 2, 7, { fill: "#ffffff" });
    v.circle(20, hy - 2, 3, { fill: INK });
    v.circle(30, hy - 2, 3, { fill: INK });
  }
  v.triangle(23.5, hy + 3, 26.5, hy + 3, 25, hy + 5, { fill: "#e88a9a" });
  for (const s of [-1, 1]) {
    v.line(25 + s * 4, hy + 4, 25 + s * 13, hy + 2, ink(0.9));
    v.line(25 + s * 4, hy + 5, 25 + s * 13, hy + 7, ink(0.9));
  }
}

/** Puppy on four legs, 72×52, facing right, ground at y 50; the tail is drawn live. */
export function paintDog(v: View, mode: "stand" | "wet"): void {
  const fur = "#d9a25f";
  v.ellipse(34, 49, 54, 6, { fill: "rgba(60,40,30,0.18)" });
  for (const x of [18, 26, 42, 50]) v.rect(x - 3, 34, 7, 14, inked(fur, 1.4));
  const body: Vec2[] = [
    [14, 26],
    [34, 22],
    [54, 26],
    [56, 36],
    [34, 40],
    [14, 38],
  ];
  v.curve(body, true, inked(fur));
  shadeInside(v, body, "rgba(90,40,10,0.2)", [4, 6]);
  v.ellipse(30, 28, 12, 8, { fill: "#8c5a2e" });
  v.circle(58, 20, 24, inked(fur, 1.8));
  v.ellipse(66, 25, 12, 9, inked("#f3dcb4", 1.4));
  v.ellipse(70, 22, 5, 4, { fill: INK });
  v.curve(
    [
      [50, 12],
      [47, 22],
      [50, 32],
      [54, 22],
    ],
    true,
    inked("#8c5a2e", 1.6),
  );
  if (mode === "wet") {
    v.curve(
      [
        [57, 16],
        [60, 14],
        [63, 16],
      ],
      false,
      ink(1.4),
    );
    for (const [x, y] of [
      [20, 18],
      [40, 15],
      [60, 6],
      [10, 30],
    ] as const)
      v.ellipse(x, y, 3, 5, { fill: "rgba(120,180,230,0.8)" });
  } else {
    v.circle(61, 16, 4, { fill: INK });
  }
  v.rect(46, 26, 10, 4, { fill: "#d23b3b" });
  v.circle(51, 32, 4, { fill: "#f2c84b" });
}

/** An owl in a top-floor window, 54×60 including the window frame. */
export function paintOwlWindow(v: View, awake: boolean): void {
  v.rect(4, 4, 46, 50, inked(awake ? "#fde9a8" : "#3d4a6b", 2.4));
  const owl: Vec2[] = [
    [27, 16],
    [40, 24],
    [41, 46],
    [27, 52],
    [13, 46],
    [14, 24],
  ];
  v.curve(owl, true, inked("#9b7653", 1.8));
  v.ellipse(27, 42, 16, 16, { fill: "#d8bf98" });
  for (const s of [-1, 1])
    v.triangle(27 + s * 6, 20, 27 + s * 13, 13, 27 + s * 12, 24, {
      fill: "#9b7653",
    });
  if (awake) {
    v.circle(21, 28, 12, { fill: "#ffffff" });
    v.circle(33, 28, 12, { fill: "#ffffff" });
    v.circle(21, 28, 5, { fill: INK });
    v.circle(33, 28, 5, { fill: INK });
  } else {
    v.curve(
      [
        [17, 28],
        [21, 30],
        [25, 28],
      ],
      false,
      ink(1.5),
    );
    v.curve(
      [
        [29, 28],
        [33, 30],
        [37, 28],
      ],
      false,
      ink(1.5),
    );
    // nightcap
    v.polygon(
      [
        [16, 20],
        [38, 20],
        [46, 8],
      ],
      inked("#c94f6d", 1.4),
    );
    v.circle(46, 8, 6, { fill: "#ffffff" });
  }
  v.triangle(25, 32, 29, 32, 27, 37, { fill: "#f29a2e" });
  v.line(27, 4, 27, 54, ink(2.6));
  v.rect(0, 52, 54, 6, inked("#b4553a", 1.8));
}

/** One pigeon, 26×22, facing right. */
export function paintPigeon(v: View, flap: boolean): void {
  const body: Vec2[] = [
    [4, 14],
    [12, 9],
    [22, 11],
    [20, 18],
    [10, 19],
  ];
  v.curve(body, true, inked("#9aa3b5", 1.4));
  v.circle(20, 8, 9, inked("#9aa3b5", 1.4));
  v.ellipse(18, 12, 6, 4, { fill: "#7c5fa8" });
  v.circle(21, 7, 2, { fill: INK });
  v.triangle(24, 7, 26, 8.5, 24, 9.5, { fill: "#f29a2e" });
  if (flap) {
    v.polygon(
      [
        [9, 11],
        [4, 0],
        [16, 10],
      ],
      inked("#c3c9d6", 1.2),
    );
  } else {
    v.curve(
      [
        [7, 12],
        [14, 11],
        [16, 15],
        [8, 16],
      ],
      true,
      inked("#c3c9d6", 1.2),
    );
  }
}

/** A snail, 34×24, facing right; shell or tucked in. */
export function paintSnail(v: View, tucked: boolean): void {
  if (!tucked) {
    v.curve(
      [
        [2, 21],
        [20, 20],
        [30, 14],
        [32, 21],
        [18, 23],
      ],
      true,
      inked("#cfd98a", 1.3),
    );
    v.line(29, 15, 31, 7, ink(1.2));
    v.line(31, 15, 34, 8, ink(1.2));
    v.circle(31, 7, 2.5, { fill: INK });
    v.circle(34, 8, 2.5, { fill: INK });
  }
  v.circle(14, 13, 20, inked("#c8814a", 1.6));
  v.curve(
    [
      [14, 13],
      [17, 11],
      [18, 15],
      [13, 18],
      [8, 13],
      [12, 6],
      [20, 7],
    ],
    false,
    ink(1.2),
  );
}

/** A mole in a hard hat, 40×40; head and shoulders only. */
export function paintMole(v: View): void {
  v.curve(
    [
      [6, 40],
      [6, 22],
      [20, 12],
      [34, 22],
      [34, 40],
    ],
    true,
    inked("#5d5468", 1.8),
  );
  v.ellipse(20, 26, 10, 7, inked("#f3a6b4", 1.4));
  v.circle(15, 20, 3, { fill: INK });
  v.circle(25, 20, 3, { fill: INK });
  v.path(
    [["move", 6, 15], ["quad", 20, -2, 34, 15], ["close"]],
    inked("#f2c84b", 1.8),
  );
  v.rect(3, 13, 34, 4, inked("#f2c84b", 1.4));
  v.circle(20, 8, 5, { fill: "#ffffff" });
  v.circle(4, 32, 8, inked("#8fb3d9", 1.2));
  v.circle(36, 32, 8, inked("#8fb3d9", 1.2));
}
