// Walk styles from motion capture, and clothes on their own skeletons.
// sheet=styles: sixteen walkers on treadmills (the floor slides under them at
// their own speed), twelve acted walks, a jog, a run and two blends.
// sheet=clothes: a skirt, a long coat walking and running, a person drawn without
// limbs, crossing a room at the rooms' scale; below, the garments' skeletons.
import type { DeepReadonly, Msg, ParamsDecl, ParamValues, View } from "@ianbicking/canvas-loop";
import { CLIPS } from "./clips-tea.js";
import type { ClipName } from "./clips-tea.js";
import { cadence, progress, strideLength } from "./gait-tea.js";
import type { Gait } from "./gait-tea.js";
import { person } from "./figure-tea.js";
import type { Outfit } from "./figure-tea.js";

export const params = {
  sheet: { type: "select", options: ["styles", "clothes"], default: "styles", label: "Sheet" },
} as const satisfies ParamsDecl;

export const canvas = { width: 1280, height: 1000 };

export interface Model {
  frame: number;
}
export function init(): Model {
  return { frame: 0 };
}
export function update(model: DeepReadonly<Model>, msg: Msg): Model {
  switch (msg.type) {
    case "tick":
      return { frame: model.frame + 1 };
    case "mousedown":
    case "mouseup":
    case "mousemove":
    case "keydown":
    case "keyup":
    case "param":
    case "trigger":
      return model;
  }
}

const JUMPSUIT: Outfit = { top: "#3a6a9a", legs: "#3a6a9a", shoes: "#1e1812", skin: "#c58a62", hair: "#2e1d15", collar: "#e8b83a", seed: 900 };
const speedOf = (g: Gait): number => strideLength(g) * cadence(g);
const rectPath = (v: View, x: number, y: number, w: number, h: number): ReturnType<View["curvePath"]> => v.curvePath([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], true);

// --- Styles ------------------------------------------------------------------------------

interface Cell {
  label: string;
  gait: (sec: number) => Gait;
  outfit?: Partial<Outfit>;
}
const one = (n: ClipName): ((sec: number) => Gait) => () => [[n, 1]];
const CELLS: Cell[] = [
  { label: "normal", gait: one("normal") },
  { label: "confident (\"macho\")", gait: one("confident"), outfit: { top: "#8a3a2a", legs: "#8a3a2a" } },
  { label: "swagger (\"too cool\")", gait: one("swagger"), outfit: { top: "#2a2a30", legs: "#2a2a30" } },
  { label: "lavish", gait: one("lavish"), outfit: { top: "#8a5aa0", legs: "#8a5aa0", hairdo: "bun" } },
  { label: "cool", gait: one("cool"), outfit: { top: "#3a7a7a", legs: "#3a7a7a" } },
  { label: "quick", gait: one("quick"), outfit: { top: "#3a8a4a", legs: "#3a8a4a", hairdo: "ponytail", hair: "#a04a20" } },
  { label: "shy", gait: one("shy"), outfit: { top: "#c0a050", legs: "#c0a050", hairdo: "ponytail" } },
  { label: "scared", gait: one("scared"), outfit: { top: "#8a8a7a", legs: "#8a8a7a" } },
  { label: "sad", gait: one("sad"), outfit: { top: "#5a6a8a", legs: "#5a6a8a" } },
  { label: "depressed", gait: one("depressed"), outfit: { top: "#6a6a6a", legs: "#6a6a6a", hair: "#8a8a84" } },
  { label: "achey", gait: one("achey"), outfit: { top: "#7a6a3a", legs: "#7a6a3a", hair: "#c8c8c0" } },
  { label: "hurt leg", gait: one("hurtLeg"), outfit: { top: "#6a4a3a", legs: "#6a4a3a" } },
  { label: "jog", gait: one("jog"), outfit: { top: "#c84a3a", legs: "#2a2a40", hairdo: "ponytail", hair: "#d8b060" } },
  { label: "run", gait: one("run"), outfit: { top: "#e8b83a", legs: "#2a2a40" } },
  { label: "blend: half sad, half confident", gait: () => [["sad", 0.5], ["confident", 0.5]], outfit: { top: "#6a5a8a", legs: "#6a5a8a" } },
  {
    label: "cheering up: depressed → confident",
    gait: (sec) => {
      const k = 0.5 - 0.5 * Math.cos((sec / 8) * Math.PI * 2);
      const w = Math.round(k * 10) / 10;
      return [["depressed", 1 - w], ["confident", w]];
    },
    outfit: { top: "#4a8a8a", legs: "#4a8a8a" },
  },
];

function cell(v: View, c: Cell, i: number, sec: number): void {
  const w = 320, h = 250, x0 = (i % 4) * w, y0 = Math.floor(i / 4) * h;
  const g = c.gait(sec);
  const pr = progress(g, sec);
  const s = 92, ground = y0 + h - 34, cx = x0 + w / 2 - 10;
  v.clip(rectPath(v, x0, y0, w, h), () => {
    v.rect(x0, y0, w, h, { fill: i % 2 === Math.floor(i / 4) % 2 ? "#ddd2b8" : "#d4c8ac" });
    v.rect(x0, ground, w, h - (ground - y0), { fill: "#b9ab8e" });
    // The floor slides back under them at exactly the speed their feet push it.
    const off = (pr.x * s) % (0.5 * s);
    for (let gx = -off; gx < w; gx += 0.5 * s) v.line(x0 + gx, ground, x0 + gx - 14, ground + 22, { stroke: "rgba(60,40,20,0.35)", weight: 1.5 });
    person(v, g, pr.phase, speedOf(g), { x: cx, y: ground, s, facing: 1 }, { ...JUMPSUIT, ...c.outfit, seed: 900 + i * 40 });
  });
  v.line(x0, y0, x0, y0 + h, { stroke: "rgba(0,0,0,0.25)", weight: 1 });
  v.line(x0, y0, x0 + w, y0, { stroke: "rgba(0,0,0,0.25)", weight: 1 });
  v.text(c.label, { x: x0 + 10, y: y0 + 8 }, { size: 13, fill: "#2a2420", align: "left", valign: "top", style: "bold" });
  v.text(`${speedOf(g).toFixed(1)} m/s · ${cadence(g).toFixed(2)} strides/s`, { x: x0 + 10, y: y0 + 26 }, { size: 11, fill: "#5a4e44", align: "left", valign: "top" });
  const take = g.length === 1 && g[0] ? CLIPS[g[0][0]].take : "";
  if (take) v.text(`CMU ${take}`, { x: x0 + w - 8, y: y0 + h - 8 }, { size: 9, fill: "#5a4e44", align: "right", valign: "bottom" });
}

function styles(v: View, sec: number): void {
  for (const [i, c] of CELLS.entries()) cell(v, c, i, sec);
}

// --- Clothes -----------------------------------------------------------------------------

interface Walker {
  label: string;
  gait: Gait;
  depth: number;
  start: number;
  outfit: Outfit;
}
const PXM = 145, WALL = 300;
const WALKERS: Walker[] = [
  { label: "long coat, confident", gait: [["confident", 1]], depth: 1.0, start: 0.5, outfit: { top: "#d8d0c0", legs: "#2a2a30", shoes: "#3a2418", skin: "#b07850", hair: "#1a1410", coat: "#6a5040", seed: 1300 } },
  { label: "skirt and ponytail, lavish", gait: [["lavish", 1]], depth: 1.8, start: 6, outfit: { top: "#e8d8b0", legs: "#c58a62", shoes: "#8a2a2a", skin: "#c58a62", hair: "#5a2a14", hairdo: "ponytail", skirt: "#3a7a6a", seed: 1340 } },
  { label: "no limbs, swagger", gait: [["swagger", 1]], depth: 2.6, start: 3.2, outfit: { top: "#e8b83a", legs: "#e8b83a", shoes: "#2a2a40", skin: "#e0b090", hair: "#2a1a10", limbless: true, seed: 1380 } },
  { label: "long coat, running", gait: [["run", 1]], depth: 3.6, start: 2, outfit: { top: "#c84a3a", legs: "#2a2a40", shoes: "#1e1812", skin: "#d8a070", hair: "#8a3a1a", hairdo: "ponytail", coat: "#3a5a7a", seed: 1420 } },
];

function walkerInRoom(v: View, w: Walker, sec: number): void {
  const wrap = canvas.width + 300;
  const pr = progress(w.gait, sec);
  const ux = w.start * PXM + pr.x * PXM;
  const x = ((ux + 150) % wrap) - 150, y = WALL + w.depth * 34;
  person(v, w.gait, pr.phase, speedOf(w.gait), { x, y, s: PXM, facing: 1 }, w.outfit);
  v.text(w.label, { x, y: y - 1.95 * PXM }, { size: 12, fill: "#1a2a3a", align: "center", valign: "bottom", style: "bold" });
}

function closeUp(v: View, x: number, label: string, g: Gait, outfit: Outfit, sec: number): void {
  const y0 = 560, w = 420, h = 440, s = 150, ground = y0 + h - 30;
  const pr = progress(g, sec);
  v.clip(rectPath(v, x, y0, w, h), () => {
    v.rect(x, y0, w, h, { fill: "#16140f" });
    for (let gx = x; gx <= x + w; gx += 20) v.line(gx, y0, gx, y0 + h, { stroke: "rgba(240,230,210,0.1)", weight: 1 });
    for (let gy = y0; gy <= y0 + h; gy += 20) v.line(x, gy, x + w, gy, { stroke: "rgba(240,230,210,0.1)", weight: 1 });
    const off = (pr.x * s) % (0.5 * s);
    for (let gx = -off; gx < w; gx += 0.5 * s) v.line(x + gx, ground, x + gx - 12, ground + 18, { stroke: "rgba(240,230,210,0.4)", weight: 1.5 });
    v.line(x, ground, x + w, ground, { stroke: "#e8dcc0", weight: 1 });
    person(v, g, pr.phase, speedOf(g), { x: x + w / 2, y: ground, s, facing: 1 }, { ...outfit, rig: true });
  });
  v.text(label, { x: x + 10, y: y0 + 8 }, { size: 13, fill: "#e8dcc0", align: "left", valign: "top" });
}

function clothes(v: View, sec: number): void {
  v.rect(0, 0, canvas.width, WALL, { fill: "#8a8a6e" });
  for (let x = 0; x < canvas.width; x += 1.2 * PXM) v.line(x, 30, x, WALL, { stroke: "rgba(0,0,0,0.18)", weight: 2 });
  v.rect(0, WALL - 46, canvas.width, 46, { fill: "#6e6e58" });
  v.rect(0, WALL, canvas.width, 260, { fill: "#b9ab8e" });
  v.text("At the rooms' scale (145 px per metre).", { x: 16, y: 12 }, { size: 13, fill: "#f4ecd8", align: "left", valign: "top" });
  for (const w of WALKERS) walkerInRoom(v, w, sec);
  const coat = WALKERS[0]?.outfit, skirt = WALKERS[1]?.outfit, runner = WALKERS[3]?.outfit;
  if (coat) closeUp(v, 0, "Coat: front and back panels (pink) hang from the hips", [["confident", 1]], coat, sec);
  if (skirt) closeUp(v, 430, "Skirt: panels pushed by the legs, a moment late", [["lavish", 1]], skirt, sec);
  if (runner) closeUp(v, 860, "Running: the back panel streams with speed", [["run", 1]], runner, sec);
}

export function draw(v: View, model: DeepReadonly<Model>, p: ParamValues<typeof params>): void {
  const sec = model.frame / 60;
  v.rect(0, 0, canvas.width, canvas.height, { fill: "#d8ccb0" });
  if (p.sheet === "clothes") clothes(v, sec);
  else styles(v, sec);
}
