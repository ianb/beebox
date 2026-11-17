// Walk styles from motion capture, and clothes on their own skeletons.
// sheet=styles: sixteen walkers on treadmills (the floor slides under them at
// their own speed), twelve acted walks, a jog, a run and two blends.
// sheet=clothes: a skirt, a long coat walking and running, a person drawn without
// limbs, crossing a room at the rooms' scale; below, the garments' skeletons.
import type { DeepReadonly, Drawing, Msg, ParamValues, ParamsDecl, RootDrawing, View } from "@ianbicking/canvas-loop";
import { CLIPS } from "./clips-tea.js";
import type { ClipName } from "./clips-tea.js";
import { cadence, progress, stepBody, strideLength } from "./gait-tea.js";
import { INK } from "./ink-tea.js";
import type { Gait } from "./gait-tea.js";
import { person, personFront } from "./figure-tea.js";
import { buildOf } from "./body-tea.js";
import type { Archetype, BodySpec, Build } from "./body-tea.js";
import type { Outfit } from "./figure-tea.js";

export const params = {
  sheet: { type: "select", options: ["styles", "clothes", "bodies", "play"], default: "styles", label: "Sheet" },
  outfit: { type: "select", options: ["jumpsuit", "skirt", "coat"], default: "jumpsuit", label: "Outfit (play)" },
  body: { type: "select", options: ["woman", "man", "child"], default: "woman", label: "Body (play)" },
  height: { type: "number", min: -1, max: 1, step: 0.1, default: 0, label: "Height" },
  weight: { type: "number", min: -1, max: 1, step: 0.1, default: 0, label: "Weight" },
  chest: { type: "number", min: -1, max: 1, step: 0.1, default: 0, label: "Chest" },
  quality: { type: "select", options: ["ink", "fast"], default: "ink", label: "Drawing" },
} as const satisfies ParamsDecl;

export const canvas = { width: 1280, height: 1000 };

type Dir = "left" | "right";
export interface Model {
  frame: number;
  // The played character (sheet=play).
  left: boolean;
  right: boolean;
  run: boolean;
  lastUp: { dir: Dir | ""; frame: number };
  x: number;
  facing: 1 | -1;
  /** 0 standing, 1 walking, 2 running, and blends between. */
  level: number;
  phase: number;
  soles: readonly number[];
  v: number;
  /** The played body, from the body params. */
  body: { kind: Archetype; height: number; weight: number; chest: number };
  /** Frames left in a turn (0 when not turning); halfway through, the facing flips. */
  turn: number;
}
export function init(): Model {
  return { frame: 0, left: false, right: false, run: false, lastUp: { dir: "", frame: -99 }, x: 4.4, facing: 1, level: 0, phase: 0, soles: [], v: 0, turn: 0, body: { kind: "woman", height: 0, weight: 0, chest: 0 } };
}

const dirOfKey = (key: string): Dir | undefined => (key === "ArrowLeft" || key === "a" ? "left" : key === "ArrowRight" || key === "d" ? "right" : undefined);
/** A second press within a third of a second of letting go means run. */
const DOUBLE_TAP = 20;

function press(m: DeepReadonly<Model>, d: Dir): Model {
  if (m[d]) return { ...m, lastUp: { ...m.lastUp }, soles: [...m.soles] };
  const run = m.lastUp.dir === d && m.frame - m.lastUp.frame <= DOUBLE_TAP;
  return { ...m, [d]: true, run, lastUp: { ...m.lastUp }, soles: [...m.soles] };
}
function release(m: DeepReadonly<Model>, d: Dir): Model {
  const left = d === "left" ? false : m.left, right = d === "right" ? false : m.right;
  return { ...m, left, right, run: left || right ? m.run : false, lastUp: { dir: d, frame: m.frame }, soles: [...m.soles] };
}

/** Stand, walk and run, mixed by level: their curves share a phase, so any mix is a gait. */
export function gaitAt(level: number): Gait {
  if (level <= 1) return [["stand", 1 - level], ["confident", level]];
  return [["confident", 2 - level], ["run", level - 1]];
}

/** Frames in a turn (0.6 s); the middle half faces the camera. */
export const TURN = 36;
const ROOM_MIN = 0.6, ROOM_MAX = canvas.width / 145 - 0.6;
function tick(m: DeepReadonly<Model>): Model {
  const frame = m.frame + 1;
  const want = m.right && !m.left ? 1 : m.left && !m.right ? -1 : 0;
  // Turning: slow to a stop, then turn through a frame facing the camera.
  if (m.turn > 0) {
    const turn = m.turn - 1;
    const facing = turn === Math.floor(TURN / 2) ? (m.facing > 0 ? -1 : 1) : m.facing;
    return { ...m, frame, turn, facing, v: 0, soles: [], lastUp: { ...m.lastUp } };
  }
  const facing = m.facing;
  if (want !== 0 && want !== facing && m.level < 0.12) return { ...m, frame, turn: TURN, level: 0, v: 0, lastUp: { ...m.lastUp }, soles: [] };
  const atWall = (facing > 0 && m.x > ROOM_MAX) || (facing < 0 && m.x < ROOM_MIN);
  const target = want === 0 || want !== facing || atWall ? 0 : m.run ? 2 : 1;
  const rate = (target > m.level ? (m.level >= 1 ? 1.6 : 2.5) : 3) / 60;
  const level = m.level + Math.max(-rate, Math.min(rate, target - m.level));
  const g = gaitAt(level);
  const b = buildOf(m.body);
  const phase = (m.phase + cadence(g, b) / 60) % 1;
  const step = stepBody(m.soles.length > 0 ? m.soles : undefined, g, phase, m.v, b);
  // Settling into a stand can shift which foot is planted; never drift backwards.
  const dx = Math.max(0, step.dx);
  return { ...m, frame, facing, level, phase, x: m.x + facing * dx, v: dx, soles: step.soles, lastUp: { ...m.lastUp } };
}

const KINDS: readonly Archetype[] = ["woman", "man", "child"];
function withParam(m: DeepReadonly<Model>, name: string, value: number | boolean | string): Model {
  const body = { ...m.body };
  const kind = KINDS.find((k) => k === value);
  if (name === "body" && kind) body.kind = kind;
  if ((name === "height" || name === "weight" || name === "chest") && typeof value === "number") body[name] = value;
  return { ...m, body, lastUp: { ...m.lastUp }, soles: [] };
}

export function update(model: DeepReadonly<Model>, msg: Msg): Model {
  switch (msg.type) {
    case "tick":
      return tick(model);
    case "keydown": {
      const d = dirOfKey(msg.key);
      return d ? press(model, d) : { ...model, lastUp: { ...model.lastUp }, soles: [...model.soles] };
    }
    case "keyup": {
      const d = dirOfKey(msg.key);
      return d ? release(model, d) : { ...model, lastUp: { ...model.lastUp }, soles: [...model.soles] };
    }
    case "param":
      return withParam(model, msg.name, msg.value);
    case "mousedown":
    case "mouseup":
    case "mousemove":
    case "trigger":
      return { ...model, lastUp: { ...model.lastUp }, soles: [...model.soles] };
  }
}

const JUMPSUIT: Outfit = { top: "#3a6a9a", legs: "#3a6a9a", shoes: "#1e1812", skin: "#c58a62", hair: "#2e1d15", collar: "#e8b83a", seed: 900 };
const speedOf = (g: Gait, b?: Build): number => strideLength(g, b) * cadence(g, b);
const rectPath = (v: View, x: number, y: number, w: number, h: number): ReturnType<View["curvePath"]> => v.curvePath([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], true);

// --- Styles ------------------------------------------------------------------------------

interface Cell {
  label: string;
  gait: (sec: number) => Gait;
  outfit?: Partial<Outfit>;
  body?: BodySpec;
}
const one = (n: ClipName): ((sec: number) => Gait) => () => [[n, 1]];
const CELLS: Cell[] = [
  { label: "normal", gait: one("normal"), body: { kind: "woman" } },
  { label: "confident", gait: one("confident"), body: { kind: "man", height: 0.4 }, outfit: { top: "#8a3a2a", legs: "#8a3a2a" } },
  { label: "bold stride", gait: one("stride"), body: { kind: "man", height: 0.7, weight: -0.4 }, outfit: { top: "#3a7a7a", legs: "#3a7a7a" } },
  { label: "purposeful (\"stern\")", gait: one("stern"), body: { kind: "woman", height: 0.5 }, outfit: { top: "#2a2a30", legs: "#2a2a30" } },
  { label: "quick", gait: one("quick"), body: { kind: "woman", weight: -0.5 }, outfit: { top: "#3a8a4a", legs: "#3a8a4a", hairdo: "ponytail", hair: "#a04a20" } },
  { label: "happy-go-lucky", gait: one("happy"), body: { kind: "child" }, outfit: { top: "#c0a050", legs: "#c0a050", hairdo: "ponytail" } },
  { label: "cool", gait: one("cool"), body: { kind: "man" }, outfit: { top: "#4a6a8a", legs: "#4a6a8a" } },
  { label: "macho", gait: one("macho"), body: { kind: "man", weight: 0.6, chest: 1 }, outfit: { top: "#8a5a3a", legs: "#8a5a3a" } },
  { label: "swagger (\"too cool\")", gait: one("swagger"), body: { kind: "woman", height: 0.3, chest: 0.4 }, outfit: { top: "#3a3a4a", legs: "#3a3a4a", hairdo: "bun" } },
  { label: "scared", gait: one("scared"), body: { kind: "child", height: 0.5 }, outfit: { top: "#8a8a7a", legs: "#8a8a7a" } },
  { label: "sad", gait: one("sad"), body: { kind: "woman", weight: 0.5 }, outfit: { top: "#5a6a8a", legs: "#5a6a8a" } },
  { label: "depressed", gait: one("depressed"), body: { kind: "man", weight: 0.9 }, outfit: { top: "#6a6a6a", legs: "#6a6a6a", hair: "#8a8a84" } },
  { label: "achey", gait: one("achey"), body: { kind: "woman", height: -0.6, weight: 0.4 }, outfit: { top: "#7a6a3a", legs: "#7a6a3a", hair: "#c8c8c0" } },
  { label: "hurt leg", gait: one("hurtLeg"), body: { kind: "man", height: -0.3 }, outfit: { top: "#6a4a3a", legs: "#6a4a3a" } },
  { label: "jog", gait: one("jog"), body: { kind: "woman", weight: -0.3 }, outfit: { top: "#c84a3a", legs: "#2a2a40", hairdo: "ponytail", hair: "#d8b060" } },
  { label: "run", gait: one("run"), body: { kind: "man", weight: -0.5 }, outfit: { top: "#e8b83a", legs: "#2a2a40" } },
];

function cell(v: View, c: Cell, i: number, sec: number, fast: boolean): Drawing {
  const out: Drawing[] = [];
  const w = 320, h = 250, x0 = (i % 4) * w, y0 = Math.floor(i / 4) * h;
  const g = c.gait(sec);
  const b = buildOf(c.body ?? { kind: "woman" });
  const pr = progress(g, sec, b);
  const s = 88, ground = y0 + h - 34, cx = x0 + w / 2 - 10;
  out.push(v.clip(rectPath(v, x0, y0, w, h), ((): Drawing => {
    const drawn: Drawing[] = [];
    drawn.push(v.rect(x0, y0, w, h, { fill: i % 2 === Math.floor(i / 4) % 2 ? "#ddd2b8" : "#d4c8ac" }));
    drawn.push(v.rect(x0, ground, w, h - (ground - y0), { fill: "#b9ab8e" }));
    // The floor slides back under them at exactly the speed their feet push it.
    const off = (pr.x * s) % (0.5 * s);
    for (let gx = -off; gx < w; gx += 0.5 * s) drawn.push(v.line(x0 + gx, ground, x0 + gx - 14, ground + 22, { stroke: "rgba(60,40,20,0.35)", weight: 1.5 }));
    drawn.push(person(v, g, pr.phase, speedOf(g, b), { x: cx, y: ground, s, facing: 1 }, { ...JUMPSUIT, ...c.outfit, seed: 900 + i * 40, fast }, b));
    return drawn;
  })()));
  out.push(v.line(x0, y0, x0, y0 + h, { stroke: "rgba(0,0,0,0.25)", weight: 1 }));
  out.push(v.line(x0, y0, x0 + w, y0, { stroke: "rgba(0,0,0,0.25)", weight: 1 }));
  out.push(v.text(c.label, { x: x0 + 10, y: y0 + 8 }, { size: 13, fill: "#2a2420", align: "left", valign: "top", style: "bold" }));
  out.push(v.text(`${speedOf(g, b).toFixed(1)} m/s · ${cadence(g, b).toFixed(2)} strides/s`, { x: x0 + 10, y: y0 + 26 }, { size: 11, fill: "#5a4e44", align: "left", valign: "top" }));
  const take = g.length === 1 && g[0] ? CLIPS[g[0][0]].take : "";
  if (take) out.push(v.text(`CMU ${take}`, { x: x0 + w - 8, y: y0 + h - 8 }, { size: 9, fill: "#5a4e44", align: "right", valign: "bottom" }));
  return out;
}

function styles(v: View, sec: number, fast: boolean): Drawing {
  const out: Drawing[] = [];
  for (const [i, c] of CELLS.entries()) out.push(cell(v, c, i, sec, fast));
  return out;
}

// --- Clothes -----------------------------------------------------------------------------

interface Walker {
  label: string;
  gait: Gait;
  depth: number;
  start: number;
  outfit: Outfit;
  body: BodySpec;
}
const PXM = 145, WALL = 300;
const WALKERS: Walker[] = [
  { label: "long coat, confident", gait: [["confident", 1]], depth: 1.0, start: 0.5, body: { kind: "man", height: 0.5 }, outfit: { top: "#d8d0c0", legs: "#2a2a30", shoes: "#3a2418", skin: "#b07850", hair: "#1a1410", coat: "#6a5040", seed: 1300 } },
  { label: "skirt and ponytail, normal", gait: [["normal", 1]], depth: 1.8, start: 6, body: { kind: "woman" }, outfit: { top: "#e8d8b0", legs: "#c58a62", shoes: "#8a2a2a", skin: "#c58a62", hair: "#5a2a14", hairdo: "ponytail", skirt: "#3a7a6a", seed: 1340 } },
  { label: "no limbs, swagger", gait: [["swagger", 1]], depth: 2.6, start: 3.2, body: { kind: "man", weight: 0.3 }, outfit: { top: "#e8b83a", legs: "#e8b83a", shoes: "#2a2a40", skin: "#e0b090", hair: "#2a1a10", limbless: true, seed: 1380 } },
  { label: "long coat, running", gait: [["run", 1]], depth: 3.6, start: 2, body: { kind: "woman", height: 0.4, weight: -0.3 }, outfit: { top: "#c84a3a", legs: "#2a2a40", shoes: "#1e1812", skin: "#d8a070", hair: "#8a3a1a", hairdo: "ponytail", coat: "#3a5a7a", seed: 1420 } },
];

function walkerInRoom(v: View, w: Walker, sec: number, fast: boolean): Drawing {
  const wrap = canvas.width + 300;
  const b = buildOf(w.body);
  const pr = progress(w.gait, sec, b);
  const ux = w.start * PXM + pr.x * PXM;
  const x = ((ux + 150) % wrap) - 150, y = WALL + w.depth * 34;
  return [
    person(v, w.gait, pr.phase, speedOf(w.gait, b), { x, y, s: PXM, facing: 1 }, { ...w.outfit, fast }, b),
    v.text(w.label, { x, y: y - 1.95 * PXM }, { size: 12, fill: "#1a2a3a", align: "center", valign: "bottom", style: "bold" }),
  ];
}

function closeUp(v: View, x: number, label: string, g: Gait, outfit: Outfit, sec: number, body: BodySpec, fast: boolean): Drawing {
  const y0 = 560, w = 420, h = 440, s = 150, ground = y0 + h - 30;
  const b = buildOf(body);
  const pr = progress(g, sec, b);
  return [
    v.clip(rectPath(v, x, y0, w, h), ((): Drawing => {
      const drawn: Drawing[] = [];
      drawn.push(v.rect(x, y0, w, h, { fill: "#16140f" }));
      for (let gx = x; gx <= x + w; gx += 20) drawn.push(v.line(gx, y0, gx, y0 + h, { stroke: "rgba(240,230,210,0.1)", weight: 1 }));
      for (let gy = y0; gy <= y0 + h; gy += 20) drawn.push(v.line(x, gy, x + w, gy, { stroke: "rgba(240,230,210,0.1)", weight: 1 }));
      const off = (pr.x * s) % (0.5 * s);
      for (let gx = -off; gx < w; gx += 0.5 * s) drawn.push(v.line(x + gx, ground, x + gx - 12, ground + 18, { stroke: "rgba(240,230,210,0.4)", weight: 1.5 }));
      drawn.push(v.line(x, ground, x + w, ground, { stroke: "#e8dcc0", weight: 1 }));
      drawn.push(person(v, g, pr.phase, speedOf(g, b), { x: x + w / 2, y: ground, s, facing: 1 }, { ...outfit, rig: true, fast }, b));
      return drawn;
    })()),
    v.text(label, { x: x + 10, y: y0 + 8 }, { size: 13, fill: "#e8dcc0", align: "left", valign: "top" }),
  ];
}

function clothes(v: View, sec: number, fast: boolean): Drawing {
  const drawn: Drawing[] = [];
  drawn.push(v.rect(0, 0, canvas.width, WALL, { fill: "#8a8a6e" }));
  for (let x = 0; x < canvas.width; x += 1.2 * PXM) drawn.push(v.line(x, 30, x, WALL, { stroke: "rgba(0,0,0,0.18)", weight: 2 }));
  drawn.push(v.rect(0, WALL - 46, canvas.width, 46, { fill: "#6e6e58" }));
  drawn.push(v.rect(0, WALL, canvas.width, 260, { fill: "#b9ab8e" }));
  drawn.push(v.text("At the rooms' scale (145 px per metre).", { x: 16, y: 12 }, { size: 13, fill: "#f4ecd8", align: "left", valign: "top" }));
  for (const w of WALKERS) drawn.push(walkerInRoom(v, w, sec, fast));
  const coat = WALKERS[0]?.outfit, skirt = WALKERS[1]?.outfit;
  if (coat) drawn.push(closeUp(v, 0, "Coat: front and back panels (pink) hang from the hips", [["confident", 1]], coat, sec, { kind: "man", height: 0.5 }, fast));
  if (skirt) drawn.push(closeUp(v, 430, "Skirt on a bold stride: the legs push the panels", [["stride", 1]], skirt, sec, { kind: "woman" }, fast));
  if (skirt) drawn.push(closeUp(v, 860, "Skirt running: legs never come out the front", [["run", 1]], skirt, sec, { kind: "woman" }, fast));
  return drawn;
}

// --- Bodies -----------------------------------------------------------------------------

const BODIES: readonly { label: string; body: BodySpec }[] = [
  { label: "woman", body: { kind: "woman" } },
  { label: "man", body: { kind: "man" } },
  { label: "child", body: { kind: "child" } },
  { label: "tall man", body: { kind: "man", height: 1 } },
  { label: "short woman", body: { kind: "woman", height: -1 } },
  { label: "small child", body: { kind: "child", height: -1 } },
  { label: "heavy woman", body: { kind: "woman", weight: 1 } },
  { label: "heavy man", body: { kind: "man", weight: 1 } },
  { label: "slight woman, flat", body: { kind: "woman", weight: -1, chest: -1 } },
  { label: "woman, full chest", body: { kind: "woman", chest: 1 } },
  { label: "broad man", body: { kind: "man", height: 0.5, weight: 0.4, chest: 1 } },
  { label: "tall heavy child", body: { kind: "child", height: 1, weight: 0.7 } },
];

function bodies(v: View, sec: number, fast: boolean): Drawing {
  const out: Drawing[] = [];
  const w = canvas.width / 6, h = canvas.height / 2, s = 118;
  for (const [i, c] of BODIES.entries()) {
    const x0 = (i % 6) * w, y0 = Math.floor(i / 6) * h, ground = y0 + h - 40;
    const b = buildOf(c.body);
    const g: Gait = [["normal", 1]];
    const pr = progress(g, sec, b);
    out.push(v.rect(x0, y0, w, h, { fill: i % 2 === Math.floor(i / 6) % 2 ? "#ddd2b8" : "#d4c8ac" }));
    out.push(v.rect(x0, ground, w, h - (ground - y0), { fill: "#b9ab8e" }));
    // A 10 cm ruler, so heights read.
    for (let m = 0; m <= 2; m += 0.1) out.push(v.line(x0 + 4, ground - m * s, x0 + (Math.round(m * 10) % 5 === 0 ? 14 : 9), ground - m * s, { stroke: "rgba(0,0,0,0.35)", weight: 1 }));
    const outfit: Outfit = { ...JUMPSUIT, hairdo: c.body.kind === "man" ? "short" : "ponytail", seed: 2000 + i * 40, fast };
    out.push(person(v, g, pr.phase, speedOf(g, b), { x: x0 + w * 0.32, y: ground, s, facing: 1 }, outfit, b));
    out.push(personFront(v, { x: x0 + w * 0.76, y: ground, s, facing: 1 }, outfit, b));
    out.push(v.text(c.label, { x: x0 + 10, y: y0 + 10 }, { size: 13, fill: "#2a2420", align: "left", valign: "top", style: "bold" }));
    out.push(v.text(`${b.height.toFixed(2)} m · ${speedOf(g, b).toFixed(2)} m/s`, { x: x0 + 10, y: y0 + 28 }, { size: 11, fill: "#5a4e44", align: "left", valign: "top" }));
  }
  return out;
}

// --- Play -------------------------------------------------------------------------------

const PLAY_FLOOR = 640;
const PLAY_OUTFITS: Record<string, Outfit> = {
  jumpsuit: { ...JUMPSUIT, hairdo: "ponytail", seed: 1500 },
  skirt: { top: "#e8d8b0", legs: "#c58a62", shoes: "#8a2a2a", skin: "#c58a62", hair: "#5a2a14", hairdo: "ponytail", skirt: "#3a7a6a", seed: 1540 },
  coat: { top: "#d8d0c0", legs: "#2a2a30", shoes: "#3a2418", skin: "#b07850", hair: "#1a1410", coat: "#6a5040", seed: 1580 },
};

function play(v: View, m: DeepReadonly<Model>, outfit: string, fast: boolean): Drawing {
  const drawn: Drawing[] = [];
  drawn.push(v.rect(0, 0, canvas.width, PLAY_FLOOR - 40, { fill: "#8a8a6e" }));
  for (let x = 0; x < canvas.width; x += 1.2 * PXM) drawn.push(v.line(x, 60, x, PLAY_FLOOR - 40, { stroke: "rgba(0,0,0,0.18)", weight: 2 }));
  drawn.push(v.rect(0, PLAY_FLOOR - 86, canvas.width, 46, { fill: "#6e6e58" }));
  drawn.push(v.rect(0, PLAY_FLOOR - 40, canvas.width, canvas.height - PLAY_FLOOR + 40, { fill: "#b9ab8e" }));
  for (let x = 0; x < canvas.width; x += PXM) drawn.push(v.line(x, PLAY_FLOOR + 60, x, PLAY_FLOOR + 72, { stroke: INK, weight: 1.5 }));
  drawn.push(v.text("← → to walk. Tap twice and hold to run. Turning: press the other way.", { x: 20, y: 16 }, { size: 16, fill: "#f4ecd8", align: "left", valign: "top", style: "bold" }));
  const g = gaitAt(m.level);
  const b = buildOf(m.body);
  const look = { ...(PLAY_OUTFITS[outfit] ?? JUMPSUIT), fast };
  const place = { x: m.x * PXM, y: PLAY_FLOOR, s: PXM, facing: m.facing };
  // The middle half of a turn looks out at us.
  if (m.turn > TURN / 4 && m.turn <= (3 * TURN) / 4) drawn.push(personFront(v, place, look, b));
  else drawn.push(person(v, g, m.phase, Math.abs(m.v) * 60, place, look, b));
  // The mix: how much stand, walk and run is in this frame's gait.
  const mix = [["stand", Math.max(0, 1 - m.level)], ["walk", 1 - Math.abs(1 - m.level)], ["run", Math.max(0, m.level - 1)]] as const;
  for (const [i, [name, w]] of mix.entries()) {
    const y = 760 + i * 30;
    drawn.push(v.text(name, { x: 20, y }, { size: 13, fill: "#2a2420", align: "left", valign: "middle" }));
    drawn.push(v.rect(80, y - 8, 200, 16, { fill: "rgba(0,0,0,0.12)" }));
    drawn.push(v.rect(80, y - 8, 200 * w, 16, { fill: "#3a6a9a" }));
  }
  const keys = `${m.left ? "←" : "  "} ${m.right ? "→" : "  "}${m.run ? "  running" : ""}`;
  drawn.push(v.text(keys, { x: 300, y: 760 }, { size: 15, fill: "#2a2420", align: "left", valign: "middle", style: "bold" }));
  drawn.push(v.text(`${(Math.abs(m.v) * 60).toFixed(1)} m/s`, { x: 300, y: 790 }, { size: 13, fill: "#2a2420", align: "left", valign: "middle" }));
  return drawn;
}

export function draw(v: View, model: DeepReadonly<Model>, p: ParamValues<typeof params>): RootDrawing {
  const out: Drawing[] = [];
  const sec = model.frame / 60;
  out.push(v.rect(0, 0, canvas.width, canvas.height, { fill: "#d8ccb0" }));
  const fast = p.quality === "fast";
  if (p.sheet === "clothes") out.push(clothes(v, sec, fast));
  else if (p.sheet === "play") out.push(play(v, model, p.outfit, fast));
  else if (p.sheet === "bodies") out.push(bodies(v, sec, fast));
  else out.push(styles(v, sec, fast));
  return out;
}
