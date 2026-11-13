// Pendulum lab, for a learner of about 13–16.
//
//   - Settings (typed or chosen in the drawing, `v.control`): string length
//     (0.1–2.0 m), gravity (Earth, Moon, Mars, Jupiter), release angle
//     (1–30°) and a speed-up for long trials.
//   - "Time 10 swings" (or clicking the held bob) releases the pendulum; an
//     automatic stopwatch stops when the bob has come back to the release side
//     ten times. The period (time ÷ 10) goes into the results table and onto
//     the graph of period against length.
//   - "Theory curve" draws T = 2π√(L/g) for each place with trials; "Plot
//     against √L" straightens those curves into lines.
//   - Changing a setting puts the bob back in the hand; results stay until
//     "Clear results".
//
// The swing integrates the full pendulum equation (physics-tea.ts), so a 30°
// release measures about 1.7% slower than a 5° one, as a real pendulum does.
import type {
  DeepReadonly,
  Msg,
  ParamsDecl,
  ParamValues,
  Util,
  View,
} from "@ianbicking/canvas-loop";

import {
  axesFor,
  drawGraph,
  drawTable,
  GRAPH_CARD,
  pointAt,
  rowAt,
  TABLE_CARD,
  theoryPlanets,
  type Trial,
} from "./chart-tea.js";
import { card, FAINT, GOOD, INK, PAGE, say, sayWidth, SOFT } from "./look-tea.js";
import {
  advance,
  PLANETS,
  release,
  SWINGS_PER_TRIAL,
  type Swing,
} from "./physics-tea.js";
import { bobAt, drawBackdrop, drawPendulum, STAGE } from "./stage-tea.js";

export const params = {
  length: {
    type: "number",
    min: 0.1,
    max: 2,
    step: 0.01,
    default: 1,
    control: "field",
    label: "String length (m)",
    panel: false,
  },
  gravity: {
    type: "select",
    options: PLANETS,
    default: "Earth",
    label: "Gravity",
    panel: false,
  },
  angle: {
    type: "number",
    min: 1,
    max: 30,
    step: 1,
    default: 10,
    control: "field",
    label: "Release angle (°)",
    panel: false,
  },
  speed: {
    type: "select",
    options: ["1×", "4×", "16×"] as const,
    default: "1×",
    label: "Speed",
    panel: false,
  },
  theory: {
    type: "boolean",
    default: false,
    label: "Theory curve",
    panel: false,
  },
  sqrtAxis: {
    type: "boolean",
    default: false,
    label: "Plot against √L",
    panel: false,
  },
  time: { type: "trigger", label: "Time 10 swings", panel: false },
  clear: { type: "trigger", label: "Clear results", panel: false },
} as const satisfies ParamsDecl;

export const canvas = { width: 960, height: 636 };

type Params = ParamValues<typeof params>;

type Mode =
  | { type: "held" }
  | { type: "timing"; swing: Swing }
  | { type: "free"; swing: Swing; total: number };

export interface Model {
  frame: number;
  mode: Mode;
  trials: readonly Trial[];
  nextN: number;
  pointer: { x: number; y: number } | null;
  /** The newest trial and the frame it landed on (drives a short highlight). */
  fresh: { n: number; frame: number } | null;
}

const SPEED: Record<Params["speed"], number> = { "1×": 1, "4×": 4, "16×": 16 };
const RESETS_SWING = new Set(["length", "gravity", "angle"]);

// ---------- update ----------

export function init(): Model {
  return { frame: 0, mode: { type: "held" }, trials: [], nextN: 1, pointer: null, fresh: null };
}

function start(model: DeepReadonly<Model>, u: Util<typeof params>): Model {
  const p = u.params;
  u.log(`release: ${p.gravity}, L=${p.length.toFixed(2)} m, ${p.angle}°`);
  return { ...model, mode: { type: "timing", swing: release({ length: p.length, planet: p.gravity, angle: p.angle }) } };
}

function tick(model: DeepReadonly<Model>, a: { frame: number; u: Util<typeof params> }): Model {
  const base = { ...model, frame: a.frame };
  const mode = model.mode;
  const seconds = SPEED[a.u.params.speed] / 60;
  switch (mode.type) {
    case "held":
      return base;
    case "free":
      return { ...base, mode: { ...mode, swing: advance(mode.swing, seconds).swing } };
    case "timing": {
      const step = advance(mode.swing, seconds);
      if (step.finishedAt === null) return { ...base, mode: { type: "timing", swing: step.swing } };
      const s = step.swing;
      const total = Math.round(step.finishedAt * 100) / 100;
      const trial: Trial = { n: model.nextN, planet: s.planet, length: s.length, angle: s.angle, total, period: total / SWINGS_PER_TRIAL };
      a.u.log(`trial ${trial.n}: ${trial.planet} L=${trial.length.toFixed(2)} ${trial.angle}° → 10 swings ${total.toFixed(2)} s, T=${trial.period.toFixed(3)} s`);
      return {
        ...base,
        mode: { type: "free", swing: s, total },
        trials: [...base.trials, trial],
        nextN: model.nextN + 1,
        fresh: { n: trial.n, frame: a.frame },
      };
    }
  }
}

function onPress(model: DeepReadonly<Model>, a: { x: number; y: number; u: Util<typeof params> }): Model {
  if (model.mode.type !== "held") return model;
  const p = a.u.params;
  const bob = bobAt({ theta: (p.angle * Math.PI) / 180, length: p.length });
  if (Math.hypot(bob.x - a.x, bob.y - a.y) > 18) return model;
  a.u.handled("let-go");
  return start(model, a.u);
}

export function update(model: DeepReadonly<Model>, msg: Msg, u: Util<typeof params>): Model {
  switch (msg.type) {
    case "tick":
      return tick(model, { frame: msg.frame, u });
    case "param":
      if (RESETS_SWING.has(msg.name) && model.mode.type !== "held") return { ...model, mode: { type: "held" } };
      return model;
    case "trigger":
      if (msg.name === "time") return start(model, u);
      if (msg.name === "clear") return { ...model, trials: [], nextN: 1, fresh: null };
      return model;
    case "mousemove":
      return { ...model, pointer: { x: msg.x, y: msg.y } };
    case "mousedown":
      return onPress(model, { x: msg.x, y: msg.y, u });
    case "mouseup":
    case "keydown":
    case "keyup":
      return model;
  }
}

// ---------- draw ----------

const CONTROLS = { x: 20, y: 452, w: 428, h: 168 };

function drawStopwatch(v: View, a: { mode: DeepReadonly<Mode>; frame: number }): void {
  const { mode } = a;
  const t = mode.type === "held" ? 0 : mode.type === "timing" ? mode.swing.t : mode.total;
  const swings = mode.type === "held" ? 0 : mode.type === "timing" ? mode.swing.swings : SWINGS_PER_TRIAL;
  const done = mode.type === "free";
  const running = mode.type === "timing";
  const x0 = CONTROLS.x + 16;
  say(v, "Stopwatch", { x: x0, y: CONTROLS.y + 24 }, { size: 14, bold: true });
  // dial: one turn per 10 s
  const cx = x0 + 26;
  const cy = CONTROLS.y + 64;
  v.circle(cx, cy - 27, 4, { fill: "#4b4f5a" });
  v.circle(cx, cy, 25, { fill: "#ffffff", stroke: done ? GOOD : INK, weight: 2.5 });
  for (let i = 0; i < 10; i += 1) {
    const ang = (i / 10) * Math.PI * 2 - Math.PI / 2;
    v.line(cx + 19 * Math.cos(ang), cy + 19 * Math.sin(ang), cx + 22 * Math.cos(ang), cy + 22 * Math.sin(ang), { stroke: SOFT, weight: 1 });
  }
  const hand = (t / 10) * Math.PI * 2 - Math.PI / 2;
  v.line(cx, cy, cx + 18 * Math.cos(hand), cy + 18 * Math.sin(hand), { stroke: "#c03a2b", weight: 2 });
  v.circle(cx, cy, 2, { fill: "#c03a2b" });
  // reading
  const fill = done ? GOOD : running ? INK : FAINT;
  say(v, `${t.toFixed(2)} s`, { x: x0 + 62, y: cy + 2 }, { size: 24, bold: true, fill, valign: "middle" });
  // ten swing pips
  for (let i = 0; i < SWINGS_PER_TRIAL; i += 1) {
    const filled = i < swings;
    v.circle(x0 + 6 + i * 15, CONTROLS.y + 106, 5, filled ? { fill: done ? GOOD : "#d9a43a" } : { stroke: FAINT, weight: 1.25 });
  }
  const caption = done ? "10 swings: done" : running ? `swing ${Math.min(swings + 1, SWINGS_PER_TRIAL)} of 10` : "ready";
  say(v, caption, { x: x0, y: CONTROLS.y + 128 }, { size: 12, fill: SOFT });
  v.control("time", { x: x0, y: CONTROLS.y + 134, w: 150, h: 26, size: 13, bold: true });
}

function drawSettings(v: View): void {
  const lx = CONTROLS.x + 196;
  v.line(lx - 12, CONTROLS.y + 14, lx - 12, CONTROLS.y + CONTROLS.h - 14, { stroke: "#ece5d6", weight: 1.5 });
  const rows: { name: "length" | "gravity" | "angle" | "speed"; label: string; unit: string; w: number }[] = [
    { name: "length", label: "String length", unit: "m", w: 80 },
    { name: "gravity", label: "Gravity", unit: "", w: 104 },
    { name: "angle", label: "Release angle", unit: "°", w: 80 },
    { name: "speed", label: "Speed", unit: "", w: 104 },
  ];
  for (const [i, r] of rows.entries()) {
    const top = CONTROLS.y + 14 + i * 37;
    say(v, r.label, { x: lx, y: top + 14 }, { size: 13, fill: INK, valign: "middle" });
    v.control(r.name, { x: lx + 100, y: top, w: r.w, h: 28, size: 14 });
    if (r.unit !== "") say(v, r.unit, { x: lx + 100 + r.w + 6, y: top + 14 }, { size: 14, fill: SOFT, valign: "middle" });
  }
}

function drawBanner(v: View, model: DeepReadonly<Model>): void {
  const fresh = model.fresh;
  if (fresh === null || model.mode.type !== "free") return;
  const age = model.frame - fresh.frame;
  const trial = model.trials.find((t) => t.n === fresh.n);
  if (trial === undefined || age > 240) return;
  const w = 150;
  const x = STAGE.x + STAGE.w - w - 12;
  const y = STAGE.y + 40;
  v.group({ opacity: age > 200 ? (240 - age) / 40 : 1 }, () => {
    v.roundRect(x, y, w, 50, 10, { fill: "rgba(255, 255, 255, 0.94)", stroke: GOOD, weight: 1.5 });
    say(v, `10 swings in ${trial.total.toFixed(2)} s`, { x: x + w / 2, y: y + 17 }, { size: 12, fill: GOOD, align: "center", valign: "middle" });
    say(v, `T = ${trial.period.toFixed(3)} s`, { x: x + w / 2, y: y + 35 }, { size: 17, bold: true, fill: GOOD, align: "center", valign: "middle" });
  });
}

function drawPlace(v: View, planet: Params["gravity"]): void {
  const s = `${planet === "Jupiter" ? "Jupiter cloud tops" : planet}  ·  g = ${planetG(planet)} m/s²`;
  const w = sayWidth(v, s, { size: 12, bold: true }) + 20;
  const x = STAGE.x + STAGE.w - w - 10;
  const y = STAGE.y + 10;
  v.roundRect(x, y, w, 22, 11, { fill: "rgba(32, 30, 40, 0.72)" });
  say(v, s, { x: x + 10, y: y + 11 }, { size: 12, bold: true, fill: "#ffffff", valign: "middle" });
}

export function draw(v: View, model: DeepReadonly<Model>, p: Params): void {
  v.background(PAGE);
  say(v, "Pendulum Lab", { x: 22, y: 38 }, { size: 24, bold: true });
  say(v, "How does the length of the string change the time for one swing?", { x: 196, y: 37 }, { size: 14, fill: SOFT, italic: true });

  const mode = model.mode;
  const planet = mode.type === "held" ? p.gravity : mode.swing.planet;
  drawBackdrop(v, planet);
  const pose =
    mode.type === "held"
      ? { theta: (p.angle * Math.PI) / 180, omega: 0, length: p.length, angle: p.angle, held: true, dark: planet === "Moon" || planet === "Jupiter" }
      : { theta: mode.swing.theta, omega: mode.swing.omega, length: mode.swing.length, angle: mode.swing.angle, held: false, dark: planet === "Moon" || planet === "Jupiter" };
  drawPendulum(v, pose);
  drawPlace(v, planet);
  drawBanner(v, model);

  card(v, CONTROLS);
  drawStopwatch(v, { mode, frame: model.frame });
  drawSettings(v);

  const axes = axesFor(model.trials, { sqrt: p.sqrtAxis, theory: p.theory, current: p.gravity });
  const ptr = model.pointer;
  const focus = ptr === null ? null : (pointAt(model.trials, { axes, x: ptr.x, y: ptr.y }) ?? rowAt(model.trials, ptr));
  const fresh = model.fresh === null ? null : { n: model.fresh.n, age: model.frame - model.fresh.frame };
  drawGraph(v, { trials: model.trials, axes, theory: p.theory ? theoryPlanets(model.trials, p.gravity) : null, focus, fresh });
  v.control("theory", { x: GRAPH_CARD.x + 232, y: GRAPH_CARD.y + 12, w: 20, h: 22 });
  say(v, "Theory curve", { x: GRAPH_CARD.x + 254, y: GRAPH_CARD.y + 23 }, { size: 13, valign: "middle" });
  v.control("sqrtAxis", { x: GRAPH_CARD.x + 346, y: GRAPH_CARD.y + 12, w: 20, h: 22 });
  say(v, "Plot against √L", { x: GRAPH_CARD.x + 368, y: GRAPH_CARD.y + 23 }, { size: 13, valign: "middle" });

  drawTable(v, { trials: model.trials, theory: p.theory, focus, fresh });
  v.control("clear", { x: TABLE_CARD.x + TABLE_CARD.w - 116, y: TABLE_CARD.y + 12, w: 100, h: 26, size: 12 });
}

function planetG(planet: Params["gravity"]): string {
  const g = { Earth: 9.81, Moon: 1.62, Mars: 3.71, Jupiter: 24.79 } as const;
  return g[planet].toFixed(2);
}
