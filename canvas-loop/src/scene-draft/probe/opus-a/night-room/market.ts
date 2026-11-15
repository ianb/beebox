// A market stall row: three vendors behind painted stalls. All three share one
// vendor drawing in different colours; the middle one holds a lantern whose
// flame glows. Vendors breathe, and the right one waves.
import type { BrushPreset, DeepReadonly, Msg } from "../../../../core/tea.js";
import type { Picture, Style, Vec2, View } from "../../../scene-api.js";

export const canvas = { width: 720, height: 420 };

export interface Model {
  readonly frame: number;
}

export function init(): Model {
  return { frame: 0 };
}

export function update(model: DeepReadonly<Model>, msg: Msg): Model {
  return msg.type === "tick" ? { frame: msg.frame } : model;
}

// --- The vendor: one drawing, many looks ---------------------------------------------

/** A vendor's colours. A `type`, not an `interface`, so it is assignable to `Dep`. */
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- an interface has no index signature, so it is not assignable to Dep
export type Look = {
  readonly coat: string;
  readonly apron: string;
  readonly skin: string;
  readonly hat: string;
};

export const FIGURE_W = 120;
export const FIGURE_H = 200;
/** Where the free arm hangs from, in the vendor picture's coordinates. */
export const SHOULDER: Vec2 = [86, 84];

const OUTLINE = "#3b2a1f";
const COAT_BRUSH: BrushPreset = { preset: "bristle", load: 0.6, lightJitter: 0.08 };
const INK: Style = { stroke: OUTLINE, weight: 2, brush: "ink", gesture: { pressure: "taper", wobble: 0.6 } };

/**
 * The vendor without the free arm, in its own box (0..120, 0..200), feet at the
 * bottom. `castsShadow` is a dep because a lit room wants a material and an
 * unlit market would warn about one.
 */
export function vendorPicture(v: View, options: { readonly look: Look; readonly castsShadow: boolean }): Picture {
  const { look, castsShadow } = options;
  return v.picture({ key: "vendor", deps: [look, castsShadow], width: FIGURE_W, height: FIGURE_H }, () => {
    const solid: Style = castsShadow ? { material: { castsShadow: true, bevel: 4, relief: 0.3 } } : {};
    const torso: Vec2[] = [[30, 200], [26, 128], [34, 88], [60, 76], [86, 88], [94, 128], [90, 200]];
    v.curve(torso, true, { ...solid, fill: look.coat, stroke: look.coat, weight: 10, brush: COAT_BRUSH });
    v.polygon([[42, 112], [78, 112], [84, 200], [36, 200]], { ...solid, fill: look.apron });
    v.line(44, 112, 76, 112, { ...INK, weight: 1.5 });
    // Resting arm, down the near side.
    const arm = v.tube([[36, 90], [28, 130], [40, 160]], { width: 14, profile: [[0, 1], [1, 0.8]] });
    v.path(arm, { ...solid, fill: look.coat, stroke: OUTLINE, weight: 1.5, brush: "ink" });
    v.circle(41, 164, 7, { ...solid, fill: look.skin, stroke: OUTLINE, weight: 1.2, brush: "ink" });
    // Neck and head.
    v.rect(54, 62, 12, 16, { ...solid, fill: look.skin });
    v.circle(60, 46, 20, { ...solid, fill: look.skin, stroke: OUTLINE, weight: 2, brush: "ink" });
    v.circle(53, 44, 1.8, { fill: OUTLINE });
    v.circle(67, 44, 1.8, { fill: OUTLINE });
    v.arc(60, 50, 7, 0.3, Math.PI - 0.3, { ...INK, weight: 1.4 });
    v.circle(50, 52, 4, { fill: "rgba(220,90,80,0.25)" });
    v.circle(70, 52, 4, { fill: "rgba(220,90,80,0.25)" });
    // Hat: brim and crown.
    v.ellipse(60, 30, 30, 6, { ...solid, fill: look.hat, stroke: OUTLINE, weight: 1.5, brush: "ink" });
    v.roundRect(44, 8, 32, 22, 6, { ...solid, fill: look.hat, stroke: OUTLINE, weight: 1.5, brush: "ink" });
  });
}

/** The free arm, from the shoulder: `angle` 0 hangs down, negative swings it forward and up. */
export function drawArm(v: View, { look, angle }: { readonly look: Look; readonly angle: number }): void {
  v.at({ translate: SHOULDER, rotate: angle }, () => {
    const arm = v.tube([[0, 0], [4, 28], [2, 54]], { width: 13, profile: [[0, 1], [1, 0.8]] });
    v.path(arm, { fill: look.coat, stroke: OUTLINE, weight: 1.5, brush: "ink" });
    v.circle(2, 58, 7, { fill: look.skin, stroke: OUTLINE, weight: 1.2, brush: "ink" });
  });
}

// --- Stalls ----------------------------------------------------------------------------

const STALL_W = 200;
const STALL_H = 260;

function stallBack(v: View, awning: readonly [string, string]): Picture {
  return v.picture({ key: "stall-back", deps: [awning], width: STALL_W, height: STALL_H }, () => {
    v.line(14, 40, 14, 250, { stroke: "#6b4a2b", weight: 10, brush: "bristle" });
    v.line(186, 40, 186, 250, { stroke: "#6b4a2b", weight: 10, brush: "bristle" });
    const stripes = 6;
    const w = (STALL_W + 20) / stripes;
    for (let i = 0; i < stripes; i += 1) {
      const x = -10 + i * w;
      const color = i % 2 === 0 ? awning[0] : awning[1];
      v.path([["move", x, 0], ["line", x + w, 0], ["line", x + w, 46], ["quad", x + w / 2, 62, x, 46], ["close"]], { fill: color });
      v.line(x + w / 2, 4, x + w / 2, 50, { stroke: color, weight: 14, brush: { preset: "bristle", lightJitter: 0.1 } });
    }
    v.line(-10, 2, STALL_W + 10, 2, { stroke: OUTLINE, weight: 3, brush: "ink" });
  });
}

const FRUIT: readonly (readonly [number, string])[] = [
  [24, "#d94a3a"], [44, "#e8902c"], [64, "#d94a3a"], [84, "#9bbf3c"], [104, "#e8902c"],
  [124, "#d94a3a"], [144, "#9bbf3c"], [164, "#e8902c"], [180, "#d94a3a"],
];

function stallFront(v: View, wood: string): Picture {
  return v.picture({ key: "stall-front", deps: [wood], width: STALL_W, height: STALL_H }, () => {
    v.rect(0, 170, STALL_W, 90, { fill: wood, stroke: OUTLINE, weight: 2, brush: "ink" });
    for (let y = 186; y < 256; y += 16) {
      v.line(6, y, STALL_W - 6, y + 2, { stroke: "rgba(60,35,20,0.35)", weight: 26, brush: "wash" });
    }
    for (const [x, color] of FRUIT) {
      v.circle(x, 164, 10, { fill: color, stroke: color, weight: 5, brush: { preset: "chalk", hueJitter: 10 } });
      v.circle(x - 3, 160, 3, { fill: "rgba(255,255,240,0.6)" });
    }
  });
}

// --- The scene -------------------------------------------------------------------------

const VENDORS: readonly { readonly look: Look; readonly awning: readonly [string, string]; readonly wood: string }[] = [
  { look: { coat: "#3d6e8f", apron: "#efe6d0", skin: "#e8b58f", hat: "#2a3d52" }, awning: ["#c8423b", "#f1e3c8"], wood: "#a0683c" },
  { look: { coat: "#7a4e8a", apron: "#f2d9a0", skin: "#b8825c", hat: "#4a2d55" }, awning: ["#3f7f5a", "#f1e3c8"], wood: "#8a5a34" },
  { look: { coat: "#a8532e", apron: "#e6efe0", skin: "#f0c8a4", hat: "#5a3320" }, awning: ["#2f5f8f", "#f6d77a"], wood: "#9c6a40" },
];
const STALL_X = (i: number): number => 30 + i * 230;
const STALL_TOP = 90;
const FEET_Y = 335;

/** The transform a vendor stands in: feet anchored, breathing by a small vertical scale. */
function standing(v: View, a: { readonly i: number; readonly frame: number; readonly body: () => void }): void {
  const breath = 1 + 0.012 * Math.sin(a.frame * 0.07 + a.i * 2.1);
  v.at({ translate: [STALL_X(a.i) + STALL_W / 2, FEET_Y], scale: [1, breath] }, () => {
    v.at({ translate: [-FIGURE_W / 2, -FIGURE_H] }, a.body);
  });
}

const LANTERN_ARM = -1.15;

/** The lantern in the middle vendor's hand; `part` picks the body or the flame, drawn in separate passes. */
function lantern(v: View, { frame, part }: { readonly frame: number; readonly part: "body" | "flame" }): void {
  v.at({ translate: SHOULDER, rotate: LANTERN_ARM }, () => {
    v.at({ translate: [2, 60], rotate: -LANTERN_ARM + 0.06 * Math.sin(frame * 0.05) }, () => {
      if (part === "body") {
        v.line(0, 0, 0, 10, { stroke: OUTLINE, weight: 1.5 });
        v.roundRect(-11, 10, 22, 30, 4, { fill: "rgba(255,230,170,0.35)", stroke: "#2b2b2b", weight: 2.5, brush: "ink" });
        v.rect(-13, 38, 26, 5, { fill: "#2b2b2b" });
        return;
      }
      const s = 1 + 0.12 * Math.sin(frame * 0.6) + 0.06 * Math.sin(frame * 1.7);
      const flame: Vec2[] = [[0, 34], [-4, 28], [0, 34 - 14 * s], [4, 28]];
      v.curve(flame, true, { fill: "#ffd36b", blend: "add", effects: { glow: { blur: 16, color: "#ffab40", strength: 3 } } });
      v.circle(0, 30, 2.5, { fill: "#fff6d8" });
    });
  });
}

export function draw(v: View, model: DeepReadonly<Model>): void {
  v.background("#f3ead8");
  v.group({ name: "market", effects: { wash: { granulate: 0.5, edges: 0.6, blotch: 0.3, bleed: 1.5 }, paper: 0.35 } }, () => {
    v.rect(0, 0, 720, 300, { fill: v.linearGradient(0, 0, 0, 300, [[0, "#f6d9a8"], [1, "#e9b98a"]]) });
    v.rect(0, 330, 720, 90, { fill: "#b89a74" });
    for (let x = 0; x < 720; x += 60) v.line(x, 360, x + 50, 362, { stroke: "rgba(80,60,40,0.4)", weight: 30, brush: "wash" });
    for (const [i, vendor] of VENDORS.entries()) {
      v.place(stallBack(v, vendor.awning), STALL_X(i), STALL_TOP);
      const figure = vendorPicture(v, { look: vendor.look, castsShadow: false });
      const body = (): void => {
        v.place(figure, 0, 0);
        if (i === 1) {
          drawArm(v, { look: vendor.look, angle: LANTERN_ARM });
          lantern(v, { frame: model.frame, part: "body" });
        } else if (i === 2) {
          drawArm(v, { look: vendor.look, angle: -2.5 + 0.45 * Math.sin(model.frame * 0.18) });
        } else {
          drawArm(v, { look: vendor.look, angle: 0.08 * Math.sin(model.frame * 0.05) });
        }
      };
      standing(v, { i, frame: model.frame, body });
      v.place(stallFront(v, vendor.wood), STALL_X(i), STALL_TOP);
    }
  });
  // The flame after the washed group, so the wash does not paint over its light.
  standing(v, { i: 1, frame: model.frame, body: () => lantern(v, { frame: model.frame, part: "flame" }) });
  const [lx, ly] = [STALL_X(1) + STALL_W / 2 + 40, 190];
  v.circle(lx, ly, 90, { fill: v.radialGradient(lx, ly, 90, [[0, "rgba(255,190,90,0.35)"], [1, "rgba(255,190,90,0)"]]), blend: "screen" });
}
