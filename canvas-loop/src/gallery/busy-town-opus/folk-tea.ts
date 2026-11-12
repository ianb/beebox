// Sprites: every character, pose and prop, painted once and placed every frame.
import type { Sprite, View } from "@ianbicking/canvas-loop";
import type { Folk } from "./paint-tea.js";
import { FOLK_H, FOLK_W, INK, ellipsePts, flat, ink, inked, label, paintCat, paintDog, paintFolk, paintMole, paintOwlWindow, paintPigeon, paintSnail } from "./paint-tea.js";

const BAKER: Folk = { species: "bear", fur: "#a8784e", muzzle: "#ecd3ad", shirt: "#9cc0e0", trim: "#d8443a", hat: "chef", arms: { l: [14, 84], r: [50, 84] } };
const MAIL: Folk = { species: "rabbit", fur: "#f3eee6", muzzle: "#ffffff", shirt: "#4a7ab8", trim: "#2f5d8a", hat: "cap", arms: { l: [16, 84], r: [48, 80] } };
const PAINTER: Folk = { species: "fox", fur: "#e07a3a", muzzle: "#fff4e6", shirt: "#f6f6f0", trim: "#c23b3b", hat: "beret", arms: { l: [10, 72], r: [56, 34] } };
const GOAT: Folk = { species: "goat", fur: "#f4f1ea", muzzle: "#e4dccd", shirt: "#e88aa8", trim: "#c95a7a", hat: "none", arms: { l: [54, 66], r: [58, 58] } };
const GROCER: Folk = { species: "pig", fur: "#f4b6b4", muzzle: "#f4b6b4", shirt: "#7ab86a", trim: "#3f7a3a", hat: "cap", arms: { l: [12, 80], r: [18, 88] } };
const DUCK: Folk = { species: "duck", fur: "#f7e27a", muzzle: "#f7e27a", shirt: "#6a8fd0", trim: "#7a4ab0", hat: "beret", arms: { l: [22, 70], r: [42, 70] } };
const DRIVER: Folk = { species: "hippo", fur: "#9a8fb4", muzzle: "#b9aecf", shirt: "#3a5a9a", trim: "#3a5a9a", hat: "cap", arms: { l: [10, 66], r: [54, 66] } };

export type Pose =
  | "baker-idle"
  | "baker-reach"
  | "baker-up"
  | "mail-idle"
  | "mail-toss"
  | "painter-paint"
  | "painter-hang"
  | "goat-water"
  | "grocer-sweep"
  | "grocer-juggle"
  | "duck-read"
  | "duck-quack";

function bag(v: View): void {
  inked(v, "#a0703e", () => v.curve([[8, 70], [26, 72], [28, 90], [10, 92], [6, 80]], true), 1.8);
  inked(v, "#ffffff", () => v.rect(12, 64, 12, 8), 1.2);
  v.noFill();
  ink(v, 1.6);
  v.line(22, 58, 14, 72);
}


function newspaper(v: View): void {
  inked(v, "#f3efe2", () => v.polygon([[12, 52], [52, 50], [54, 82], [10, 84]]), 1.6);
  v.noFill();
  ink(v, 0.9);
  for (let i = 0; i < 5; i += 1) v.line(16, 62 + i * 4, 30, 62 + i * 4);
  for (let i = 0; i < 6; i += 1) v.line(34, 58 + i * 4, 49, 58 + i * 4);
  label(v, "NEWS", 22, 56, 6);
}

function poseBody(v: View, pose: Pose): void {
  switch (pose) {
    case "baker-idle":
      paintFolk(v, BAKER);
      return;
    case "baker-reach":
      paintFolk(v, { ...BAKER, arms: { l: [56, 72], r: [60, 78] } });
      return;
    case "baker-up":
      paintFolk(v, { ...BAKER, arms: { l: [12, 24], r: [52, 24] }, eyes: "happy" });
      return;
    case "mail-idle":
      paintFolk(v, MAIL);
      bag(v);
      return;
    case "mail-toss":
      paintFolk(v, { ...MAIL, arms: { l: [16, 84], r: [58, 36] }, eyes: "happy" });
      bag(v);
      return;
    case "painter-paint":
      paintFolk(v, PAINTER);
      return;
    case "painter-hang":
      paintFolk(v, { ...PAINTER, arms: { l: [12, 30], r: [52, 30] }, eyes: "wide" });
      return;
    case "goat-water":
      paintFolk(v, GOAT);
      return;
    case "grocer-sweep":
      paintFolk(v, GROCER);
      return;
    case "grocer-juggle":
      paintFolk(v, { ...GROCER, arms: { l: [10, 34], r: [54, 34] }, eyes: "happy" });
      return;
    case "duck-read":
      paintFolk(v, DUCK);
      newspaper(v);
      return;
    case "duck-quack":
      paintFolk(v, { ...DUCK, arms: { l: [8, 40], r: [56, 40] }, eyes: "wide" });
      return;
  }
}

export function folk(v: View, pose: Pose): Sprite {
  return v.sprite({ key: pose, width: FOLK_W, height: FOLK_H }, () => poseBody(v, pose));
}

export function loaf(v: View): Sprite {
  return v.sprite({ key: "loaf", width: 44, height: 26 }, () => {
    inked(v, "#d58b42", () => v.curve(ellipsePts(22, 14, 18, 9, 10), true), 1.8);
    v.noFill();
    ink(v, 1.4);
    v.stroke("#9a5a26");
    for (const x of [14, 22, 30]) v.line(x - 3, 9, x + 3, 18);
  });
}

/** Watering can, 30×22; handle (the pivot) at (6, 10), spout tip at (29, 2). */
export function wateringCan(v: View): Sprite {
  return v.sprite({ key: "can", width: 30, height: 22 }, () => {
    inked(v, "#6fa8c8", () => v.polygon([[18, 12], [22, 10], [29, 2], [25, 14]]), 1.4);
    inked(v, "#6fa8c8", () => v.rect(4, 8, 16, 13), 1.6);
    v.noFill();
    ink(v, 2);
    v.curve([[4, 12], [1, 6], [8, 4], [12, 8]]);
  });
}

export function chimney(v: View): Sprite {
  return v.sprite({ key: "chimney", width: 34, height: 56 }, () => {
    inked(v, "#b85a40", () => v.rect(4, 8, 26, 46), 2);
    inked(v, "#8a3b2a", () => v.rect(1, 3, 32, 9), 2);
    v.noFill();
    ink(v, 1);
    for (let r = 0; r < 4; r += 1) v.line(4, 20 + r * 10, 30, 20 + r * 10);
  });
}

/** The goat's window: shutters shut, or flung open on a dark room. 80×86, sill at y 66. */
export function windowSprite(v: View, open: boolean): Sprite {
  return v.sprite({ key: open ? "window-open" : "window-shut", width: 80, height: 86 }, () => {
    if (open) {
      inked(v, "#5a4a6a", () => v.rect(16, 6, 48, 60), 2.4);
      for (const x of [2, 64]) inked(v, "#4a8fb8", () => v.rect(x, 4, 14, 62), 2);
    } else {
      inked(v, "#cfe7f2", () => v.rect(16, 6, 48, 60), 2.4);
      for (const x of [16, 40]) {
        inked(v, "#4a8fb8", () => v.rect(x, 6, 24, 60), 2);
        v.noFill();
        ink(v, 1);
        for (let i = 0; i < 6; i += 1) v.line(x + 3, 14 + i * 8, x + 21, 14 + i * 8);
      }
    }
    inked(v, "#a0603a", () => v.rect(10, 66, 60, 14), 2);
  });
}

export function cat(v: View, mode: "sit" | "arch"): Sprite {
  return v.sprite({ key: `cat-${mode}`, width: 50, height: 56 }, () => paintCat(v, mode));
}

export function mailbox(v: View, open: boolean): Sprite {
  return v.sprite({ key: open ? "mailbox-open" : "mailbox", width: 40, height: 66 }, () => {
    v.noFill();
    ink(v, 3);
    v.line(20, 40, 20, 64);
    inked(v, "#3a6fc0", () => v.path([["move", 4, 42], ["line", 4, 18], ["quad", 20, 2, 36, 18], ["line", 36, 42], ["close"]]), 2.2);
    if (open) {
      inked(v, "#2a4f90", () => v.polygon([[6, 22], [34, 22], [38, 8], [10, 4]]), 1.6);
      flat(v, INK, () => v.rect(8, 22, 24, 5));
    } else {
      inked(v, "#2a4f90", () => v.rect(8, 22, 24, 6), 1.6);
    }
    label(v, "mail", 20, 36, 9, "#ffffff");
  });
}

/** Ladder with the fox on it, 80×240; foot pivot at (16, 236). */
export function ladder(v: View, hang: boolean): Sprite {
  return v.sprite({ key: hang ? "ladder-hang" : "ladder-paint", width: 80, height: 240 }, () => {
    v.noFill();
    ink(v, 3);
    v.stroke("#8a5a3a");
    v.line(10, 238, 40, 6);
    v.line(34, 238, 64, 6);
    for (let i = 1; i < 12; i += 1) {
      const k = i / 12;
      v.line(10 + k * 30, 238 - k * 232, 34 + k * 30, 238 - k * 232);
    }
    v.push();
    v.translate(14, hang ? 18 : 56);
    poseBody(v, hang ? "painter-hang" : "painter-paint");
    v.pop();
    if (!hang) {
      // brush
      v.noFill();
      ink(v, 2.4);
      v.line(70, 92, 72, 72);
      inked(v, "#f7d65c", () => v.rect(68, 64, 8, 9), 1.4);
    }
  });
}

export function bucket(v: View): Sprite {
  return v.sprite({ key: "bucket", width: 32, height: 34 }, () => {
    inked(v, "#d6d6dc", () => v.polygon([[3, 8], [29, 8], [26, 32], [6, 32]]), 1.8);
    inked(v, "#f7d65c", () => v.ellipse(16, 9, 26, 7), 1.4);
    flat(v, "#f7d65c", () => v.rect(5, 12, 7, 10));
    label(v, "PAINT", 16, 24, 6.5);
  });
}

export function owl(v: View, awake: boolean): Sprite {
  return v.sprite({ key: awake ? "owl-awake" : "owl-asleep", width: 54, height: 60 }, () => paintOwlWindow(v, awake));
}

export function hydrant(v: View): Sprite {
  return v.sprite({ key: "hydrant", width: 28, height: 44 }, () => {
    inked(v, "#d8443a", () => v.path([["move", 6, 42], ["line", 6, 14], ["quad", 14, 2, 22, 14], ["line", 22, 42], ["close"]]), 2);
    inked(v, "#d8443a", () => v.rect(1, 20, 26, 7), 1.6);
    inked(v, "#b8302a", () => v.rect(3, 38, 22, 5), 1.4);
    flat(v, "#f6c7b8", () => v.rect(9, 14, 3, 20));
  });
}

export function dog(v: View, mode: "stand" | "wet"): Sprite {
  return v.sprite({ key: `dog-${mode}`, width: 74, height: 52 }, () => paintDog(v, mode));
}

/** Lamp post, 30×190, bulb centre at (15, 16). */
export function lamp(v: View, on: boolean): Sprite {
  return v.sprite({ key: on ? "lamp-on" : "lamp-off", width: 30, height: 190 }, () => {
    v.noFill();
    ink(v, 4);
    v.stroke("#2f3a4a");
    v.line(15, 30, 15, 186);
    inked(v, "#2f3a4a", () => v.rect(9, 176, 12, 12), 1.6);
    inked(v, on ? "#fff3b0" : "#dfe8ee", () => v.polygon([[6, 8], [24, 8], [21, 28], [9, 28]]), 2);
    inked(v, "#2f3a4a", () => v.polygon([[3, 8], [27, 8], [15, 1]]), 1.6);
  });
}

export function apple(v: View): Sprite {
  return v.sprite({ key: "apple", width: 14, height: 15 }, () => {
    inked(v, "#d8443a", () => v.circle(7, 9, 11), 1.2);
    flat(v, "#3f7a3a", () => v.ellipse(9, 2.5, 5, 3));
  });
}

export function pigeon(v: View, flap: boolean): Sprite {
  return v.sprite({ key: flap ? "pigeon-flap" : "pigeon", width: 26, height: 22 }, () => paintPigeon(v, flap));
}

export function snail(v: View, tucked: boolean): Sprite {
  return v.sprite({ key: tucked ? "snail-tucked" : "snail", width: 36, height: 24 }, () => paintSnail(v, tucked));
}

export function mole(v: View): Sprite {
  return v.sprite({ key: "mole", width: 40, height: 40 }, () => paintMole(v));
}

export function manhole(v: View): Sprite {
  return v.sprite({ key: "manhole", width: 62, height: 20 }, () => {
    inked(v, "#55545e", () => v.ellipse(31, 10, 58, 16), 1.8);
    v.noFill();
    ink(v, 1);
    v.ellipse(31, 10, 42, 10);
    v.line(14, 10, 48, 10);
  });
}

export function letter(v: View): Sprite {
  return v.sprite({ key: "letter", width: 18, height: 13 }, () => {
    inked(v, "#ffffff", () => v.rect(1, 1, 16, 11), 1.2);
    v.noFill();
    ink(v, 0.9);
    v.line(1, 1, 9, 7);
    v.line(17, 1, 9, 7);
    flat(v, "#d8443a", () => v.rect(12, 3, 3, 3));
  });
}

export function wheel(v: View): Sprite {
  return v.sprite({ key: "wheel", width: 30, height: 30 }, () => {
    inked(v, "#2b2b33", () => v.circle(15, 15, 27), 1.8);
    inked(v, "#c9c9d2", () => v.circle(15, 15, 12), 1.2);
    flat(v, "#2b2b33", () => v.rect(14, 9, 2, 12));
  });
}

/** The number 5 bus, 220×100 body (wheels drawn separately), facing right. */
export function bus(v: View): Sprite {
  return v.sprite({ key: "bus", width: 220, height: 100 }, () => {
    // passengers behind the glass
    inked(v, "#bfe2ee", () => v.rect(12, 14, 196, 34), 2);
    const heads = [["#f4b6b4", 34], ["#a8784e", 74], ["#f3eee6", 112], ["#8e8a9a", 148]] as const;
    for (const [c, x] of heads) {
      inked(v, c, () => v.circle(x, 40, 22), 1.4);
      flat(v, INK, () => {
        v.circle(x - 4, 38, 2.5);
        v.circle(x + 4, 38, 2.5);
      });
    }
    v.push();
    v.translate(176, 8);
    v.scale(0.55);
    paintFolk(v, DRIVER);
    v.pop();
    // body with window cut-outs: paint the body as four bands around the glass
    flat(v, "#f2b134", () => {
      v.rect(2, 2, 216, 12);
      v.rect(2, 48, 216, 46);
      v.rect(2, 2, 10, 92);
      v.rect(208, 2, 10, 92);
    });
    v.noFill();
    ink(v, 2.6);
    v.path([["move", 8, 2], ["line", 210, 2], ["quad", 218, 2, 218, 12], ["line", 218, 94], ["line", 2, 94], ["line", 2, 8], ["quad", 2, 2, 8, 2]]);
    ink(v, 1.6);
    for (const x of [56, 96, 134, 168]) v.line(x, 14, x, 48);
    inked(v, "#3a5a9a", () => v.rect(2, 60, 216, 8), 1.4);
    label(v, "5  ACORN LANE", 92, 80, 11, "#7a3b1a");
    inked(v, "#fff3b0", () => v.circle(212, 78, 10), 1.4);
    inked(v, "#d8443a", () => v.rect(2, 72, 6, 10), 1.2);
  });
}

/** A soft glint star for hover cues. */
export function glint(v: View): Sprite {
  return v.sprite({ key: "glint", width: 24, height: 24 }, () => {
    v.noStroke();
    v.fill(v.radialGradient(12, 12, 12, [[0, "rgba(255,255,220,0.95)"], [1, "rgba(255,255,220,0)"]]));
    v.circle(12, 12, 24);
    flat(v, "#fffbe0", () => {
      v.polygon([[12, 0], [14, 10], [24, 12], [14, 14], [12, 24], [10, 14], [0, 12], [10, 10]]);
    });
  });
}

/** A warm glow for lamps and windows, drawn with a screen blend. */
export function glow(v: View): Sprite {
  return v.sprite({ key: "glow", width: 160, height: 160 }, () => {
    v.noStroke();
    v.fill(v.radialGradient(80, 80, 80, [[0, "rgba(255,226,140,0.9)"], [0.4, "rgba(255,210,120,0.35)"], [1, "rgba(255,200,120,0)"]]));
    v.circle(80, 80, 160);
  });
}
