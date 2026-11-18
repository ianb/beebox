// The still parts of the file room, drawn by hand: a faint floor and four
// separate cabinets standing in the dark, each with drawers, label holders and
// pulls. Every part is a cached picture, recorded once.
import type { Drawing, Picture, Style, View } from "@ianbicking/canvas-loop";
import { corners, pencilHatch, penBox, penLine } from "./file-room-ink-tea.js";
import { hash } from "./file-room-layout-tea.js";

export const CREAM = "#eadfc2";
export const BRASS = "#b08f4c";
const LABELS = ["A-C", "D-F", "G-J", "K-M", "N-P", "Q-S", "T-V", "W-Z", "1931", "1932", "1933", "1934", "Misc", "Paid", "Open", "Ref"] as const;

const WOOD: readonly string[] = ["#8c5a37", "#7e4f31", "#94623c", "#85553a"];
const STEEL: readonly string[] = ["#3c4c52", "#364650", "#42545a", "#3a4a54"];
const bodyColour = (variant: number): string => (variant < 2 ? "#6a3f27" : "#2e3b40");
/** Old-size art units: a cabinet is 170 wide and 332 tall, a drawer face 150 by 72. */
const CAB_W = 170;
const CAB_H = 332;
const PITCH = 78;
const ROWS = 4;

export interface FaceSpec {
  /** Cabinet look 0..3: wood or steel, two each. */
  variant: number;
  row: number;
}

/** A drawer face centred on (0, 0): painted panel, grain strokes, hatched shadow, label holder and pull. */
export function drawerFace(v: View, spec: FaceSpec): Drawing {
  const { variant: cab, row } = spec;
  const steel = cab >= 2;
  const seed = cab * 10 + row + 1;
  const tones = steel ? STEEL : WOOD;
  const tone = (i: number): string => tones[(seed + i) % tones.length] ?? "#7e4f31";
  const outer = corners({ x: -75, y: -36, w: 150, h: 72, seed, off: 1.8 });
  const grain: Style = { weight: 15, brush: { preset: "bristle", load: 0.55, bristles: 9, lightJitter: 0.07, hueJitter: 5, opacity: 0.55 } };
  return [
    v.polygon(outer, { fill: tone(0) }),
    v.clip(outer, [
      [-26, -5, 17].map((y, i) => v.line(-80, y + i, 80, y - 1 + i, { ...grain, stroke: tone(i + 1), gesture: { wobble: 1.6, seed: seed * 7 + i, faint: true } })),
    ]),
    pencilHatch(v, { clip: outer, x: -10, y: -36, w: 100, h: 72, seed, spacing: 7 }),
    penBox(v, { x: -75, y: -36, w: 150, h: 72, seed, weight: 2.8 }),
    penBox(v, { x: -64, y: -26, w: 128, h: 52, seed: seed + 40, weight: 1.3, color: "rgba(23,17,13,0.55)", off: 1.2 }),
    // label holder: brass frame, a card with a letter
    v.polygon(corners({ x: -40, y: -31, w: 56, h: 20, seed: seed + 3, off: 1 }), { fill: BRASS }),
    v.polygon(corners({ x: -36, y: -28, w: 48, h: 14, seed: seed + 4, off: 0.8 }), { fill: CREAM }),
    penBox(v, { x: -40, y: -31, w: 56, h: 20, seed: seed + 9, weight: 1.6 }),
    v.text(LABELS[(cab * 5 + row * 3) % LABELS.length] ?? "A-C", { x: -12, y: -21 }, { size: 12, font: "Georgia, serif", style: "italic", fill: "#2a1d14", align: "center", valign: "middle" }),
    // pull
    v.polygon(corners({ x: -30, y: 6, w: 60, h: 10, seed: seed + 6, off: 1 }), { fill: BRASS }),
    penBox(v, { x: -30, y: 6, w: 60, h: 10, seed: seed + 7, weight: 1.8 }),
    penLine(v, { a: [-28, 19], b: [28, 19], seed: seed + 8, weight: 2.2, color: "rgba(23,17,13,0.8)" }),
  ];
}

/** The picture of one drawer face, for the drawer that slides out. */
export function facePicture(v: View, spec: FaceSpec): Picture {
  return v.picture({ key: `face-${spec.variant}-${spec.row}` }, () => drawerFace(v, spec));
}

/** Index of the card at the clerk's side of a drawer (-1: left, 1: right): the one they take or file. */
export const cardIndex = (side: -1 | 1): number => (side === -1 ? 3 : 9);
/** Where a tray card stands, along the tray in old-size units from its centre. */
export const cardX = (i: number): number => -58 + i * 9.6;

/**
 * The inside of a drawer seen from above, at full depth: dark tray and a row of
 * index cards, with one card missing when `gap` names its index. Anchored at the back edge.
 */
export function trayPicture(v: View, gap: number): Picture {
  return v.picture({ key: `tray-${gap}` }, () => [
    v.polygon([[-62, 0], [62, 0], [75, 28], [-75, 28]], { fill: "#1c1410" }),
    Array.from({ length: 13 }, (_, i) => {
      const x = cardX(i);
      const h = 15 + hash(i * 3.1) * 8;
      return (
        i !== gap && [
          v.rect(x - 4, 27 - h, 8, h, { fill: i % 5 === 2 ? "#d9c78f" : CREAM }),
          penBox(v, { x: x - 4, y: 27 - h, w: 8, h, seed: i + 1, weight: 1, off: 0.5 }),
          i % 4 === 1 && v.rect(x - 2, 27 - h - 2, 4, 4, { fill: i % 8 === 1 ? "#b8574a" : "#4f7aa8" }),
        ]
      );
    }),
  ]);
}

function cabinet(v: View, c: number): Drawing {
  const x0 = -CAB_W / 2;
  const top = -CAB_H;
  const body = corners({ x: x0, y: top, w: CAB_W, h: CAB_H, seed: c + 60, off: 1.5 });
  const lit = bodyColour(c);
  return [
    v.ellipse(4, 4, 100, 12, { fill: "rgba(0,0,0,0.5)" }),
    v.polygon(body, { fill: lit }),
    v.clip(body, [
      [0.2, 0.5, 0.8].map((f, i) => v.line(x0 - 4, top + CAB_H * f, x0 + CAB_W + 4, top + CAB_H * f + 3, { stroke: lit, weight: 26, brush: { preset: "bristle", lightJitter: 0.08, hueJitter: 6, opacity: 0.5 }, gesture: { wobble: 2, seed: c * 9 + i, faint: true } })),
    ]),
    pencilHatch(v, { clip: body, x: x0 + 110, y: top, w: 70, h: CAB_H, seed: c + 3, spacing: 6 }),
    penBox(v, { x: x0, y: top, w: CAB_W, h: CAB_H, seed: c + 20, weight: 3.4 }),
    penLine(v, { a: [x0 - 6, top - 1], b: [x0 + CAB_W + 6, top - 1], seed: c + 31, weight: 4.5 }),
    Array.from({ length: ROWS }, (_, row) => {
      const cy = top + 8 + row * PITCH + 36;
      return [v.rect(x0 + 10, cy - 36, 150, 72, { fill: "#0d0907" }), v.at({ translate: [0, cy] }, drawerFace(v, { variant: c, row }))];
    }),
    v.polygon(corners({ x: x0 + 4, y: -12, w: CAB_W - 8, h: 12, seed: c + 70, off: 1 }), { fill: "#241a14" }),
    penLine(v, { a: [x0 + 2, -12], b: [x0 + CAB_W - 2, -12], seed: c + 71, weight: 2 }),
  ];
}

function bankerBase(v: View, c: number): Drawing {
  const y = -CAB_H - 7;
  return [
    v.polygon(corners({ x: -32, y: y - 9, w: 64, h: 9, seed: c + 80, off: 1 }), { fill: "#3a362a" }),
    penBox(v, { x: -32, y: y - 9, w: 64, h: 9, seed: c + 81, weight: 2 }),
    v.polygon([[-5, y], [5, y], [5, y - 40], [-5, y - 40]], { fill: BRASS }),
    penBox(v, { x: -5, y: y - 40, w: 10, h: 40, seed: c + 82, weight: 1.8 }),
  ];
}

/** One cabinet look, drawn around the middle of its base; wood ones (0, 1) carry a banker's lamp base. */
export function cabinetPicture(v: View, variant: number): Picture {
  return v.picture({ key: `cab-${variant}`, paper: { scale: 3, contrast: 0.6, seed: variant } }, () => [cabinet(v, variant), variant < 2 && bankerBase(v, variant)]);
}

/** A faint patch of floor under a level, with a few pencil board lines, so lamplight has something to fall on. */
export function floorPicture(v: View): Picture {
  return v.picture({ key: "floor", width: 1600, height: 200, paper: { scale: 3, contrast: 0.6, seed: 11 } }, () => [
    v.ellipse(800, 100, 900, 90, { fill: v.ellipseGradient(800, 100, 900, 90, [[0, "#352d33"], [0.5, "#272127"], [1, "rgba(30,26,30,0)"]]) }),
    Array.from({ length: 14 }, (_, i) => v.line(800 + (i - 6.5) * 40, 30, -100 + i * 140, 190, { stroke: "rgba(15,10,10,0.6)", weight: 1.5, brush: { preset: "pencil", opacity: 0.7 }, gesture: { wobble: 1, seed: i + 1 } })),
  ]);
}

/** The plank platform a level stands on: top edge at y = 0, a front board below. */
export function platformPicture(v: View): Picture {
  return v.picture({ key: "platform", width: 1600, height: 30, paper: { scale: 3, contrast: 0.6, seed: 12 } }, () => [
    v.polygon([[-10, 0], [1610, 0], [1610, 18], [-10, 18]], { fill: "#3a2c22" }),
    penLine(v, { a: [-10, 1], b: [1610, 2], seed: 90, weight: 3 }),
    penLine(v, { a: [-10, 18], b: [1610, 17], seed: 91, weight: 2.4 }),
    Array.from({ length: 40 }, (_, i) => penLine(v, { a: [i * 41 + hash(i) * 10, 2], b: [i * 41 + hash(i) * 10 + 2, 17], seed: 92 + i, weight: 1.2, color: "rgba(23,17,13,0.6)" })),
  ]);
}

/** A ladder between two levels, hung from the top at y = 0, `height` pixels tall. */
export function ladderPicture(v: View, height: number): Picture {
  return v.picture({ key: `ladder-${Math.round(height)}`, paper: { scale: 3, contrast: 0.6, seed: 13 } }, () => [
    [-17, 17].map((x, i) => v.line(x, 0, x + (i === 0 ? 1.5 : -1.5), height, { stroke: "#5a4430", weight: 6, brush: { preset: "bristle", load: 0.6, lightJitter: 0.06, opacity: 0.9 }, gesture: { wobble: 1.2, seed: 95 + i } })),
    [-17, 17].map((x, i) => penLine(v, { a: [x, 0], b: [x, height], seed: 97 + i, weight: 2.2 })),
    Array.from({ length: Math.floor(height / 26) }, (_, i) => penLine(v, { a: [-17, 14 + i * 26], b: [17, 14 + i * 26 + 1], seed: 100 + i, weight: 3 })),
  ]);
}
