// Painting for the balancing sketch. `paint` draws one frame from the model
// and the analysis of the current numbers.
import type { DeepReadonly, Style, TextOptions, Vec2, View } from "@ianbicking/canvas-loop";
import { ELEMENTS, formulaParts } from "./chem-tea.js";
import type { Analysis, El, Molecule, Slot, Tally } from "./chem-tea.js";
import { ARROW_GAP, BANNER, EQUATION, HEADER, PICTURE, TALLY, tallyRow, W } from "./layout-tea.js";
import type { Box } from "./layout-tea.js";
import type { Model } from "./sketch-tea.js";

const FONT = "Trebuchet MS, Verdana, sans-serif";
const PAGE = "#fbf7ee";
const INK = "#1f2937";
const MUTED = "#6b7280";
const GOOD = "#16a34a";
const GOOD_FILL = "#22c55e";
const BAD = "#dc2626";
const BAD_FILL = "#f87171";

const CARD: Style = { fill: "#fffdf8", stroke: "#e7dcc6", weight: 1.5 };
const T: TextOptions = { font: FONT, fill: INK, size: 14 };

interface Frame {
  model: DeepReadonly<Model>;
  analysis: Analysis;
}

function focusOf(model: DeepReadonly<Model>): El | null {
  return model.hover ?? model.pinned;
}

// ── formulas with real subscripts ────────────────────────────────────

function formulaWidth(v: View, formula: string, size: number): number {
  let w = 0;
  for (const part of formulaParts(formula)) {
    w += v.textWidth(part.symbol, { ...T, size, style: "bold" });
    if (part.sub !== "") w += v.textWidth(part.sub, { ...T, size: size * 0.62, style: "bold" });
  }
  return w;
}

/** Draw `formula` with its left end at x and its baseline at y. */
function drawFormula(v: View, formula: string, at: { x: number; y: number; size: number; fill: string }): void {
  let x = at.x;
  for (const part of formulaParts(formula)) {
    const big: TextOptions = { ...T, size: at.size, style: "bold", fill: at.fill, valign: "baseline" };
    v.text(part.symbol, { x, y: at.y }, big);
    x += v.textWidth(part.symbol, big);
    if (part.sub !== "") {
      const small: TextOptions = { ...big, size: at.size * 0.62 };
      v.text(part.sub, { x, y: at.y + at.size * 0.22 }, small);
      x += v.textWidth(part.sub, small);
    }
  }
}

// ── header ───────────────────────────────────────────────────────────

function drawHeader(v: View, analysis: Analysis): void {
  v.line(34, HEADER.y + 38, 290, HEADER.y + 36, { stroke: "#fde68a", weight: 14, brush: "marker", gesture: { seed: 3, wobble: 1.5 } });
  v.text("Balance the equation", { x: 32, y: HEADER.y + 12 }, { ...T, size: 26, style: "bold" });
  v.text(analysis.reaction.story, { x: 32, y: HEADER.y + 44 }, { ...T, size: 14, fill: MUTED });
  v.text("Reaction", { x: 548, y: HEADER.y + 33 }, { ...T, size: 14, style: "bold", align: "right", valign: "middle" });
  v.control("reaction", { x: 560, y: HEADER.y + 16, w: W - 32 - 560, h: 34, size: 15 });
}

// ── equation row with the number boxes ───────────────────────────────

const BOX_W = 56;
const BOX_H = 44;
const EQ_SIZE = 30;

function drawArrow(v: View, x: number, y: number, color: string): void {
  const style: Style = { stroke: color, weight: 3.5 };
  v.line(x, y, x + 34, y, style);
  v.path([["move", x + 24, y - 9], ["line", x + 35, y], ["line", x + 24, y + 9]], style);
}

function equationItems(v: View, analysis: Analysis): { width: number; plus: number } {
  const plus = v.textWidth(" + ", { ...T, size: EQ_SIZE });
  let width = 0;
  const all = [...analysis.left, ...analysis.right];
  for (const slot of all) width += BOX_W + 8 + formulaWidth(v, slot.molecule.formula, EQ_SIZE);
  width += (all.length - 2) * plus + 64;
  return { width, plus };
}

function drawUnusedSlot(v: View, right: number, rowY: number): void {
  const x = right - 196;
  v.roundRect(x, rowY, BOX_W, BOX_H, 6, { fill: "#f3f4f6", stroke: "#d1d5db", weight: 1.5 });
  v.line(x + 10, rowY + BOX_H - 10, x + BOX_W - 10, rowY + 10, { stroke: "#9ca3af", weight: 2 });
  v.text("4th box not used:\nthis reaction has\nonly 3 substances", { x: x + BOX_W + 10, y: rowY + BOX_H / 2 }, {
    ...T,
    size: 12,
    fill: MUTED,
    valign: "middle",
  });
}

function drawSlot(v: View, slot: Slot, at: { x: number; rowY: number; mid: number }): number {
  v.roundRect(at.x - 4, at.rowY - 4, BOX_W + 8, BOX_H + 8, 9, { fill: "#fef3c7", stroke: "#f59e0b", weight: 1.5 });
  v.control(`c${slot.index + 1}`, { x: at.x, y: at.rowY, w: BOX_W, h: BOX_H, size: 24, align: "center", bold: true });
  const fx = at.x + BOX_W + 8;
  drawFormula(v, slot.molecule.formula, { x: fx, y: at.mid + EQ_SIZE * 0.36, size: EQ_SIZE, fill: INK });
  return fx + formulaWidth(v, slot.molecule.formula, EQ_SIZE);
}

function drawEquation(v: View, frame: Frame): void {
  const { analysis } = frame;
  v.roundRect(EQUATION.x, EQUATION.y, EQUATION.w, EQUATION.h, 14, CARD);
  const four = analysis.left.length + analysis.right.length === 4;
  v.text("Type how many of each molecule (1 to 12) in the yellow boxes.", { x: EQUATION.x + 16, y: EQUATION.y + 10 }, {
    ...T,
    size: 13,
    fill: MUTED,
  });
  const rowY = EQUATION.y + 36;
  const mid = rowY + BOX_H / 2;
  const right = EQUATION.x + EQUATION.w - 16;
  const span = four ? EQUATION.w : EQUATION.w - 200;
  const { width, plus } = equationItems(v, analysis);
  let x = EQUATION.x + (span - width) / 2;
  const sides = [analysis.left, analysis.right];
  for (const [s, side] of sides.entries()) {
    for (const [i, slot] of side.entries()) {
      if (i > 0) {
        v.text(" + ", { x, y: mid }, { ...T, size: EQ_SIZE, fill: MUTED, valign: "middle" });
        x += plus;
      }
      x = drawSlot(v, slot, { x, rowY, mid });
    }
    if (s === 0) {
      drawArrow(v, x + 15, mid, analysis.balanced ? GOOD : INK);
      x += 64;
    }
  }
  if (!four) drawUnusedSlot(v, right, rowY);
}

// ── molecules ────────────────────────────────────────────────────────

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function boundsOf(m: Molecule): Bounds {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const atom of m.atoms) {
    const r = ELEMENTS[atom.el].r;
    b.minX = Math.min(b.minX, atom.x - r);
    b.maxX = Math.max(b.maxX, atom.x + r);
    b.minY = Math.min(b.minY, atom.y - r);
    b.maxY = Math.max(b.maxY, atom.y + r);
  }
  return b;
}

/** The pixels-per-unit at which `count` copies of `m` fit `box`, and the grid that does it. */
function fit(m: Molecule, count: number, box: Box): { scale: number; cols: number } {
  const b = boundsOf(m);
  const mw = b.maxX - b.minX + 0.6;
  const mh = b.maxY - b.minY + 0.6;
  let best = { scale: 0, cols: 1 };
  for (let cols = 1; cols <= count; cols += 1) {
    const rows = Math.ceil(count / cols);
    const scale = Math.min(box.w / cols / mw, box.h / rows / mh);
    if (scale > best.scale) best = { scale, cols };
  }
  return best;
}

const PALE: Readonly<Record<El, string>> = {
  H: "#f8fafc",
  C: "#d6d9de",
  N: "#d4e3fb",
  O: "#fbd5d5",
  Fe: "#f8e2c2",
};

function drawAtom(v: View, a: { el: El; x: number; y: number; s: number; focus: El | null }): void {
  const info = ELEMENTS[a.el];
  const d = info.r * 2 * a.s;
  const dim = a.focus !== null && a.focus !== a.el;
  v.circle(a.x, a.y, d / 2, { fill: dim ? PALE[a.el] : info.fill, stroke: dim ? "#d1d5db" : info.edge, weight: 1.4 });
  if (dim) return;
  v.circle(a.x - d * 0.18, a.y - d * 0.2, (d * 0.32) / 2, { fill: "rgba(255,255,255,0.45)" });
  if (d >= 17) {
    v.text(a.el, { x: a.x, y: a.y + 0.5 }, { ...T, size: d * 0.42, style: "bold", fill: info.text, align: "center", valign: "middle" });
  }
}

function drawMolecule(v: View, m: Molecule, at: { x: number; y: number; s: number; focus: El | null }): void {
  for (const atom of m.atoms) {
    if (atom.el === at.focus) v.circle(at.x + atom.x * at.s, at.y + atom.y * at.s, (ELEMENTS[atom.el].r * 2 * at.s + 7) / 2, { fill: "#facc15" });
  }
  for (const atom of m.atoms) drawAtom(v, { el: atom.el, x: at.x + atom.x * at.s, y: at.y + atom.y * at.s, s: at.s, focus: at.focus });
}

const LABEL_H = 28;

function moleculeArea(box: Box): Box {
  return { x: box.x + 4, y: box.y + LABEL_H, w: box.w - 8, h: box.h - LABEL_H - 4 };
}

function splitBoxes(area: Box, fraction: number, count: number): Box[] {
  const gap = 28;
  if (count === 1) return [area];
  const w1 = (area.w - gap) * fraction;
  return [
    { ...area, w: w1 },
    { ...area, x: area.x + w1 + gap, w: area.w - gap - w1 },
  ];
}

/** Boxes for one side's species, split so the smaller of their molecule scales is as large as possible. */
function speciesBoxes(side: readonly Slot[], area: Box): Box[] {
  let best = { score: -1, boxes: splitBoxes(area, 0.5, side.length) };
  if (side.length !== 2) return best.boxes;
  for (let f = 0.25; f <= 0.75 + 1e-9; f += 0.025) {
    const boxes = splitBoxes(area, f, 2);
    let score = Infinity;
    for (const [i, box] of boxes.entries()) {
      const slot = side[i];
      if (slot) score = Math.min(score, fit(slot.molecule, slot.coefficient, moleculeArea(box)).scale);
    }
    if (score > best.score + 1e-6) best = { score, boxes };
  }
  return best.boxes;
}

function sideAreas(): { left: Box; right: Box } {
  const top = PICTURE.y + 34;
  const h = PICTURE.h - 44;
  const w = (PICTURE.w - ARROW_GAP) / 2 - 16;
  return {
    left: { x: PICTURE.x + 16, y: top, w, h },
    right: { x: PICTURE.x + PICTURE.w / 2 + ARROW_GAP / 2, y: top, w, h },
  };
}

function bob(model: DeepReadonly<Model>, i: number): number {
  if (model.balancedAt === null) return 0;
  const t = model.frame - model.balancedAt;
  if (t > 150) return 0;
  return Math.sin(t / 6 + i * 0.9) * 4 * (1 - t / 150);
}

function drawSpecies(v: View, slot: Slot, at: { box: Box; scale: number; frame: Frame }): void {
  const { box, scale } = at;
  const label = `${slot.coefficient} ×`;
  const lw = v.textWidth(`${label} `, { ...T, size: 17, style: "bold" });
  const fw = formulaWidth(v, slot.molecule.formula, 17);
  const lx = box.x + (box.w - lw - fw) / 2;
  v.text(label, { x: lx, y: box.y + 20 }, { ...T, size: 17, style: "bold", fill: MUTED, valign: "baseline" });
  drawFormula(v, slot.molecule.formula, { x: lx + lw, y: box.y + 20, size: 17, fill: INK });
  const area = moleculeArea(box);
  const { cols } = fit(slot.molecule, slot.coefficient, area);
  const rows = Math.ceil(slot.coefficient / cols);
  const b = boundsOf(slot.molecule);
  const cw = (b.maxX - b.minX + 0.6) * scale;
  const ch = (b.maxY - b.minY + 0.6) * scale;
  const ox = area.x + (area.w - cw * cols) / 2;
  const oy = area.y + (area.h - ch * rows) / 2;
  for (let i = 0; i < slot.coefficient; i += 1) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const lastRow = row === rows - 1 ? slot.coefficient - row * cols : cols;
    const shift = ((cols - lastRow) * cw) / 2;
    const cx = ox + shift + col * cw + cw / 2 - ((b.minX + b.maxX) / 2) * scale;
    const cy = oy + row * ch + ch / 2 - ((b.minY + b.maxY) / 2) * scale + bob(at.frame.model, i + slot.index * 3);
    drawMolecule(v, slot.molecule, { x: cx, y: cy, s: scale, focus: focusOf(at.frame.model) });
  }
}

function drawPicture(v: View, frame: Frame): void {
  const { analysis } = frame;
  v.roundRect(PICTURE.x, PICTURE.y, PICTURE.w, PICTURE.h, 14, CARD);
  drawSparkles(v, frame.model);
  const { left, right } = sideAreas();
  v.text("Start with", { x: left.x + left.w / 2, y: PICTURE.y + 12 }, { ...T, size: 14, style: "bold", fill: MUTED, align: "center" });
  v.text("End with", { x: right.x + right.w / 2, y: PICTURE.y + 12 }, { ...T, size: 14, style: "bold", fill: MUTED, align: "center" });
  const ax = PICTURE.x + PICTURE.w / 2 - 17;
  drawArrow(v, ax, PICTURE.y + PICTURE.h / 2, analysis.balanced ? GOOD : "#9ca3af");
  const placed = [
    ...speciesBoxes(analysis.left, left).map((box, i) => ({ box, slot: analysis.left[i] })),
    ...speciesBoxes(analysis.right, right).map((box, i) => ({ box, slot: analysis.right[i] })),
  ];
  let scale = 34;
  for (const { box, slot } of placed) if (slot) scale = Math.min(scale, fit(slot.molecule, slot.coefficient, moleculeArea(box)).scale);
  const sides = [
    { side: analysis.left, boxes: speciesBoxes(analysis.left, left) },
    { side: analysis.right, boxes: speciesBoxes(analysis.right, right) },
  ];
  for (const { side, boxes } of sides) {
    for (const [i, box] of boxes.entries()) {
      const slot = side[i];
      if (!slot) continue;
      if (i > 0) v.text("+", { x: box.x - 14, y: box.y + box.h / 2 }, { ...T, size: 24, fill: MUTED, align: "center", valign: "middle" });
      drawSpecies(v, slot, { box, scale, frame });
    }
  }
}

// ── tally ────────────────────────────────────────────────────────────

const BAR = { x: 230, w: 400, h: 15 };

function drawBar(v: View, at: { y: number; count: number; other: number; unit: number; label: string }): void {
  const ok = at.count === at.other;
  v.text(at.label, { x: BAR.x - 10, y: at.y + BAR.h / 2 }, { ...T, size: 12, fill: MUTED, align: "right", valign: "middle" });
  v.rect(BAR.x, at.y, BAR.w, BAR.h, { fill: "#f3efe6" });
  if (at.other > at.count) {
    v.rect(BAR.x + at.count * at.unit, at.y, (at.other - at.count) * at.unit, BAR.h, { stroke: BAD_FILL, weight: 1.5 });
  }
  v.rect(BAR.x, at.y, at.count * at.unit, BAR.h, { fill: ok ? GOOD_FILL : BAD_FILL });
  if (at.unit >= 5) {
    for (let i = 1; i < at.count; i += 1) v.line(BAR.x + i * at.unit, at.y, BAR.x + i * at.unit, at.y + BAR.h, { stroke: PAGE, weight: 1 });
  }
  const end = BAR.x + Math.max(at.count, at.other) * at.unit;
  v.text(String(at.count), { x: end + 8, y: at.y + BAR.h / 2 }, { ...T, size: 14, style: "bold", fill: ok ? GOOD : BAD, valign: "middle" });
}

function drawCheck(v: View, x: number, y: number): void {
  v.path([["move", x, y], ["line", x + 6, y + 6], ["line", x + 17, y - 7]], { stroke: GOOD, weight: 3.5 });
}

function drawCross(v: View, x: number, y: number): void {
  const style: Style = { stroke: BAD, weight: 3.5 };
  v.line(x + 1, y - 7, x + 15, y + 7, style);
  v.line(x + 15, y - 7, x + 1, y + 7, style);
}

/** "H is in H₂, H₂O": the molecules to look at, drawn with real subscripts. */
function drawHolders(v: View, analysis: Analysis, at: { el: El; x: number; y: number }): void {
  const small: TextOptions = { ...T, size: 12, fill: MUTED, valign: "baseline" };
  const lead = `${at.el} is in `;
  v.text(lead, { x: at.x, y: at.y }, small);
  let x = at.x + v.textWidth(lead, small);
  const names = [...analysis.left, ...analysis.right]
    .filter((s) => s.molecule.atoms.some((atom) => atom.el === at.el))
    .map((s) => s.molecule.formula);
  for (const [i, name] of names.entries()) {
    if (i > 0) {
      v.text(", ", { x, y: at.y }, small);
      x += v.textWidth(", ", small);
    }
    drawFormula(v, name, { x, y: at.y, size: 13, fill: MUTED });
    x += formulaWidth(v, name, 13);
  }
}

function drawTallyRow(v: View, t: Tally, at: { i: number; unit: number; frame: Frame }): void {
  const row = tallyRow(at.i);
  const { model, analysis } = at.frame;
  const focused = focusOf(model) === t.el;
  if (focused) v.roundRect(row.x, row.y, row.w, row.h, 10, { fill: "#fef9c3", stroke: "#facc15", weight: 1.5 });
  const info = ELEMENTS[t.el];
  const cy = row.y + row.h / 2;
  v.circle(row.x + 26, cy, 15, { fill: info.fill, stroke: info.edge, weight: 1.5 });
  v.text(t.el, { x: row.x + 26, y: cy + 0.5 }, { ...T, size: 13, style: "bold", fill: info.text, align: "center", valign: "middle" });
  v.text(info.name, { x: row.x + 50, y: cy }, { ...T, size: 15, style: "bold", valign: "middle" });
  if (model.pinned === t.el) v.text("(kept lit)", { x: row.x + 50, y: cy + 16 }, { ...T, size: 11, fill: MUTED, valign: "middle" });
  drawBar(v, { y: row.y + 5, count: t.left, other: t.right, unit: at.unit, label: "left" });
  drawBar(v, { y: row.y + row.h - 5 - BAR.h, count: t.right, other: t.left, unit: at.unit, label: "right" });
  const sx = 690;
  if (t.left === t.right) {
    drawCheck(v, sx, cy);
    v.text(`${t.left} = ${t.right}  matches`, { x: sx + 26, y: cy }, { ...T, size: 15, style: "bold", fill: GOOD, valign: "middle" });
    return;
  }
  drawCross(v, sx, cy);
  const more = t.left > t.right ? "more on the left" : "more on the right";
  v.text(`${t.left} ≠ ${t.right}  ${more}`, { x: sx + 26, y: cy - 9 }, { ...T, size: 14, style: "bold", fill: BAD, valign: "middle" });
  drawHolders(v, analysis, { el: t.el, x: sx + 26, y: cy + 15 });
}

function drawTally(v: View, frame: Frame): void {
  v.roundRect(TALLY.x, TALLY.y, TALLY.w, TALLY.h, 14, CARD);
  v.text("Count the atoms on each side", { x: TALLY.x + 16, y: TALLY.y + 12 }, { ...T, size: 16, style: "bold" });
  const max = Math.max(10, ...frame.analysis.tallies.flatMap((t) => [t.left, t.right]));
  const unit = BAR.w / max;
  for (const [i, t] of frame.analysis.tallies.entries()) drawTallyRow(v, t, { i, unit, frame });
  v.text("Point at an element to light up its atoms in the picture. Click to keep it lit.", {
    x: TALLY.x + TALLY.w - 16,
    y: TALLY.y + 14,
  }, { ...T, size: 12, fill: MUTED, align: "right" });
}

// ── banner and celebration ───────────────────────────────────────────

function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}`;
}

function drawBanner(v: View, frame: Frame): void {
  const { analysis } = frame;
  const box = BANNER;
  if (!analysis.balanced) {
    v.roundRect(box.x, box.y, box.w, box.h, 14, { fill: "#fef2f2", stroke: "#fecaca", weight: 1.5 });
    const off = analysis.tallies.filter((t) => t.left !== t.right).map((t) => ELEMENTS[t.el].name);
    const verb = off.length === 1 ? "does not match" : "do not match";
    v.text(`Not balanced yet: ${joinNames(off)} ${verb}. Change one number at a time and watch the counts.`, {
      x: box.x + 20,
      y: box.y + box.h / 2,
    }, { ...T, size: 16, style: "bold", fill: BAD, valign: "middle" });
    return;
  }
  v.roundRect(box.x, box.y, box.w, box.h, 14, { fill: "#dcfce7", stroke: "#86efac", weight: 1.5 });
  drawCheck(v, box.x + 22, box.y + box.h / 2);
  const tip = analysis.divisor > 1 ? `  Tip: every number divides by ${analysis.divisor}; chemists use the smallest whole numbers.` : "";
  v.text(`Balanced! Every atom you start with is still there at the end.${tip}`, {
    x: box.x + 52,
    y: box.y,
    w: box.w - 70,
    h: box.h,
  }, { ...T, size: 16, style: "bold", fill: GOOD, valign: "middle" });
}

/** A repeatable 0..1 value for confetti piece `i`, field `k`. */
function hash01(i: number, k: number): number {
  const s = Math.sin(i * 127.1 + k * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

const SPARK_COLORS = ["#fbbf24", "#f472b6", "#60a5fa", "#34d399", "#a78bfa"] as const;

function star(x: number, y: number, r: number, turn: number): Vec2[] {
  const points: Vec2[] = [];
  for (let k = 0; k < 8; k += 1) {
    const a = turn + (Math.PI / 4) * k;
    const d = k % 2 === 0 ? r : r * 0.38;
    points.push([x + Math.cos(a) * d, y + Math.sin(a) * d]);
  }
  return points;
}

/**
 * A gentle burst of sparkles from the picture's arrow, behind the molecules.
 * Sparkles, not atoms: loose atoms would say atoms appeared from nowhere.
 */
function drawSparkles(v: View, model: DeepReadonly<Model>): void {
  if (model.balancedAt === null) return;
  const t = model.frame - model.balancedAt;
  const life = 90;
  if (t > life) return;
  const ox = PICTURE.x + PICTURE.w / 2;
  const oy = PICTURE.y + PICTURE.h / 2;
  const fade = 1 - t / life;
  const ease = 1 - (1 - Math.min(1, t / 45)) ** 3;
  v.group({ opacity: Math.min(1, fade * 1.5) }, () => {
    for (let i = 0; i < 30; i += 1) {
      const angle = Math.PI * 2 * hash01(i, 1);
      const travel = (40 + 170 * hash01(i, 2)) * ease;
      const x = ox + Math.cos(angle) * travel * 2;
      const y = oy + Math.sin(angle) * travel * 0.55;
      const r = (6 + 7 * hash01(i, 4)) * (0.7 + 0.3 * Math.sin(t / 5 + i));
      v.polygon(star(x, y, r, t / 25 + i), { fill: SPARK_COLORS[i % SPARK_COLORS.length] ?? "#fbbf24" });
    }
  });
}

export function paint(v: View, frame: Frame): void {
  v.background(PAGE);
  v.paperTexture(0.22);
  drawHeader(v, frame.analysis);
  drawEquation(v, frame);
  drawPicture(v, frame);
  drawTally(v, frame);
  drawBanner(v, frame);
}
