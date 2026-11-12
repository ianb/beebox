// Geometry shared by update (hit-testing) and draw for the periodic trends explorer.
import { ELEMENTS, GROUPS, lineMembers, PERIODS, type Element, type Line } from "./elements-tea.js";

export const CANVAS_W = 1000;
export const CANVAS_H = 660;

// ---------- table ----------

export const CELL = 52;
const PITCH = 56;
const TABLE_X = 64;
export const TABLE_Y = 112;
/** Width of the gap standing in for groups 3–12. */
const GAP = 40;

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function colX(group: number): number {
  const col = GROUPS.findIndex((g) => g === group);
  return TABLE_X + col * PITCH + (col >= 2 ? GAP : 0);
}

function rowY(period: number): number {
  return TABLE_Y + (period - 1) * PITCH;
}

export function cellBox(e: Element): Box {
  return { x: colX(e.group), y: rowY(e.period), w: CELL, h: CELL };
}

/** The band where groups 3–12 would sit (periods 4–6). */
export function gapBox(): Box {
  return { x: colX(2) + CELL + 4, y: rowY(4), w: GAP + PITCH - CELL - 8, h: 3 * PITCH - (PITCH - CELL) };
}

export function tableRight(): number {
  return colX(18) + CELL;
}

export function tableBottom(): number {
  return rowY(6) + CELL;
}

/** Group number headers above each column. */
export function groupHeaderBox(group: number): Box {
  // Groups 1, 2 and 18 begin in period 1; the others begin in period 2.
  const top = group === 1 || group === 18 ? rowY(1) : rowY(2);
  return { x: colX(group), y: top - 24, w: CELL, h: 22 };
}

/** Period number labels left of each row. */
export function periodLabelBox(period: number): Box {
  return { x: TABLE_X - 36, y: rowY(period), w: 30, h: CELL };
}

// ---------- chart ----------

export const CHART: Box = { x: 640, y: 112, w: 320, h: 300 };

/** Slots along the x axis: the 8 main groups across a period, the 6 periods down a group. */
export function slot(line: Line, e: Element): { index: number; count: number } {
  return line.kind === "period"
    ? { index: GROUPS.findIndex((g) => g === e.group), count: GROUPS.length }
    : { index: e.period - 1, count: PERIODS.length };
}

export function chartX(line: Line, e: Element): number {
  const left = 20;
  const right = 36;
  const { index, count } = slot(line, e);
  return CHART.x + left + (index * (CHART.w - left - right)) / (count - 1);
}

export function chartY(value: number, range: { min: number; max: number }): number {
  return CHART.y + CHART.h - ((value - range.min) / (range.max - range.min)) * CHART.h;
}

// ---------- hit testing ----------

function inside(b: Box, x: number, y: number): boolean {
  return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
}

export type Hit =
  | { type: "element"; el: Element }
  | { type: "period"; n: number }
  | { type: "group"; n: number }
  | { type: "none" };

export interface HitArgs {
  x: number;
  y: number;
  line: Line;
}

export function hitTest(a: HitArgs): Hit {
  const cell = ELEMENTS.find((e) => inside(cellBox(e), a.x, a.y));
  if (cell !== undefined) return { type: "element", el: cell };
  const group = GROUPS.find((g) => inside(groupHeaderBox(g), a.x, a.y));
  if (group !== undefined) return { type: "group", n: group };
  const period = PERIODS.find((p) => inside(periodLabelBox(p), a.x, a.y));
  if (period !== undefined) return { type: "period", n: period };
  // Chart: the nearest member column, if the pointer is within the plot.
  const plot = { x: CHART.x, y: CHART.y - 10, w: CHART.w, h: CHART.h + 40 };
  if (!inside(plot, a.x, a.y)) return { type: "none" };
  const members = lineMembers(a.line);
  let best: { el: Element; d: number } | null = null;
  for (const e of members) {
    const d = Math.abs(chartX(a.line, e) - a.x);
    if (d < 20 && (best === null || d < best.d)) best = { el: e, d };
  }
  return best === null ? { type: "none" } : { type: "element", el: best.el };
}
