// Shared brush helpers and the townsfolk painter. Everything here paints in
// sprite-local coordinates; nothing here keeps state.
import type { Vec2, View } from "@ianbicking/canvas-loop";

export const INK = "#3b2a24";

/** A deterministic 0..1 hash of an integer, for scattering marks in draw (which has no randomness). */
export function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43_758.5453;
  return s - Math.floor(s);
}

/** Ink outline state: brushed ink, even pressure, a little hand wobble. */
export function ink(v: View, weight = 2.2, seed?: number): void {
  v.brush("ink", { thinning: 0.35 });
  v.stroke(INK);
  v.strokeWeight(weight);
  v.gesture(seed === undefined ? { pressure: "even", wobble: 0.7 } : { pressure: "even", wobble: 0.7, seed });
}

/** Fill with a flat colour and outline with ink, then draw. */
export function inked(v: View, fill: string, body: () => void, weight = 2.2): void {
  v.fill(fill);
  ink(v, weight);
  body();
}

/** A flat fill with no outline. */
export function flat(v: View, fill: string, body: () => void): void {
  v.noStroke();
  v.noBrush();
  v.fill(fill);
  body();
}

/** A soft wash shadow inside a closed outline. */
export function shadeInside(v: View, pts: readonly Vec2[], shade: string, shift: Vec2 = [6, 6]): void {
  v.clip(v.curvePath(pts, true), () => {
    v.noStroke();
    v.noBrush();
    v.fill(shade);
    v.curve(
      v.offset(pts, 2).map(([x, y]): Vec2 => [x + shift[0], y + shift[1]]),
      true,
    );
  });
}

/** An ellipse as points, for curve/clip/offset. */
export function ellipsePts(cx: number, cy: number, rx: number, ry: number, n = 10): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < n; i += 1) {
    const a = (i / n) * Math.PI * 2;
    out.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return out;
}

/** Plain text label in ink. */
export function label(v: View, text: string, x: number, y: number, size = 12, color = INK): void {
  v.noStroke();
  v.noBrush();
  v.fill(color);
  v.textSize(size);
  v.textAlign("center", "middle");
  v.text(text, x, y);
}

// ── Townsfolk (standing, 64×100 sprite, feet at (32, 96)) ─────────────

export type Species = "bear" | "rabbit" | "fox" | "pig" | "goat" | "duck" | "hippo";

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

function arm(v: View, f: Folk, from: Vec2, to: Vec2): void {
  const mid: Vec2 = [(from[0] + to[0]) / 2 + (to[0] < from[0] ? -2 : 2), (from[1] + to[1]) / 2 + 2];
  inked(v, f.shirt, () => v.path(v.tube([from, mid, to], { width: 8, profile: [[0, 1], [1, 0.8]] })), 1.8);
  inked(v, f.fur, () => v.circle(to[0], to[1], 8), 1.6);
}

function ears(v: View, f: Folk): void {
  const [hx, hy] = HEAD;
  switch (f.species) {
    case "bear":
    case "hippo": {
      const r = f.species === "bear" ? 6 : 4;
      for (const dx of [-11, 11]) {
        inked(v, f.fur, () => v.circle(hx + dx, hy - 12, r * 2));
        flat(v, f.muzzle, () => v.circle(hx + dx, hy - 12, r));
      }
      return;
    }
    case "rabbit": {
      for (const dx of [-6, 6]) {
        const pts = ellipsePts(hx + dx, hy - 25, 5, 15);
        inked(v, f.fur, () => v.curve(pts, true));
        flat(v, "#f2a7b8", () => v.ellipse(hx + dx, hy - 24, 4, 20));
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
        inked(v, f.fur, () => v.polygon(pts));
        flat(v, INK, () => v.polygon([[hx + s * 12, hy - 18], [hx + s * 15, hy - 26], [hx + s * 15, hy - 16]]));
      }
      return;
    }
    case "pig": {
      for (const s of [-1, 1]) {
        inked(v, f.fur, () =>
          v.polygon([
            [hx + s * 5, hy - 13],
            [hx + s * 17, hy - 18],
            [hx + s * 13, hy - 5],
          ]),
        );
      }
      return;
    }
    case "goat": {
      for (const s of [-1, 1]) inked(v, f.fur, () => v.curve(ellipsePts(hx + s * 16, hy - 6, 7, 3.5, 8), true), 1.6);
      return;
    }
    case "duck":
      inked(v, f.fur, () => v.curve([[hx - 2, hy - 13], [hx + 2, hy - 22], [hx + 5, hy - 14]], false), 1.6);
      return;
  }
}

function face(v: View, f: Folk): void {
  const [hx, hy] = HEAD;
  if (f.species === "duck") {
    inked(v, "#f29a2e", () => v.curve(ellipsePts(hx, hy + 6, 10, 4.5, 10), true), 1.8);
    v.noFill();
    ink(v, 1.2);
    v.line(hx - 8, hy + 6, hx + 8, hy + 6);
  } else if (f.species === "pig") {
    inked(v, "#f0a2a8", () => v.ellipse(hx, hy + 5, 13, 9), 1.8);
    flat(v, INK, () => {
      v.ellipse(hx - 2.5, hy + 5, 2.2, 3);
      v.ellipse(hx + 2.5, hy + 5, 2.2, 3);
    });
  } else {
    const long = f.species === "fox" || f.species === "goat";
    flat(v, f.muzzle, () => v.ellipse(hx, hy + 6, long ? 14 : 16, long ? 12 : 11));
    flat(v, INK, () => v.ellipse(hx, hy + 2.5, 5, 3.5));
    v.noFill();
    ink(v, 1.3);
    v.curve([[hx - 3.5, hy + 7], [hx, hy + 8.5], [hx + 3.5, hy + 7]]);
  }
  if (f.species === "goat") {
    inked(v, f.muzzle, () => v.polygon([[hx - 3, hy + 11], [hx + 3, hy + 11], [hx, hy + 20]]), 1.4);
  }
  const eyes = f.eyes ?? "open";
  if (eyes === "happy") {
    v.noFill();
    ink(v, 1.6);
    v.curve([[hx - 8, hy - 2], [hx - 5.5, hy - 4.5], [hx - 3, hy - 2]]);
    v.curve([[hx + 3, hy - 2], [hx + 5.5, hy - 4.5], [hx + 8, hy - 2]]);
  } else {
    const r = eyes === "wide" ? 4.5 : 3;
    if (eyes === "wide") flat(v, "#ffffff", () => {
      v.circle(hx - 5.5, hy - 3, 9);
      v.circle(hx + 5.5, hy - 3, 9);
    });
    flat(v, INK, () => {
      v.ellipse(hx - 5.5, hy - 3, r, r * 1.3);
      v.ellipse(hx + 5.5, hy - 3, r, r * 1.3);
    });
    flat(v, "#ffffff", () => {
      v.circle(hx - 5, hy - 4, 1.4);
      v.circle(hx + 6, hy - 4, 1.4);
    });
  }
  flat(v, "rgba(240,120,120,0.45)", () => {
    v.circle(hx - 10, hy + 4, 5);
    v.circle(hx + 10, hy + 4, 5);
  });
}

function hat(v: View, f: Folk): void {
  const [hx, hy] = HEAD;
  if (f.species === "goat") {
    // horns sit on top of the head, curling back
    for (const s of [-1, 1]) {
      inked(v, "#c9b48e", () => v.path(v.tube([[hx + s * 4, hy - 11], [hx + s * 8, hy - 20], [hx + s * 14, hy - 21]], { width: 5, profile: [[0, 1], [1, 0.4]] })), 1.4);
    }
  }
  switch (f.hat) {
    case "chef":
      inked(v, "#ffffff", () => {
        v.curve([[hx - 11, hy - 12], [hx - 15, hy - 24], [hx - 6, hy - 32], [hx + 6, hy - 32], [hx + 15, hy - 24], [hx + 11, hy - 12]], true);
      }, 1.8);
      inked(v, "#f3eee4", () => v.rect(hx - 11, hy - 15, 22, 5), 1.6);
      return;
    case "cap":
      inked(v, f.trim, () => v.path([["move", hx - 13, hy - 9], ["quad", hx, hy - 26, hx + 13, hy - 9], ["close"]]), 1.8);
      inked(v, f.trim, () => v.rect(hx + 4, hy - 11, 15, 4), 1.6);
      return;
    case "beret":
      inked(v, f.trim, () => v.curve(ellipsePts(hx - 2, hy - 13, 15, 6, 10), true), 1.8);
      flat(v, f.trim, () => v.rect(hx - 3, hy - 22, 3, 5));
      return;
    case "none":
      return;
  }
}

/** Paint a standing townsperson into a 64×100 sprite. */
export function paintFolk(v: View, f: Folk): void {
  // legs and feet
  flat(v, "rgba(60,40,30,0.18)", () => v.ellipse(32, 96, 40, 7));
  inked(v, f.fur, () => {
    v.rect(23, 86, 7, 8);
    v.rect(34, 86, 7, 8);
  }, 1.6);
  const footColor = f.species === "duck" ? "#f29a2e" : INK;
  flat(v, footColor, () => {
    v.ellipse(25, 95, 12, 5);
    v.ellipse(39, 95, 12, 5);
  });
  // body
  inked(v, f.shirt, () => v.curve(BODY, true));
  shadeInside(v, BODY, "rgba(40,20,40,0.18)", [7, 5]);
  v.clip(v.curvePath(BODY, true), () => {
    v.noFill();
    v.stroke("rgba(40,20,40,0.6)");
    v.brush("pencil", { opacity: 0.8 });
    v.strokeWeight(1.6);
    v.gesture({ pressure: "taper", wobble: 0.4 });
    for (let i = 0; i < 7; i += 1) v.line(30 + i * 4, 92, 46 + i * 4, 60);
  });
  flat(v, f.trim, () => v.rect(18, 80, 28, 4));
  if (f.hat === "chef") {
    // apron
    inked(v, "#ffffff", () => v.curve([[24, 66], [40, 66], [42, 88], [32, 90], [22, 88]], true), 1.6);
  }
  arm(v, f, SHOULDER_L, f.arms.l);
  arm(v, f, SHOULDER_R, f.arms.r);
  ears(v, f);
  const head = ellipsePts(HEAD[0], HEAD[1], HEAD_R, HEAD_R - 1, 12);
  inked(v, f.fur, () => v.curve(head, true));
  shadeInside(v, head, "rgba(60,30,20,0.16)", [5, 5]);
  face(v, f);
  hat(v, f);
}

// ── Other creatures ──────────────────────────────────────────────────

/** Sitting cat, 50×56, seat at bottom; the tail is drawn live. `mode` arched = leaping fright. */
export function paintCat(v: View, mode: "sit" | "arch"): void {
  const fur = "#8e8a9a";
  if (mode === "sit") {
    const body: Vec2[] = [[25, 22], [36, 32], [38, 50], [25, 54], [12, 50], [14, 32]];
    inked(v, fur, () => v.curve(body, true));
    shadeInside(v, body, "rgba(30,20,50,0.2)", [6, 4]);
    inked(v, "#e9e4ee", () => v.ellipse(25, 44, 12, 14), 1.4);
  } else {
    const body: Vec2[] = [[8, 46], [12, 26], [25, 18], [40, 26], [44, 46], [38, 36], [25, 30], [14, 36]];
    inked(v, fur, () => v.curve(body, true));
    for (const x of [10, 16, 36, 42]) inked(v, fur, () => v.rect(x - 2, 40, 4, 12), 1.4);
  }
  const hy = mode === "sit" ? 18 : 16;
  for (const s of [-1, 1]) inked(v, fur, () => v.polygon([[25 + s * 4, hy - 6], [25 + s * 11, hy - 16], [25 + s * 11, hy - 2]]), 1.6);
  inked(v, fur, () => v.circle(25, hy, 22), 1.8);
  if (mode === "sit") {
    v.noFill();
    ink(v, 1.4);
    v.curve([[18, hy - 1], [20.5, hy - 3], [23, hy - 1]]);
    v.curve([[27, hy - 1], [29.5, hy - 3], [32, hy - 1]]);
  } else {
    flat(v, "#ffffff", () => {
      v.circle(20, hy - 2, 7);
      v.circle(30, hy - 2, 7);
    });
    flat(v, INK, () => {
      v.circle(20, hy - 2, 3);
      v.circle(30, hy - 2, 3);
    });
  }
  flat(v, "#e88a9a", () => v.triangle(23.5, hy + 3, 26.5, hy + 3, 25, hy + 5));
  v.noFill();
  ink(v, 0.9);
  for (const s of [-1, 1]) {
    v.line(25 + s * 4, hy + 4, 25 + s * 13, hy + 2);
    v.line(25 + s * 4, hy + 5, 25 + s * 13, hy + 7);
  }
}

/** Puppy on four legs, 72×52, facing right, ground at y 50; the tail is drawn live. */
export function paintDog(v: View, mode: "stand" | "wet"): void {
  const fur = "#d9a25f";
  flat(v, "rgba(60,40,30,0.18)", () => v.ellipse(34, 49, 54, 6));
  for (const x of [18, 26, 42, 50]) inked(v, fur, () => v.rect(x - 3, 34, 7, 14), 1.4);
  const body: Vec2[] = [[14, 26], [34, 22], [54, 26], [56, 36], [34, 40], [14, 38]];
  inked(v, fur, () => v.curve(body, true));
  shadeInside(v, body, "rgba(90,40,10,0.2)", [4, 6]);
  flat(v, "#8c5a2e", () => v.ellipse(30, 28, 12, 8));
  inked(v, fur, () => v.circle(58, 20, 24), 1.8);
  inked(v, "#f3dcb4", () => v.ellipse(66, 25, 12, 9), 1.4);
  flat(v, INK, () => v.ellipse(70, 22, 5, 4));
  inked(v, "#8c5a2e", () => v.curve([[50, 12], [47, 22], [50, 32], [54, 22]], true), 1.6);
  if (mode === "wet") {
    v.noFill();
    ink(v, 1.4);
    v.curve([[57, 16], [60, 14], [63, 16]]);
    flat(v, "rgba(120,180,230,0.8)", () => {
      for (const [x, y] of [[20, 18], [40, 15], [60, 6], [10, 30]] as const) v.ellipse(x, y, 3, 5);
    });
  } else {
    flat(v, INK, () => v.circle(61, 16, 4));
  }
  flat(v, "#d23b3b", () => v.rect(46, 26, 10, 4));
  flat(v, "#f2c84b", () => v.circle(51, 32, 4));
}

/** An owl in a top-floor window, 54×60 including the window frame. */
export function paintOwlWindow(v: View, awake: boolean): void {
  inked(v, awake ? "#fde9a8" : "#3d4a6b", () => v.rect(4, 4, 46, 50), 2.4);
  const owl: Vec2[] = [[27, 16], [40, 24], [41, 46], [27, 52], [13, 46], [14, 24]];
  inked(v, "#9b7653", () => v.curve(owl, true), 1.8);
  flat(v, "#d8bf98", () => v.ellipse(27, 42, 16, 16));
  for (const s of [-1, 1]) flat(v, "#9b7653", () => v.triangle(27 + s * 6, 20, 27 + s * 13, 13, 27 + s * 12, 24));
  if (awake) {
    flat(v, "#ffffff", () => {
      v.circle(21, 28, 12);
      v.circle(33, 28, 12);
    });
    flat(v, INK, () => {
      v.circle(21, 28, 5);
      v.circle(33, 28, 5);
    });
  } else {
    v.noFill();
    ink(v, 1.5);
    v.curve([[17, 28], [21, 30], [25, 28]]);
    v.curve([[29, 28], [33, 30], [37, 28]]);
    // nightcap
    inked(v, "#c94f6d", () => v.polygon([[16, 20], [38, 20], [46, 8]]), 1.4);
    flat(v, "#ffffff", () => v.circle(46, 8, 6));
  }
  flat(v, "#f29a2e", () => v.triangle(25, 32, 29, 32, 27, 37));
  v.noFill();
  ink(v, 2.6);
  v.line(27, 4, 27, 54);
  inked(v, "#b4553a", () => v.rect(0, 52, 54, 6), 1.8);
}

/** One pigeon, 26×22, facing right. */
export function paintPigeon(v: View, flap: boolean): void {
  const body: Vec2[] = [[4, 14], [12, 9], [22, 11], [20, 18], [10, 19]];
  inked(v, "#9aa3b5", () => v.curve(body, true), 1.4);
  inked(v, "#9aa3b5", () => v.circle(20, 8, 9), 1.4);
  flat(v, "#7c5fa8", () => v.ellipse(18, 12, 6, 4));
  flat(v, INK, () => v.circle(21, 7, 2));
  flat(v, "#f29a2e", () => v.triangle(24, 7, 26, 8.5, 24, 9.5));
  if (flap) {
    inked(v, "#c3c9d6", () => v.polygon([[9, 11], [4, 0], [16, 10]]), 1.2);
  } else {
    inked(v, "#c3c9d6", () => v.curve([[7, 12], [14, 11], [16, 15], [8, 16]], true), 1.2);
  }
}

/** A snail, 34×24, facing right; shell or tucked in. */
export function paintSnail(v: View, tucked: boolean): void {
  if (!tucked) {
    inked(v, "#cfd98a", () => v.curve([[2, 21], [20, 20], [30, 14], [32, 21], [18, 23]], true), 1.3);
    v.noFill();
    ink(v, 1.2);
    v.line(29, 15, 31, 7);
    v.line(31, 15, 34, 8);
    flat(v, INK, () => {
      v.circle(31, 7, 2.5);
      v.circle(34, 8, 2.5);
    });
  }
  inked(v, "#c8814a", () => v.circle(14, 13, 20), 1.6);
  v.noFill();
  ink(v, 1.2);
  v.curve([[14, 13], [17, 11], [18, 15], [13, 18], [8, 13], [12, 6], [20, 7]]);
}

/** A mole in a hard hat, 40×40; head and shoulders only. */
export function paintMole(v: View): void {
  inked(v, "#5d5468", () => v.curve([[6, 40], [6, 22], [20, 12], [34, 22], [34, 40]], true), 1.8);
  inked(v, "#f3a6b4", () => v.ellipse(20, 26, 10, 7), 1.4);
  flat(v, INK, () => {
    v.circle(15, 20, 3);
    v.circle(25, 20, 3);
  });
  inked(v, "#f2c84b", () => v.path([["move", 6, 15], ["quad", 20, -2, 34, 15], ["close"]]), 1.8);
  inked(v, "#f2c84b", () => v.rect(3, 13, 34, 4), 1.4);
  flat(v, "#ffffff", () => v.circle(20, 8, 5));
  inked(v, "#8fb3d9", () => v.circle(4, 32, 8), 1.2);
  inked(v, "#8fb3d9", () => v.circle(36, 32, 8), 1.2);
}
