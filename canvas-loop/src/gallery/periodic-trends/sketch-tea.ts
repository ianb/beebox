// Periodic trends explorer, for a learner of about 14–16.
//
//   - `property` (select) picks atomic radius, electronegativity or first
//     ionization energy. The main-group elements (groups 1, 2, 13–18, periods
//     1–6) are laid out as a periodic table, each cell shaded by the value.
//   - a line chart beside it plots the value across one period or down one
//     group. Clicking a period number (left of the table) or a group number
//     (above it) chooses the line; clicking an element moves the line to that
//     element's period or group, keeping the direction.
//   - hovering an element (in the table or on the chart) highlights it in both
//     views and shows its value; clicking pins it. Faint grey lines behind the
//     chart show the other periods or groups for comparison.
//   - `show values` prints each value in its cell; `mark exceptions` circles the
//     elements on the chart whose step goes against the usual trend.
//
// Data and sources: ./elements-tea.ts.
import type {
  DeepReadonly,
  Msg,
  ParamsDecl,
  ParamValues,
  Style,
  Util,
  View,
} from "@ianbicking/canvas-loop";

import {
  bySymbol,
  ELEMENTS,
  exceptions,
  formatValue,
  GROUPS,
  lineMembers,
  lineTitle,
  PERIODS,
  PROPERTIES,
  PROPERTY_IDS,
  valueOf,
  type Element,
  type Line,
  type PropertyId,
} from "./elements-tea.js";
import {
  CANVAS_H,
  CANVAS_W,
  cellBox,
  CHART,
  chartX,
  chartY,
  slot,
  gapBox,
  groupHeaderBox,
  hitTest,
  periodLabelBox,
  TABLE_Y,
  tableBottom,
  tableRight,
  type Box,
} from "./layout-tea.js";

export const params = {
  property: { type: "select", options: PROPERTY_IDS, default: "atomic radius" },
  "show values": { type: "boolean", default: false },
  "mark exceptions": { type: "boolean", default: false },
} as const satisfies ParamsDecl;

export const canvas = { width: CANVAS_W, height: CANVAS_H };

type Params = ParamValues<typeof params>;

export interface Model {
  /** Symbol under the pointer, if any. */
  hover: string | null;
  /** Symbol pinned by a click, if any. */
  selected: string | null;
  line: Line;
}

// ---------- update ----------

export function init(): Model {
  return { hover: null, selected: null, line: { kind: "period", n: 3 } };
}

function onMove(model: DeepReadonly<Model>, x: number, y: number): Model {
  const hit = hitTest({ x, y, line: model.line });
  const hover = hit.type === "element" ? hit.el.sym : null;
  return hover === model.hover ? model : { ...model, hover };
}

function lineThrough(line: DeepReadonly<Line>, e: Element): Line {
  return line.kind === "period"
    ? { kind: "period", n: e.period }
    : { kind: "group", n: e.group };
}

function onClick(args: {
  model: DeepReadonly<Model>;
  x: number;
  y: number;
  u: Util<typeof params>;
}): Model {
  const { model, x, y, u } = args;
  const hit = hitTest({ x, y, line: model.line });
  switch (hit.type) {
    case "element": {
      if (model.selected === hit.el.sym) {
        u.handled(`unpin ${hit.el.sym}`);
        return { ...model, selected: null };
      }
      u.handled(`pin ${hit.el.sym}`);
      return {
        ...model,
        selected: hit.el.sym,
        line: lineThrough(model.line, hit.el),
      };
    }
    case "period":
      u.handled(`period ${hit.n}`);
      return { ...model, line: { kind: "period", n: hit.n } };
    case "group":
      u.handled(`group ${hit.n}`);
      return { ...model, line: { kind: "group", n: hit.n } };
    case "none":
      return model;
  }
}

export function update(
  model: DeepReadonly<Model>,
  msg: Msg,
  u: Util<typeof params>,
): Model {
  switch (msg.type) {
    case "mousemove":
      return onMove(model, msg.x, msg.y);
    case "mousedown":
      return onClick({ model, x: msg.x, y: msg.y, u });
    case "tick":
    case "mouseup":
    case "keydown":
    case "keyup":
    case "param":
    case "trigger":
      return model;
  }
}

// ---------- colour ----------

const PAPER = "#ffffff";
const INK = "#1f2430";
const SOFT = "#6b7280";
const FAINT = "#d6d9de";
const MISSING = "#eef0f2";
const ACCENT = "#e4572e";
const LINE_INK = "#1f4e79";

/** A sequential light-to-dark blue ramp. */
const RAMP = [
  "#f2f7fc",
  "#c9ddf0",
  "#8dbbe0",
  "#4f8fc6",
  "#2563a6",
  "#123c73",
] as const;

function hex(c: string): [number, number, number] {
  return [
    Number.parseInt(c.slice(1, 3), 16),
    Number.parseInt(c.slice(3, 5), 16),
    Number.parseInt(c.slice(5, 7), 16),
  ];
}

function rampColor(t: number): string {
  const s = Math.min(1, Math.max(0, t)) * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(s));
  const f = s - i;
  const a = hex(RAMP[i] ?? RAMP[0]);
  const b = hex(RAMP[i + 1] ?? RAMP[0]);
  const mix = a.map((v, k) => Math.round(v + ((b[k] ?? v) - v) * f));
  return `rgb(${mix.join(",")})`;
}

interface Range {
  min: number;
  max: number;
}

function dataRange(prop: PropertyId): Range {
  const vals = ELEMENTS.map((e) => valueOf(e, prop)).filter(
    (v): v is number => v !== null,
  );
  return { min: Math.min(...vals), max: Math.max(...vals) };
}

function shade(v: number, r: Range): number {
  return (v - r.min) / (r.max - r.min);
}

// ---------- drawing ----------

interface Ctx {
  v: View;
  p: Params;
  model: DeepReadonly<Model>;
  prop: PropertyId;
  range: Range;
  /** The element shown in the info panel and highlighted in both views. */
  focus: Element | undefined;
  /** Symbols in the charted line that go against the trend, when `mark exceptions` is on. */
  odd: readonly string[];
}

interface LabelArgs {
  s: string;
  x: number;
  y: number;
  size: number;
  color?: string;
  bold?: boolean;
  align?: "left" | "center" | "right";
  valign?: "top" | "middle" | "bottom" | "baseline";
}

function label(c: Ctx, args: LabelArgs): void {
  c.v.text(
    args.s,
    { x: args.x, y: args.y },
    {
      size: args.size,
      style: args.bold === true ? "bold" : "normal",
      fill: args.color ?? INK,
      align: args.align ?? "left",
      valign: args.valign ?? "baseline",
    },
  );
}

function drawHeader(c: Ctx): void {
  const info = PROPERTIES[c.prop];
  label(c, {
    s: `Periodic trends: ${info.label.toLowerCase()}`,
    x: 28,
    y: 40,
    size: 24,
    bold: true,
  });
  label(c, { s: info.trend, x: 28, y: 66, size: 15, color: SOFT });
  label(c, {
    s: "Point at an element to read it; click to pin it.",
    x: CANVAS_W - 40,
    y: 40,
    size: 12,
    color: SOFT,
    align: "right",
  });
  label(c, {
    s: "Click a period or group number to chart that row or column.",
    x: CANVAS_W - 40,
    y: 58,
    size: 12,
    color: SOFT,
    align: "right",
  });
}

function drawCell(c: Ctx, e: Element): void {
  const { v } = c;
  const b = cellBox(e);
  const val = valueOf(e, c.prop);
  const t = val === null ? 0 : shade(val, c.range);
  const inLine =
    c.model.line.kind === "period"
      ? e.period === c.model.line.n
      : e.group === c.model.line.n;
  v.rect(b.x, b.y, b.w, b.h, { fill: val === null ? MISSING : rampColor(t) });
  if (inLine)
    v.rect(b.x + 0.75, b.y + 0.75, b.w - 1.5, b.h - 1.5, {
      stroke: LINE_INK,
      weight: 1.5,
    });
  const textColor = t > 0.55 ? "#ffffff" : INK;
  label(c, {
    s: String(e.z),
    x: b.x + 4,
    y: b.y + 3,
    size: 9,
    color: textColor,
    valign: "top",
  });
  label(c, {
    s: e.sym,
    x: b.x + b.w / 2,
    y: b.y + b.h / 2 - (c.p["show values"] || val === null ? 3 : 1),
    size: 18,
    color: textColor,
    bold: true,
    align: "center",
    valign: "middle",
  });
  if (c.p["show values"] || val === null) {
    const s =
      val === null ? "no value" : val.toFixed(PROPERTIES[c.prop].digits);
    label(c, {
      s,
      x: b.x + b.w / 2,
      y: b.y + b.h - 9,
      size: val === null ? 9 : 10,
      color: val === null ? SOFT : textColor,
      align: "center",
      valign: "middle",
    });
  }
  if (c.odd.includes(e.sym))
    v.circle(b.x + b.w - 8, b.y + 8, 4, { fill: ACCENT });
  v.debugBox(e.sym, b.x, b.y, b.w, b.h);
}

function drawFocusRing(c: Ctx, b: Box): void {
  c.v.rect(b.x - 3, b.y - 3, b.w + 6, b.h + 6, { stroke: ACCENT, weight: 3 });
}

function drawTable(c: Ctx): void {
  const { v, model } = c;
  // Placeholder for the transition metals.
  const g = gapBox();
  v.rect(g.x, g.y, g.w, g.h, { fill: "#f5f5f4" });
  v.at(
    { translate: [g.x + g.w / 2, g.y + g.h / 2], rotate: -Math.PI / 2 },
    () => {
      label(c, {
        s: "groups 3–12 (not shown)",
        x: 0,
        y: 0,
        size: 10,
        color: "#a8a29e",
        align: "center",
        valign: "middle",
      });
    },
  );

  for (const e of ELEMENTS) drawCell(c, e);

  // Clickable headers: the chosen line's header is drawn as a filled tab.
  for (const grp of GROUPS) {
    const b = groupHeaderBox(grp);
    const on = model.line.kind === "group" && model.line.n === grp;
    if (on) v.rect(b.x, b.y, b.w, b.h - 2, { fill: LINE_INK });
    label(c, {
      s: String(grp),
      x: b.x + b.w / 2,
      y: b.y + b.h / 2 - 1,
      size: 13,
      color: on ? "#ffffff" : SOFT,
      bold: on,
      align: "center",
      valign: "middle",
    });
    v.debugBox(`g${grp}`, b.x, b.y, b.w, b.h);
  }
  for (const per of PERIODS) {
    const b = periodLabelBox(per);
    const on = model.line.kind === "period" && model.line.n === per;
    if (on) v.rect(b.x, b.y, b.w - 2, b.h, { fill: LINE_INK });
    label(c, {
      s: String(per),
      x: b.x + b.w / 2 - 1,
      y: b.y + b.h / 2,
      size: 13,
      color: on ? "#ffffff" : SOFT,
      bold: on,
      align: "center",
      valign: "middle",
    });
    v.debugBox(`p${per}`, b.x, b.y, b.w, b.h);
  }
  label(c, {
    s: "group",
    x: groupHeaderBox(1).x,
    y: TABLE_Y - 32,
    size: 11,
    color: SOFT,
  });
  v.at(
    {
      translate: [periodLabelBox(1).x - 6, TABLE_Y + 30],
      rotate: -Math.PI / 2,
    },
    () => {
      label(c, {
        s: "period",
        x: 0,
        y: 0,
        size: 11,
        color: SOFT,
        align: "center",
        valign: "middle",
      });
    },
  );

  if (c.focus !== undefined) drawFocusRing(c, cellBox(c.focus));
}

function drawLegend(c: Ctx): void {
  const { v } = c;
  const x = periodLabelBox(1).x + 30;
  const y = tableBottom() + 26;
  const w = tableRight() - x;
  const h = 12;
  const steps = 60;
  for (let i = 0; i < steps; i++) {
    v.rect(x + (i * w) / steps, y, w / steps + 0.5, h, {
      fill: rampColor(i / (steps - 1)),
    });
  }
  const info = PROPERTIES[c.prop];
  label(c, {
    s: `${c.range.min.toFixed(info.digits)} (lowest)`,
    x,
    y: y + h + 4,
    size: 11,
    color: SOFT,
    valign: "top",
  });
  label(c, {
    s: `${c.range.max.toFixed(info.digits)} (highest)`,
    x: x + w,
    y: y + h + 4,
    size: 11,
    color: SOFT,
    align: "right",
    valign: "top",
  });
  label(c, {
    s: info.unit === "" ? info.label : `${info.label} (${info.unit})`,
    x: x + w / 2,
    y: y + h + 4,
    size: 11,
    color: SOFT,
    align: "center",
    valign: "top",
  });
  if (c.focus !== undefined) {
    const val = valueOf(c.focus, c.prop);
    if (val !== null) {
      const mx = x + shade(val, c.range) * w;
      v.triangle(mx, y - 1, mx - 5, y - 9, mx + 5, y - 9, { fill: ACCENT });
    }
  }
}

function asLine(l: DeepReadonly<Line>): Line {
  return l.kind === "period"
    ? { kind: "period", n: l.n }
    : { kind: "group", n: l.n };
}

interface Pt {
  e: Element;
  x: number;
  y: number;
}

/** One entry per x-axis slot; null where the slot is empty or the value is missing, so lines break there. */
function linePoints(line: Line, prop: PropertyId, range: Range): (Pt | null)[] {
  const count = line.kind === "period" ? GROUPS.length : PERIODS.length;
  const out: (Pt | null)[] = Array.from({ length: count }, () => null);
  for (const e of lineMembers(line)) {
    const val = valueOf(e, prop);
    if (val !== null)
      out[slot(line, e).index] = {
        e,
        x: chartX(line, e),
        y: chartY(val, range),
      };
  }
  return out;
}

/** Spread label y positions apart so none are closer than `gap`. */
function spread(ys: readonly number[], gap: number): number[] {
  const order = ys.map((y, i) => ({ y, i })).toSorted((a, b) => a.y - b.y);
  for (let k = 1; k < order.length; k++) {
    const prev = order[k - 1];
    const cur = order[k];
    if (prev !== undefined && cur !== undefined && cur.y - prev.y < gap)
      order[k] = { ...cur, y: prev.y + gap };
  }
  const out = [...ys];
  for (const o of order) out[o.i] = o.y;
  return out;
}

/** The faint comparison lines, each numbered at its right-hand end. */
function drawOthers(c: Ctx, a: { line: Line; axis: Range }): void {
  const { v, prop } = c;
  const others = (
    a.line.kind === "period"
      ? PERIODS.map((n): Line => ({ kind: "period", n }))
      : GROUPS.map((n): Line => ({ kind: "group", n }))
  ).filter((o) => o.n !== a.line.n);
  const ends: { n: number; x: number; y: number }[] = [];
  for (const o of others) {
    const pts = linePoints(o, prop, a.axis);
    strokeRuns(v, pts, { stroke: FAINT, weight: 1.5 });
    for (const pt of pts)
      if (pt !== null) v.circle(pt.x, pt.y, 2, { fill: FAINT });
    const last = pts.findLast((pt) => pt !== null);
    if (last !== undefined) ends.push({ n: o.n, x: last.x, y: last.y });
  }
  const ys = spread(
    ends.map((e) => e.y),
    11,
  );
  for (const [i, e] of ends.entries())
    label(c, {
      s: String(e.n),
      x: e.x + 12,
      y: ys[i] ?? e.y,
      size: 10,
      color: "#9ca3af",
      valign: "middle",
    });
}

function strokeRuns(v: View, pts: readonly (Pt | null)[], style: Style): void {
  let prev: Pt | null = null;
  for (const pt of pts) {
    if (pt !== null && prev !== null) v.line(prev.x, prev.y, pt.x, pt.y, style);
    prev = pt;
  }
}

function drawAxes(c: Ctx, axis: Range): void {
  const { v } = c;
  const info = PROPERTIES[c.prop];
  for (let t = axis.min; t <= axis.max + 1e-9; t += info.tick) {
    const y = chartY(t, axis);
    v.line(CHART.x, y, CHART.x + CHART.w, y, {
      stroke: t === axis.min ? "#9ca3af" : "#eceef1",
      weight: 1,
    });
    label(c, {
      s: t.toFixed(info.tick < 1 ? 1 : 0),
      x: CHART.x - 8,
      y,
      size: 11,
      color: SOFT,
      align: "right",
      valign: "middle",
    });
  }
  v.at(
    { translate: [CHART.x - 46, CHART.y + CHART.h / 2], rotate: -Math.PI / 2 },
    () => {
      label(c, {
        s: info.unit === "" ? info.label : `${info.label} (${info.unit})`,
        x: 0,
        y: 0,
        size: 12,
        color: SOFT,
        align: "center",
        valign: "middle",
      });
    },
  );
}

function drawChart(c: Ctx): void {
  const { v, model, prop } = c;
  const info = PROPERTIES[prop];
  const axis = { min: info.min, max: info.max };
  const line = asLine(model.line);

  label(c, {
    s: `${info.label}: ${lineTitle(line).toLowerCase()}`,
    x: CHART.x - 46,
    y: CHART.y - 34,
    size: 16,
    bold: true,
  });
  drawAxes(c, axis);

  const kind = line.kind === "period" ? "periods" : "groups";
  label(c, {
    s: `Grey lines: the other ${kind}, numbered at their right-hand end.`,
    x: CHART.x - 46,
    y: CHART.y - 14,
    size: 11,
    color: SOFT,
  });
  drawOthers(c, { line, axis });

  const pts = linePoints(line, prop, axis);
  strokeRuns(v, pts, { stroke: LINE_INK, weight: 2.5 });

  const { odd } = c;
  for (const pt of pts) {
    if (pt === null) continue;
    const val = valueOf(pt.e, prop) ?? 0;
    v.circle(pt.x, pt.y, 5.5, {
      fill: rampColor(shade(val, c.range)),
      stroke: LINE_INK,
      weight: 1.5,
    });
    if (odd.includes(pt.e.sym))
      v.circle(pt.x, pt.y, 11, { stroke: ACCENT, weight: 2 });
  }

  // x-axis labels: the element symbols, with a dash where there is no value.
  for (const e of lineMembers(line)) {
    const x = chartX(line, e);
    const focused = c.focus?.sym === e.sym;
    label(c, {
      s: e.sym,
      x,
      y: CHART.y + CHART.h + 8,
      size: 14,
      color: focused ? ACCENT : INK,
      bold: true,
      align: "center",
      valign: "top",
    });
    if (valueOf(e, prop) === null)
      label(c, {
        s: "no value",
        x,
        y: CHART.y + CHART.h - 18,
        size: 10,
        color: SOFT,
        align: "center",
        valign: "top",
      });
  }
  const axisNote =
    line.kind === "period"
      ? "group 1 → 18 (left to right)"
      : "period 1 → 6 (top to bottom)";
  label(c, {
    s: axisNote,
    x: CHART.x + CHART.w / 2,
    y: CHART.y + CHART.h + 28,
    size: 11,
    color: SOFT,
    align: "center",
    valign: "top",
  });

  if (c.focus !== undefined) drawChartFocus(c, { line, axis, odd });
}

function drawChartFocus(
  c: Ctx,
  a: { line: Line; axis: Range; odd: readonly string[] },
): void {
  const { v, prop } = c;
  const e = c.focus;
  if (e === undefined) return;
  const inLine = lineMembers(a.line).some((m) => m.sym === e.sym);
  const val = valueOf(e, prop);
  if (!inLine || val === null) return;
  const x = chartX(a.line, e);
  const y = chartY(val, a.axis);
  v.line(x, y + 8, x, CHART.y + CHART.h, { stroke: ACCENT, weight: 1 });
  v.circle(x, y, 7, { fill: ACCENT });
  // Near the top of the plot the label goes beside the point, clear of the caption above.
  const nearTop = y < CHART.y + 24;
  label(c, {
    s: formatValue(val, prop),
    x: nearTop ? x - 14 : x,
    y: nearTop ? y : y - 12,
    size: 13,
    color: ACCENT,
    bold: true,
    align: nearTop ? "right" : "center",
    valign: nearTop ? "middle" : "bottom",
  });
}

/** Wrap `s` into lines of at most `chars` characters. */
function wrap(s: string, chars: number): string[] {
  const lines: string[] = [];
  let cur = "";
  for (const word of s.split(" ")) {
    if (cur !== "" && cur.length + 1 + word.length > chars) {
      lines.push(cur);
      cur = word;
    } else {
      cur = cur === "" ? word : `${cur} ${word}`;
    }
  }
  if (cur !== "") lines.push(cur);
  return lines;
}

function drawInfo(c: Ctx): void {
  const { prop } = c;
  const x = 28;
  const y = tableBottom() + 82;
  const e = c.focus;
  if (e === undefined) {
    label(c, {
      s: "Point at an element to see its name and value here.",
      x,
      y,
      size: 14,
      color: SOFT,
    });
    return;
  }
  label(c, { s: `${e.name} (${e.sym})`, x, y, size: 20, bold: true });
  label(c, {
    s: `atomic number ${e.z} · period ${e.period} · group ${e.group}`,
    x,
    y: y + 22,
    size: 13,
    color: SOFT,
  });
  label(c, {
    s: `${PROPERTIES[prop].label}: ${formatValue(valueOf(e, prop), prop)}`,
    x,
    y: y + 48,
    size: 16,
    color: ACCENT,
    bold: true,
  });
  const note = rankNote(e, prop);
  if (note !== "") label(c, { s: note, x, y: y + 70, size: 13, color: INK });
}

function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
}

function rankNote(e: Element, prop: PropertyId): string {
  const val = valueOf(e, prop);
  if (val === null)
    return "Noble gases like this one rarely form bonds, so there is no Pauling value.";
  const vals = ELEMENTS.map((m) => valueOf(m, prop)).filter(
    (x): x is number => x !== null,
  );
  const higher = vals.filter((x) => x > val).length;
  const lower = vals.filter((x) => x < val).length;
  const fromTop = higher < lower;
  const rank = (fromTop ? higher : lower) + 1;
  const end = fromTop ? "highest" : "lowest";
  const place = rank === 1 ? `The ${end}` : `${ordinal(rank)} ${end}`;
  return `${place} of the ${vals.length} elements with a value here.`;
}

function drawExplain(c: Ctx): void {
  const info = PROPERTIES[c.prop];
  const line = asLine(c.model.line);
  let y = CHART.y + CHART.h + 64;
  const x = CHART.x - 46;
  for (const s of wrap(info.why, 52)) {
    label(c, { s, x, y, size: 13, color: INK });
    y += 18;
  }
  if (c.p["mark exceptions"]) {
    const odd = exceptions(line, c.prop);
    const s =
      odd.length === 0
        ? `No exceptions ${lineTitle(line).toLowerCase()}: every step follows the trend.`
        : `Against the trend here: ${odd.map((e) => e.sym).join(", ")} (circled on the chart, dotted in the table).`;
    y += 6;
    for (const part of wrap(s, 48)) {
      label(c, { s: part, x, y, size: 13, color: ACCENT, bold: true });
      y += 18;
    }
  }
}

function drawSource(c: Ctx): void {
  const s = `Data: ${PROPERTIES[c.prop].source}. Main-group elements, periods 1–6.`;
  label(c, { s, x: 28, y: CANVAS_H - 16, size: 11, color: SOFT });
}

export function draw(v: View, model: DeepReadonly<Model>, p: Params): void {
  const prop = p.property;
  const sym = model.hover ?? model.selected;
  const odd = p["mark exceptions"]
    ? exceptions(asLine(model.line), prop).map((e) => e.sym)
    : [];
  const c: Ctx = {
    v,
    p,
    model,
    prop,
    range: dataRange(prop),
    focus: sym === null ? undefined : bySymbol(sym),
    odd,
  };
  v.cursor(model.hover === null ? "default" : "pointer");
  v.background(PAPER);
  drawHeader(c);
  drawTable(c);
  drawLegend(c);
  drawChart(c);
  drawInfo(c);
  drawExplain(c);
  drawSource(c);
}
