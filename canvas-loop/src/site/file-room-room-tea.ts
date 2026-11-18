// The still parts of the file room, drawn by hand: a faint floor and four
// separate cabinets standing in the dark, each with drawers, label holders and
// pulls. Every part is a cached picture, recorded once.
import type { Drawing, Picture, Style, Vec2, View } from "@ianbicking/canvas-loop";
import { corners, pencilHatch, penBox, penLine } from "./file-room-ink-tea.js";
import { CABS, CAB_W, FLOOR, ROWS, PITCH, cabAt, cabTop, hash, lampRim } from "./file-room-layout-tea.js";

export const CREAM = "#eadfc2";
export const BRASS = "#b08f4c";
const LABELS = ["A-C", "D-F", "G-J", "K-M", "N-P", "Q-S", "T-V", "W-Z", "1931", "1932", "1933", "1934", "Misc", "Paid", "Open", "Ref"] as const;

const WOOD: readonly string[] = ["#8c5a37", "#7e4f31", "#94623c", "#85553a"];
const STEEL: readonly string[] = ["#4c6068", "#445a62", "#526870", "#48606a"];
const bodyColour = (cab: number): string => (cabAt(cab).lamp === "banker" ? "#6a3f27" : "#34444a");

export interface FaceSpec {
  cab: number;
  row: number;
}

/** A drawer face centred on (0, 0): painted panel, grain strokes, hatched shadow, label holder and pull. */
export function drawerFace(v: View, spec: FaceSpec): Drawing {
  const { cab, row } = spec;
  const steel = cabAt(cab).lamp === "pendant";
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
  return v.picture({ key: `face-${spec.cab}-${spec.row}` }, () => drawerFace(v, spec));
}

/** The inside of a drawer seen from above, drawn at full depth: dark tray and a row of index cards. Anchored at its back edge. */
export function trayPicture(v: View): Picture {
  return v.picture({ key: "tray" }, () => [
    v.polygon([[-62, 0], [62, 0], [75, 28], [-75, 28]], { fill: "#1c1410" }),
    Array.from({ length: 13 }, (_, i) => {
      const x = -58 + i * 9.6;
      const h = 15 + hash(i * 3.1) * 8;
      return [
        v.rect(x - 4, 27 - h, 8, h, { fill: i % 5 === 2 ? "#d9c78f" : CREAM }),
        penBox(v, { x: x - 4, y: 27 - h, w: 8, h, seed: i + 1, weight: 1, off: 0.5 }),
        i % 4 === 1 && v.rect(x - 2, 27 - h - 2, 4, 4, { fill: i % 8 === 1 ? "#b8574a" : "#4f7aa8" }),
      ];
    }),
  ]);
}

function cabinet(v: View, c: number): Drawing {
  const x0 = -CAB_W / 2;
  const top = cabTop - FLOOR;
  const h = -top;
  const body = corners({ x: x0, y: top, w: CAB_W, h, seed: c + 60, off: 1.5 });
  const lit = bodyColour(c);
  return [
    // a smudge of shadow on the floor
    v.ellipse(4, 4, 100, 12, { fill: "rgba(0,0,0,0.5)" }),
    v.polygon(body, { fill: lit }),
    v.clip(body, [
      [0.2, 0.5, 0.8].map((f, i) => v.line(x0 - 4, top + h * f, x0 + CAB_W + 4, top + h * f + 3, { stroke: lit, weight: 26, brush: { preset: "bristle", lightJitter: 0.08, hueJitter: 6, opacity: 0.5 }, gesture: { wobble: 2, seed: c * 9 + i, faint: true } })),
    ]),
    pencilHatch(v, { clip: body, x: x0 + 110, y: top, w: 70, h, seed: c + 3, spacing: 6 }),
    penBox(v, { x: x0, y: top, w: CAB_W, h, seed: c + 20, weight: 3.4 }),
    penLine(v, { a: [x0 - 6, top - 1], b: [x0 + CAB_W + 6, top - 1], seed: c + 31, weight: 4.5 }),
    Array.from({ length: ROWS }, (_, row) => {
      const cy = top + 8 + row * PITCH + 36;
      return [v.rect(x0 + 10, cy - 36, 150, 72, { fill: "#0d0907" }), v.at({ translate: [0, cy] }, drawerFace(v, { cab: c, row }))];
    }),
    // plinth
    v.polygon(corners({ x: x0 + 4, y: -12, w: CAB_W - 8, h: 12, seed: c + 70, off: 1 }), { fill: "#241a14" }),
    penLine(v, { a: [x0 + 2, -12], b: [x0 + CAB_W - 2, -12], seed: c + 71, weight: 2 }),
  ];
}

/** Cabinet `c`, drawn around the middle of its base; its lamp's cord hangs from the dark above. */
export function cabinetPicture(v: View, c: number): Picture {
  return v.picture({ key: `cab-${c}`, paper: { scale: 3, contrast: 0.6, seed: c } }, () => [
    cabinet(v, c),
    cabAt(c).lamp === "pendant" && penLine(v, { a: [0, lampRim(c).y - 54 - FLOOR], b: [0, -FLOOR], seed: c + 90, weight: 2.4 }),
    cabAt(c).lamp === "banker" && bankerBase(v, c),
  ]);
}

function bankerBase(v: View, c: number): Drawing {
  const y = cabTop - FLOOR - 7;
  const pts: Vec2[] = [[-5, y], [5, y], [5, y - 40], [-5, y - 40]];
  return [
    v.polygon(corners({ x: -32, y: y - 9, w: 64, h: 9, seed: c + 80, off: 1 }), { fill: "#3a362a" }),
    penBox(v, { x: -32, y: y - 9, w: 64, h: 9, seed: c + 81, weight: 2 }),
    v.polygon(pts, { fill: BRASS }),
    penBox(v, { x: -5, y: y - 40, w: 10, h: 40, seed: c + 82, weight: 1.8 }),
  ];
}

/** A faint floor: a pale patch with a few pencil board lines, so lamplight has something to fall on. */
export function floorPicture(v: View): Picture {
  return v.picture({ key: "floor", width: 1600, height: 900, paper: { scale: 3, contrast: 0.6, seed: 11 } }, () => [
    v.ellipse(800, 840, 1000, 120, { fill: v.ellipseGradient(800, 840, 1000, 120, [[0, "#3a3138"], [0.5, "#2a242a"], [1, "rgba(30,26,30,0)"]]) }),
    Array.from({ length: 14 }, (_, i) => {
      const x = -200 + i * 150;
      return v.line(800 + (x - 800) * 0.35, FLOOR + 6, x, 900, { stroke: "rgba(15,10,10,0.6)", weight: 1.6, brush: { preset: "pencil", opacity: 0.7 }, gesture: { wobble: 1, seed: i + 1 } });
    }),
    [820, 860].map((y, i) => v.line(0, y, 1600, y + 2, { stroke: "rgba(15,10,10,0.5)", weight: 1.4, brush: { preset: "pencil", opacity: 0.6 }, gesture: { wobble: 1.4, seed: 30 + i } })),
  ]);
}

export const CABINET_COUNT = CABS.length;
