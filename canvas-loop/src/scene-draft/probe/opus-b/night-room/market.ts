// A row of three market stalls at dusk, painterly. Two vendors share one
// picture in different colours; the third holds a lantern whose flame glows.
// Scene API draft 2.1 probe (opus-b).
import type { BrushPreset, TextOptions } from "../../../../core/tea.js";
import type { Picture, Style, Vec2, View } from "../../../scene-api.js";

export interface Model {
  frame: number;
}

/** What varies between vendors who share one drawing. */
export interface Look {
  readonly robe: string;
  readonly trim: string;
  readonly hat: string;
  readonly skin: string;
}

export const VENDOR_W = 80;
export const VENDOR_H = 130;
/** Where the vendor's right shoulder sits in the picture, for an arm drawn outside it. */
export const SHOULDER: Vec2 = [56, 58];

const BRISTLE: BrushPreset = { preset: "bristle", load: 0.6, lightJitter: 0.08 };
const WASH: BrushPreset = { preset: "wash", opacity: 0.5 };
const INK: Style = { stroke: "#3a2a1e", weight: 2, brush: "ink", gesture: { pressure: "taper", wobble: 0.6 } };

const LOOKS: readonly Look[] = [
  { robe: "#3f6e8c", trim: "#d9c38a", hat: "#8c3f3f", skin: "#c99a74" },
  { robe: "#7a4a8c", trim: "#e3d6a8", hat: "#3f6e4a", skin: "#a8775a" },
];
const LANTERN_LOOK: Look = { robe: "#8c6a3f", trim: "#2f2a24", hat: "#2f2a24", skin: "#d2a27e" };

const AWNINGS: readonly (readonly [string, string])[] = [
  ["#c8553d", "#f2e3c6"],
  ["#4f7a5a", "#efe2c0"],
  ["#d9a441", "#7a3b2e"],
];

/** One vendor, standing, in picture coordinates (feet at the bottom centre). */
export function vendorPicture(v: View, look: Look): Picture {
  return v.picture({ key: "vendor", deps: [look.robe, look.trim, look.hat, look.skin], width: VENDOR_W, height: VENDOR_H }, () => {
    const robe: readonly Vec2[] = [[22, 56], [58, 56], [66, 128], [40, 132], [14, 128]];
    v.curve(robe, true, { fill: look.robe });
    v.curve(robe, true, { stroke: look.robe, weight: 14, brush: { ...BRISTLE, hueJitter: 6 } });
    v.line(40, 60, 40, 126, { stroke: look.trim, weight: 5, brush: "chalk" });
    // left arm, resting on the counter
    v.path(v.tube([[24, 60], [16, 88], [28, 98]], { width: 11 }), { fill: look.robe, ...INK });
    v.circle(30, 98, 5, { fill: look.skin });
    // head and hat
    v.circle(40, 38, 15, { fill: look.skin, ...INK });
    v.ellipse(40, 24, 22, 6, { fill: look.hat, stroke: look.hat, weight: 6, brush: BRISTLE });
    v.roundRect(28, 6, 24, 18, 6, { fill: look.hat });
    v.curve([[34, 40], [36, 42]], false, { ...INK, weight: 1.5 });
    v.curve([[44, 40], [46, 42]], false, { ...INK, weight: 1.5 });
  });
}

/** The arm that waves, drawn every frame (it moves, so it is not in the picture). */
export function waveArm(v: View, args: { look: Look; angle: number; seed: number }): void {
  const [sx, sy] = SHOULDER;
  const elbow: Vec2 = [sx + 14, sy + 6 - 10 * Math.sin(args.angle)];
  const hand: Vec2 = [elbow[0] + 10 * Math.cos(args.angle), elbow[1] - 22];
  v.path(v.tube([[sx, sy], elbow, hand], { width: 10 }), { fill: args.look.robe, ...INK, gesture: { seed: args.seed } });
  v.circle(hand[0], hand[1] - 3, 5, { fill: args.look.skin });
}

/** Posts and awning: behind the vendor. */
function stallBack(v: View, args: { x: number; colors: readonly [string, string] }): void {
  const { x, colors } = args;
  // posts
  v.line(x + 6, 90, x + 6, 300, { stroke: "#5a3e2b", weight: 8, brush: "bristle" });
  v.line(x + 154, 90, x + 154, 300, { stroke: "#5a3e2b", weight: 8, brush: "bristle" });
  // striped awning, scalloped edge
  for (let i = 0; i < 6; i += 1) {
    const sx = x + i * 27;
    v.polygon([[sx, 80], [sx + 27, 80], [sx + 30, 120], [sx - 3, 120]], { fill: colors[i % 2] ?? "#fff" });
    v.arc(sx + 13.5, 120, 13.5, 0, Math.PI, { fill: colors[i % 2] ?? "#fff" });
  }
  v.curve([[x - 4, 80], [x + 80, 74], [x + 166, 80]], false, { stroke: "#2b2018", weight: 6, brush: BRISTLE });
}

/** The counter: in front of the vendor. */
function stallFront(v: View, x: number): void {
  // counter, with a wash shadow under its lip
  v.rect(x, 210, 160, 90, { fill: "#8a6448" });
  v.line(x + 4, 220, x + 156, 220, { stroke: "#3a2a1e", weight: 26, brush: WASH });
  v.rect(x - 4, 204, 168, 10, { fill: "#a87f5e", stroke: "#3a2a1e", weight: 2, brush: "pencil" });
}

function produce(v: View, x: number): void {
  for (let i = 0; i < 9; i += 1) {
    const cx = x + 20 + (i % 5) * 26 + (i >= 5 ? 13 : 0);
    const cy = i >= 5 ? 186 : 198;
    const hue = ["#c0392b", "#e67e22", "#d4ac0d"][i % 3] ?? "#c0392b";
    v.circle(cx, cy, 10, { fill: hue, stroke: "#3a1f12", weight: 2, brush: "pencil", gesture: { seed: i } });
  }
}

/** The lantern and its flame, around (x, y) = the top of the handle. */
function lantern(v: View, args: { x: number; y: number; flicker: number }): void {
  const { x, y, flicker } = args;
  v.line(x, y, x, y + 10, { stroke: "#2b2018", weight: 2 });
  v.roundRect(x - 9, y + 10, 18, 24, 3, { fill: "rgba(255,230,160,0.35)", stroke: "#2b2018", weight: 2 });
  v.group({ name: "flame", blend: "add", effects: { glow: { blur: 18 + 4 * flicker, color: "#ffb347", strength: 3 } } }, () => {
    v.ellipse(x, y + 23, 4 + flicker, 7 + 2 * flicker, { fill: "#ffd76a" });
    v.ellipse(x, y + 25, 2, 4, { fill: "#fff6d8" });
  });
}

export function draw(v: View, model: Model): void {
  const f = model.frame;
  v.background("#2d3047");
  // sky: dusk gradient, then the whole market as one watercolour
  v.rect(0, 0, v.width, 200, { fill: v.linearGradient(0, 0, 0, 200, [[0, "#3b3f6b"], [1, "#e0a46e"]]) });

  // Two static pictures, because the vendors stand between them.
  const back = v.picture({ key: "market-back", width: v.width, height: v.height }, () => {
    v.paper({ scale: 4, contrast: 0.6 });
    v.rect(0, 280, v.width, 40, { fill: "#6b5a48" });
    for (const [i, colors] of AWNINGS.entries()) stallBack(v, { x: 20 + i * 180, colors });
  });
  const front = v.picture({ key: "market-front", width: v.width, height: v.height }, () => {
    v.paper({ scale: 4, contrast: 0.6 });
    for (let i = 0; i < AWNINGS.length; i += 1) stallFront(v, 20 + i * 180);
  });

  v.group({ name: "market", effects: { wash: { granulate: 0.5, edges: 0.6, blotch: 0.3, bleed: 2 }, paper: 0.4 } }, () => {
    v.place(back, 0, 0);
    const vendors: readonly { look: Look; x: number; phase: number }[] = [
      { look: LOOKS[0] ?? LANTERN_LOOK, x: 60, phase: 0 },
      { look: LOOKS[1] ?? LANTERN_LOOK, x: 240, phase: 1.7 },
      { look: LANTERN_LOOK, x: 420, phase: 3.1 },
    ];
    for (const [i, vendor] of vendors.entries()) {
      const breath = 1 + 0.015 * Math.sin(f / 22 + vendor.phase);
      v.at({ translate: [vendor.x + VENDOR_W / 2, 260], scale: [1, breath] }, () => {
        v.at({ translate: [-VENDOR_W / 2, -VENDOR_H] }, () => {
          v.place(vendorPicture(v, vendor.look), 0, 0);
          if (i === 1) waveArm(v, { look: vendor.look, angle: Math.sin(f / 6) * 0.9, seed: 7 });
        });
      });
    }
    v.place(front, 0, 0);
    for (let i = 0; i < 3; i += 1) produce(v, 20 + i * 180);
  });

  // the lantern sits outside the wash so its glow stays clean
  const sway = Math.sin(f / 30) * 0.12;
  v.at({ translate: [420 + 72, 260 - VENDOR_H + 40], rotate: sway }, () => {
    lantern(v, { x: 0, y: 0, flicker: 0.5 + 0.5 * Math.sin(f * 1.3) * Math.sin(f * 0.37) });
  });

  const label: TextOptions = { size: 16, font: "Georgia, serif", fill: "#f6ead2", align: "center", halo: "#2d3047" };
  v.text("Night Market", { x: v.width / 2, y: 18 }, label);
}
