// The results: a graph of period against length, and the trial table.
//
// Geometry is pure functions of the trials and the display switches, so draw
// can hit-test the pointer against the same numbers it paints.
import type { DeepReadonly, Style, View } from "@ianbicking/canvas-loop";

import { card, FAINT, GRID, INK, say, SOFT } from "./look-tea.js";
import { PLANET_COLOR, PLANETS, theoryPeriod, type Planet } from "./physics-tea.js";

export interface Trial {
  n: number;
  planet: Planet;
  length: number;
  angle: number;
  /** Stopwatch reading for ten swings, seconds. */
  total: number;
  period: number;
}

export type Trials = DeepReadonly<Trial[]>;

export const GRAPH_CARD = { x: 462, y: 60, w: 478, h: 300 };
export const PLOT = { left: 524, right: 884, top: 126, bottom: 306 };
export const TABLE_CARD = { x: 462, y: 372, w: 478, h: 248 };
const ROW_TOP = 436;
const ROW_H = 20;
export const MAX_ROWS = 8;

export interface Axes {
  sqrt: boolean;
  xMax: number;
  yMax: number;
  yStep: number;
}

export interface ChartOpts {
  sqrt: boolean;
  theory: boolean;
  current: Planet;
}

/** Planets whose theory curve is drawn: every planet with a trial, plus the current one. */
export function theoryPlanets(trials: Trials, current: Planet): Planet[] {
  return PLANETS.filter((pl) => pl === current || trials.some((t) => t.planet === pl));
}

const NICE = [2, 3, 4, 5, 6, 8, 10, 12] as const;

export function axesFor(trials: Trials, o: ChartOpts): Axes {
  const measured = trials.map((t) => t.period);
  const theory = o.theory ? theoryPlanets(trials, o.current).map((pl) => theoryPeriod(2, pl)) : [];
  const top = Math.max(2.5, ...measured, ...theory) * 1.08;
  const yMax = NICE.find((n) => n >= top) ?? 12;
  const yStep = yMax <= 3 ? 0.5 : yMax <= 6 ? 1 : 2;
  return { sqrt: o.sqrt, xMax: o.sqrt ? 1.5 : 2, yMax, yStep };
}

export function xOf(a: Axes, length: number): number {
  const x = a.sqrt ? Math.sqrt(length) : length;
  return PLOT.left + (x / a.xMax) * (PLOT.right - PLOT.left);
}

export function yOf(a: Axes, period: number): number {
  return PLOT.bottom - (period / a.yMax) * (PLOT.bottom - PLOT.top);
}

/** The trial whose dot is under (x, y), if any. */
export function pointAt(trials: Trials, a: { axes: Axes; x: number; y: number }): number | null {
  const hit = trials.find((t) => Math.hypot(xOf(a.axes, t.length) - a.x, yOf(a.axes, t.period) - a.y) <= 9);
  return hit === undefined ? null : hit.n;
}

/** The trials the table shows: the most recent MAX_ROWS, oldest first. */
export function visibleRows(trials: Trials): Trials {
  return trials.slice(Math.max(0, trials.length - MAX_ROWS));
}

/** The trial whose table row is under (x, y), if any. */
export function rowAt(trials: Trials, at: { x: number; y: number }): number | null {
  const { x, y } = at;
  if (x < TABLE_CARD.x + 8 || x > TABLE_CARD.x + TABLE_CARD.w - 8) return null;
  const i = Math.floor((y - ROW_TOP) / ROW_H);
  const rows = visibleRows(trials);
  if (y < ROW_TOP || i >= rows.length) return null;
  return rows[i]?.n ?? null;
}

// ---------- graph ----------

function fmt(n: number, digits: number): string {
  return n.toFixed(digits);
}

function drawAxes(v: View, a: Axes): void {
  const axis: Style = { stroke: INK, weight: 1.5 };
  const grid: Style = { stroke: GRID, weight: 1 };
  for (let t = a.yStep; t <= a.yMax + 1e-9; t += a.yStep) {
    const y = yOf(a, t);
    v.line(PLOT.left, y, PLOT.right, y, grid);
    say(v, fmt(t, a.yStep < 1 ? 1 : 0), { x: PLOT.left - 8, y }, { size: 12, fill: SOFT, align: "right", valign: "middle" });
  }
  const xTicks = a.sqrt ? [0.25, 0.5, 0.75, 1, 1.25, 1.5] : [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
  for (const xv of xTicks) {
    const x = PLOT.left + (xv / a.xMax) * (PLOT.right - PLOT.left);
    v.line(x, PLOT.top, x, PLOT.bottom, grid);
    const major = Math.abs(xv * 2 - Math.round(xv * 2)) < 1e-9;
    if (major) say(v, fmt(xv, 1), { x, y: PLOT.bottom + 8 }, { size: 12, fill: SOFT, align: "center", valign: "top" });
  }
  say(v, "0", { x: PLOT.left - 8, y: PLOT.bottom }, { size: 12, fill: SOFT, align: "right", valign: "middle" });
  v.line(PLOT.left, PLOT.bottom, PLOT.right + 6, PLOT.bottom, axis);
  v.line(PLOT.left, PLOT.top - 6, PLOT.left, PLOT.bottom, axis);
  const xLabel = a.sqrt ? "square root of length, √L  (√m)" : "string length L  (m)";
  say(v, xLabel, { x: (PLOT.left + PLOT.right) / 2, y: PLOT.bottom + 26 }, { size: 13, fill: INK, align: "center", valign: "top" });
  v.at({ translate: [GRAPH_CARD.x + 20, (PLOT.top + PLOT.bottom) / 2], rotate: -Math.PI / 2 }, () => {
    say(v, "period T  (s)", { x: 0, y: 0 }, { size: 13, fill: INK, align: "center", valign: "middle" });
  });
}

function drawTheory(v: View, a: { axes: Axes; planets: Planet[] }): void {
  for (const pl of a.planets) {
    const pts: [number, number][] = [];
    for (let i = 0; i <= 80; i += 1) {
      const u = i / 80;
      const length = a.axes.sqrt ? (u * a.axes.xMax) ** 2 : u * a.axes.xMax;
      pts.push([xOf(a.axes, length), yOf(a.axes, theoryPeriod(length, pl))]);
    }
    v.group({ opacity: 0.55 }, () => {
      v.curve(pts, false, { stroke: PLANET_COLOR[pl], weight: 2 });
    });
    const end = pts[pts.length - 1];
    if (end !== undefined && end[1] > PLOT.top - 4) {
      say(v, pl, { x: end[0] + 10, y: end[1] }, { size: 11, fill: PLANET_COLOR[pl], align: "left", valign: "middle", bold: true });
    }
  }
}

export interface GraphState {
  trials: Trials;
  axes: Axes;
  theory: Planet[] | null;
  /** The trial to call out (pointer over its dot or row). */
  focus: number | null;
  /** The newest trial's number and how many frames since it landed. */
  fresh: { n: number; age: number } | null;
}

function drawDots(v: View, g: GraphState): void {
  for (const t of g.trials) {
    const x = xOf(g.axes, t.length);
    const y = yOf(g.axes, t.period);
    if (g.fresh?.n === t.n && g.fresh.age < 90) {
      const k = g.fresh.age / 90;
      v.circle(x, y, 12 + 30 * k, { stroke: PLANET_COLOR[t.planet], weight: 2 * (1 - k) + 0.5 });
    }
    v.circle(x, y, 11, { fill: PLANET_COLOR[t.planet], stroke: "#ffffff", weight: 1.5 });
  }
}

function drawTooltip(v: View, g: GraphState): void {
  const t = g.trials.find((tr) => tr.n === g.focus);
  if (t === undefined) return;
  const x = xOf(g.axes, t.length);
  const y = yOf(g.axes, t.period);
  v.circle(x, y, 20, { stroke: INK, weight: 1.5 });
  const lines = [`Trial ${t.n} · ${t.planet}`, `L = ${fmt(t.length, 2)} m, ${t.angle}°`, `T = ${fmt(t.period, 3)} s`];
  const w = 132;
  const h = 58;
  const bx = Math.min(x + 14, PLOT.right - w);
  const by = Math.max(PLOT.top - 10, y - h - 12);
  v.roundRect(bx, by, w, h, 6, { fill: "rgba(42, 40, 51, 0.92)" });
  for (const [i, s] of lines.entries()) {
    say(v, s, { x: bx + 9, y: by + 18 + i * 16 }, { size: 12, fill: "#ffffff", bold: i === 0 });
  }
}

function drawLegend(v: View, g: GraphState): void {
  const present = PLANETS.filter((pl) => g.trials.some((t) => t.planet === pl));
  let x = PLOT.left;
  const y = GRAPH_CARD.y + 52;
  for (const pl of present) {
    v.circle(x + 5, y, 9, { fill: PLANET_COLOR[pl], stroke: "#ffffff", weight: 1 });
    say(v, pl, { x: x + 13, y }, { size: 12, fill: SOFT, valign: "middle" });
    x += 22 + v.textWidth(pl, { size: 12 }) + 10;
  }
}

export function drawGraph(v: View, g: GraphState): void {
  card(v, GRAPH_CARD);
  say(v, "Period vs length", { x: GRAPH_CARD.x + 18, y: GRAPH_CARD.y + 28 }, { size: 17, bold: true });
  drawAxes(v, g.axes);
  if (g.theory !== null) drawTheory(v, { axes: g.axes, planets: g.theory });
  drawLegend(v, g);
  drawDots(v, g);
  if (g.trials.length === 0) {
    say(v, "Each trial adds a dot here.", { x: PLOT.left + 14, y: PLOT.top + 16 }, { size: 14, fill: FAINT, valign: "middle", italic: true });
  }
  drawTooltip(v, g);
}

// ---------- table ----------

interface Column {
  head: string;
  x: number;
  align: "left" | "right";
  cell: (t: DeepReadonly<Trial>) => string;
}

const COLUMNS: Column[] = [
  { head: "#", x: 500, align: "right", cell: (t) => String(t.n) },
  { head: "Place", x: 506, align: "left", cell: (t) => t.planet },
  { head: "Length", x: 618, align: "right", cell: (t) => `${fmt(t.length, 2)} m` },
  { head: "Angle", x: 676, align: "right", cell: (t) => `${t.angle}°` },
  { head: "10 swings", x: 768, align: "right", cell: (t) => `${fmt(t.total, 2)} s` },
  { head: "Period T", x: 848, align: "right", cell: (t) => `${fmt(t.period, 3)} s` },
];
const THEORY_COLUMN: Column = { head: "Theory", x: 922, align: "right", cell: (t) => `${fmt(theoryPeriod(t.length, t.planet), 3)} s` };

export interface TableState {
  trials: Trials;
  theory: boolean;
  focus: number | null;
  fresh: { n: number; age: number } | null;
}

export function drawTable(v: View, s: TableState): void {
  card(v, TABLE_CARD);
  say(v, "Results", { x: TABLE_CARD.x + 18, y: TABLE_CARD.y + 28 }, { size: 17, bold: true });
  const cols = s.theory ? [...COLUMNS, THEORY_COLUMN] : COLUMNS;
  const headY = ROW_TOP - 8;
  for (const c of cols) {
    say(v, c.head, { x: c.x, y: headY }, { size: 12, fill: SOFT, bold: true, align: c.align });
  }
  v.line(TABLE_CARD.x + 12, ROW_TOP - 2, TABLE_CARD.x + TABLE_CARD.w - 12, ROW_TOP - 2, { stroke: GRID, weight: 1.5 });
  if (s.trials.length === 0) {
    say(v, "No trials yet. Set a length, then press “Time 10 swings”.", { x: TABLE_CARD.x + TABLE_CARD.w / 2, y: ROW_TOP + 40 }, { size: 13, fill: FAINT, align: "center", italic: true });
    return;
  }
  const rows = visibleRows(s.trials);
  const hidden = s.trials.length - rows.length;
  for (const [i, t] of rows.entries()) {
    const top = ROW_TOP + i * ROW_H;
    const freshTint = s.fresh?.n === t.n && s.fresh.age < 120 ? 1 - s.fresh.age / 120 : 0;
    if (s.focus === t.n) v.rect(TABLE_CARD.x + 8, top, TABLE_CARD.w - 16, ROW_H, { fill: "#efe8d8" });
    else if (freshTint > 0) v.rect(TABLE_CARD.x + 8, top, TABLE_CARD.w - 16, ROW_H, { fill: `rgba(250, 214, 120, ${(0.55 * freshTint).toFixed(3)})` });
    v.circle(TABLE_CARD.x + 17, top + ROW_H / 2, 7, { fill: PLANET_COLOR[t.planet] });
    for (const c of cols) {
      say(v, c.cell(t), { x: c.x, y: top + ROW_H / 2 }, { size: 13, fill: c === THEORY_COLUMN ? SOFT : INK, align: c.align, valign: "middle", bold: c.head === "Period T" });
    }
  }
  if (hidden > 0) {
    say(v, `+ ${hidden} earlier trial${hidden === 1 ? "" : "s"} (on the graph)`, { x: TABLE_CARD.x + 18, y: TABLE_CARD.y + TABLE_CARD.h - 9 }, { size: 12, fill: FAINT, italic: true });
  }
}
