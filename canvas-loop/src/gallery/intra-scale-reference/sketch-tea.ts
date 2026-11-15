// The scale reference sheet for side-view rooms (the standard lives in
// sizes-tea.ts, a copy of intra-lounge-side's): people and furniture from sizes-tea.ts, drawn at the
// scenes' true scale against a metre ruler, and a diagram of how depth shows.
import type { DeepReadonly, Msg, Vec2, SceneView as View } from "@ianbicking/canvas-loop";
import { INK, blob, ellipsePts, roundRectPts } from "./ink-tea.js";
import { DEPTH_PX_PER_M, PLANES, PX_PER_M, SIZES, m } from "./sizes-tea.js";

/** Draws with the scene View on the GPU renderer (`cli run` reads this). */
export const renderer = "scene";

export const canvas = { width: 1500, height: 960 };

export interface Model {
  frame: number;
}
export function init(): Model {
  return { frame: 0 };
}
export function update(model: DeepReadonly<Model>, msg: Msg): Model {
  switch (msg.type) {
    case "tick":
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

const LABEL = { size: 13, fill: "#2a2420", align: "center", valign: "top" } as const;
const SMALL = { size: 11, fill: "#6a5e54", align: "center", valign: "top" } as const;

function label(v: View, x: number, floor: number, a: { name: string; dims: string }): void {
  v.text(a.name, { x, y: floor + 10 }, LABEL);
  v.text(a.dims, { x, y: floor + 27 }, SMALL);
}

/** A standing person, feet at (x, floor), `h` metres tall. */
function person(v: View, x: number, floor: number, a: { h: number; coat: string; seed: number }): void {
  const head = m((0.23 * a.h) / 1.65);
  const top = floor - m(a.h);
  blob(v, ellipsePts(x, top + head / 2, head * 0.42, head / 2), { fill: "#c58a62", seed: a.seed, line: 1.8 });
  blob(v, [[x - 0.2 * PX_PER_M, floor - m(0.82)], [x + 0.2 * PX_PER_M, floor - m(0.82)], [x + 0.16 * PX_PER_M, top + head * 1.1], [x - 0.16 * PX_PER_M, top + head * 1.1]], { fill: a.coat, seed: a.seed + 1, line: 2 });
  for (const side of [-1, 1]) blob(v, [[x + side * 0.03 * PX_PER_M - 6, floor - m(0.82)], [x + side * 0.03 * PX_PER_M + 6, floor - m(0.82)], [x + side * 0.05 * PX_PER_M + 6, floor], [x + side * 0.05 * PX_PER_M - 6, floor]], { fill: "#2a2d36", seed: a.seed + 2 + side, line: 1.6 });
}

function box(v: View, x: number, floor: number, a: { w: number; h: number; fill: string; seed: number; lift?: number }): void {
  const lift = m(a.lift ?? 0);
  blob(v, [[x, floor - lift], [x + m(a.w), floor - lift], [x + m(a.w), floor - lift - m(a.h)], [x, floor - lift - m(a.h)]], { fill: a.fill, seed: a.seed, line: 2 });
}

function ruler(v: View, x: number, floor: number, metres: number): void {
  v.line(x, floor, x, floor - m(metres), { stroke: INK, weight: 2 });
  for (let i = 0; i <= metres * 10; i++) {
    const y = floor - m(i / 10);
    const major = i % 10 === 0, half = i % 5 === 0;
    v.line(x - (major ? 14 : half ? 9 : 5), y, x, y, { stroke: INK, weight: major ? 2 : 1 });
    if (major) v.text(`${i / 10} m`, { x: x - 18, y }, { size: 12, fill: "#2a2420", align: "right", valign: "middle" });
  }
  for (let i = 1; i <= metres * 2; i++) {
    const y = floor - m(i / 2);
    v.line(x + 4, y, x + 1060, y, { stroke: i % 2 === 0 ? "rgba(60,50,40,0.18)" : "rgba(60,50,40,0.08)", weight: 1, dash: [4, 6] });
  }
}

/** Row one: people, doors and the tall things against the wall, under the ceiling. */
function rowTall(v: View, floor: number): void {
  ruler(v, 70, floor, 3);
  v.line(70, floor, 1140, floor, { stroke: INK, weight: 2.5 });
  const ceil = floor - m(SIZES.ceiling.h);
  v.rect(70, ceil - 14, 1070, 14, { fill: "#4a78e0" });
  v.text(`ceiling, sky screen: ${SIZES.ceiling.h} m`, { x: 1130, y: ceil - 18 }, { size: 12, fill: "#2a2420", align: "right", valign: "bottom" });
  v.line(70, floor - m(SIZES.pipe.h), 1140, floor - m(SIZES.pipe.h), { stroke: "#7a6650", weight: m(0.11) });
  v.text(`pipe along the wall: ${SIZES.pipe.h} m`, { x: 1130, y: floor - m(SIZES.pipe.h) - 12 }, { size: 12, fill: "#2a2420", align: "right", valign: "bottom" });
  let x = 140;
  person(v, x, floor, { h: SIZES.woman.h, coat: "#5a3440", seed: 1 });
  label(v, x, floor, { name: "woman", dims: `${SIZES.woman.h} m` });
  x += 110;
  person(v, x, floor, { h: SIZES.man.h, coat: "#3c4a6a", seed: 10 });
  label(v, x, floor, { name: "man", dims: `${SIZES.man.h} m` });
  x += 80;
  box(v, x, floor, { w: SIZES.door.w, h: SIZES.door.h, fill: "#4a3e36", seed: 20 });
  label(v, x + m(SIZES.door.w) / 2, floor, { name: "door", dims: `${SIZES.door.w} × ${SIZES.door.h} m` });
  x += m(SIZES.door.w) + 50;
  const ax = x, aw = m(SIZES.arch.w), ah = m(SIZES.arch.h);
  const arch: Vec2[] = [[ax, floor], [ax + aw, floor], [ax + aw, floor - ah + aw / 2]];
  for (let i = 0; i <= 10; i++) arch.push([ax + aw / 2 + Math.cos((i / 10) * Math.PI) * aw / 2, floor - ah + aw / 2 - Math.sin((i / 10) * Math.PI) * aw / 2]);
  arch.push([ax, floor - ah + aw / 2]);
  blob(v, arch, { fill: "#1a1216", seed: 30, line: 2.4 });
  label(v, ax + aw / 2, floor, { name: "archway", dims: `${SIZES.arch.w} × ${SIZES.arch.h} m` });
  x += aw + 50;
  box(v, x, floor, { w: SIZES.shelves.w, h: SIZES.shelves.h, fill: "#5a3e2a", seed: 40 });
  for (let s = 0.85; s < SIZES.shelves.h; s += 0.4) v.line(x + 4, floor - m(s), x + m(SIZES.shelves.w) - 4, floor - m(s), { stroke: "#9a7450", weight: 4 });
  box(v, x + 6, floor, { w: SIZES.archive.w, h: SIZES.archive.h - 0.02, fill: "#5a6a6a", seed: 41 });
  for (const cx of [0.3, 0.7]) v.circle(x + 6 + m(cx), floor - m(0.5), m(0.15), { fill: "#2a2e30" });
  label(v, x + m(SIZES.shelves.w) / 2, floor, { name: "shelves, archive machine", dims: `${SIZES.shelves.w} × ${SIZES.shelves.h} m; machine ${SIZES.archive.h} m` });
  x += m(SIZES.shelves.w) + 60;
  blob(v, roundRectPts(x, floor - m(SIZES.vending.h), m(SIZES.vending.w), m(SIZES.vending.h), m(0.3)), { fill: "#8a3e2e", seed: 50, line: 2 });
  blob(v, roundRectPts(x + m(0.18), floor - m(1.55), m(0.35), m(0.7), m(0.1)), { fill: "#cde6ff", seed: 51, line: 1.6 });
  label(v, x + m(SIZES.vending.w) / 2, floor, { name: "vending machine", dims: `${SIZES.vending.w} × ${SIZES.vending.h} m` });
  // The bulb hangs from the ceiling.
  const bx = 1080;
  v.line(bx, ceil, bx, floor - m(SIZES.bulb.h), { stroke: INK, weight: 1.5 });
  v.circle(bx, floor - m(SIZES.bulb.h) + 8, 9, { fill: "#e8e0c0" });
  v.circle(bx, floor - m(SIZES.bulb.h) + 8, 9, { stroke: INK, weight: 1.5 });
  v.text(`bulb: ${SIZES.bulb.h} m`, { x: bx, y: floor - m(SIZES.bulb.h) + 24 }, SMALL);
}

/** Row two: what is lower down, with a woman for comparison. */
function rowLow(v: View, floor: number): void {
  ruler(v, 70, floor, 2);
  v.line(70, floor, 1140, floor, { stroke: INK, weight: 2.5 });
  let x = 140;
  person(v, x, floor, { h: SIZES.woman.h, coat: "#5a3440", seed: 60 });
  label(v, x, floor, { name: "woman", dims: `${SIZES.woman.h} m` });
  x += 70;
  // Sofa, with someone sitting in it.
  const arm = m(0.25), sw = m(SIZES.sofa.w);
  const cx = x + arm + sw / 2;
  blob(v, ellipsePts(cx, floor - m(SIZES.seated.h) + m(0.12), m(0.1), m(0.12)), { fill: "#2e1f18", seed: 61, line: 1.8 });
  blob(v, ellipsePts(cx, floor - m(0.92), m(0.22), m(0.16)), { fill: "#3c4a6a", seed: 62, line: 1.8 });
  box(v, x + arm, floor, { w: SIZES.sofa.w, h: SIZES.sofa.h - 0.1, fill: "#8c6b3e", seed: 63, lift: 0.1 });
  box(v, x, floor, { w: 0.25, h: 0.62, fill: "#7a5c34", seed: 64 });
  box(v, x + arm + sw, floor, { w: 0.25, h: 0.62, fill: "#7a5c34", seed: 65 });
  label(v, cx, floor, { name: "sofa, someone sitting", dims: `${SIZES.sofa.w} m (+ arms) × ${SIZES.sofa.h} m; head ${SIZES.seated.h} m` });
  x += sw + arm * 2 + 70;
  // The cabinet with a stack of sets.
  box(v, x, floor, { w: SIZES.cabinet.w, h: SIZES.cabinet.h, fill: "#5e4030", seed: 70 });
  const sets = [SIZES.crtLarge, SIZES.crtMedium, SIZES.crtSmall];
  let sx = x + m(0.15);
  for (const [i, s] of sets.entries()) {
    box(v, sx, floor, { w: s.w, h: s.h, fill: "#b8ab8c", seed: 71 + i, lift: SIZES.cabinet.h });
    blob(v, roundRectPts(sx + m(s.w) * 0.09, floor - m(SIZES.cabinet.h) - m(s.h) * 0.88, m(s.w) * 0.68, m(s.h) * 0.7, 6), { fill: "#2a5a40", seed: 75 + i, line: 1.4 });
    v.text(["26 in", "19 in", "14 in"][i] ?? "", { x: sx + m(s.w) / 2, y: floor - m(SIZES.cabinet.h) - m(s.h) - 16 }, SMALL);
    sx += m(s.w) + m(0.12);
  }
  label(v, x + m(SIZES.cabinet.w) / 2, floor, { name: "cabinet and sets", dims: `cabinet ${SIZES.cabinet.h} m; sets ${SIZES.crtSmall.h}–${SIZES.crtLarge.h} m tall` });
  x += m(SIZES.cabinet.w) + 60;
  box(v, x, floor, { w: SIZES.table.w, h: SIZES.table.h, fill: "#6a4630", seed: 80 });
  label(v, x + m(SIZES.table.w) / 2, floor, { name: "table", dims: `${SIZES.table.h} m` });
}

/** How depth shows: a woman at the back wall and on the walking line are the same
 * height; the nearer one stands lower on the screen. */
function depthDiagram(v: View, x0: number, wallFoot: number): void {
  const w = 300;
  v.rect(x0, wallFoot - m(2.4), w, m(2.4), { fill: "#d8d0c0" });
  v.polygon([[x0, wallFoot], [x0 + w, wallFoot], [x0 + w, wallFoot + PLANES.front * DEPTH_PX_PER_M + 20], [x0, wallFoot + PLANES.front * DEPTH_PX_PER_M + 20]], { fill: "#b8a890" });
  v.text("Depth", { x: x0 + w / 2, y: wallFoot - m(2.4) - 44 }, { size: 16, fill: "#2a2420", align: "center", valign: "top", style: "bold" });
  v.text(`each metre out from the wall: ${DEPTH_PX_PER_M} px lower`, { x: x0 + w / 2, y: wallFoot - m(2.4) - 22 }, { size: 12, fill: "#6a5e54", align: "center", valign: "top" });
  const planes: [string, number][] = [["things on the wall", PLANES.wall], ["sofa", PLANES.sofa], ["walking line", PLANES.walk], ["foreground", PLANES.front]];
  for (const [name, d] of planes) {
    const y = wallFoot + d * DEPTH_PX_PER_M;
    v.line(x0, y, x0 + w, y, { stroke: INK, weight: 1, dash: [3, 4] });
    v.text(`${name}, ${d} m`, { x: x0 + w - 4, y: y - 2 }, { size: 10, fill: "#2a2420", align: "right", valign: "bottom" });
  }
  person(v, x0 + 60, wallFoot + PLANES.wall * DEPTH_PX_PER_M, { h: SIZES.woman.h, coat: "#5a3440", seed: 90 });
  person(v, x0 + 140, wallFoot + PLANES.walk * DEPTH_PX_PER_M, { h: SIZES.woman.h, coat: "#5a3440", seed: 91 });
  v.text("same height; the nearer one stands lower", { x: x0 + w / 2, y: wallFoot + PLANES.front * DEPTH_PX_PER_M + 30 }, { size: 11, fill: "#6a5e54", align: "center", valign: "top" });
}

export function draw(v: View): void {
  // Port: `v.paperTexture(0.3)` at the end becomes what was drawn before it, in a group with
  // `effects.paper` (draft section 2).
  v.group({ effects: { paper: 0.3 } }, () => {
    v.background("#f1ebe0");
    v.text(`Scale: ${PX_PER_M} px per metre, the same at every depth`, { x: 70, y: 22 }, { size: 18, fill: "#2a2420", align: "left", valign: "top", style: "bold" });
    rowTall(v, 520);
    rowLow(v, 880);
    depthDiagram(v, 1180, 520);
  });
}
