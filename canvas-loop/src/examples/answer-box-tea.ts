// A typed answer and tiles sized to their labels:
//
//   - `answer` is a `text` param placed over the canvas with `v.control`: a real
//     text box (paste, keyboard, screen readers). Each edit arrives as a
//     `param` msg; `update` checks it.
//   - the element tiles are as wide as their labels. `tiles(measure)` lays them
//     out from a width function: `update` passes `u.textWidth` to hit-test a
//     click, `draw` passes `v.textWidth` to paint, and the two agree exactly.
//
//   - `activity(model)` turns the state into data after each handled action,
//     the way `draw` turns it into pixels; a host such as a figure may log it.
//
// Click a tile to show its atomic mass.
import type { DeepReadonly, Msg, ParamsDecl, Util, View } from "@ianbicking/canvas-loop";

export const canvas = { width: 420, height: 220 };

export const params = {
  answer: { type: "text", default: "", placeholder: "g/mol", maxLength: 12, label: "Answer", panel: false },
} as const satisfies ParamsDecl;

const ELEMENTS = [
  { symbol: "H", name: "Hydrogen", mass: 1.008 },
  { symbol: "O", name: "Oxygen", mass: 16.0 },
] as const;
const MOLAR_MASS = 2 * 1.008 + 16.0;
const LABEL = { size: 15, style: "bold" } as const;

export interface Model {
  shown: readonly string[];
  verdict: "empty" | "unreadable" | "right" | "wrong";
}

interface Tile {
  symbol: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Tiles in a row, each as wide as its label plus padding. */
function tiles(measure: (text: string) => number, shown: readonly string[]): Tile[] {
  let x = 20;
  return ELEMENTS.map((e) => {
    const label = shown.includes(e.symbol) ? `${e.name} ${e.mass.toFixed(3)}` : e.name;
    const tile = { symbol: e.symbol, label, x, y: 70, w: measure(label) + 24, h: 34 };
    x += tile.w + 12;
    return tile;
  });
}

function judge(text: string): Model["verdict"] {
  if (text.trim() === "") return "empty";
  const value = Number(text.trim());
  if (!Number.isFinite(value)) return "unreadable";
  return Math.abs(value - MOLAR_MASS) < 0.05 ? "right" : "wrong";
}

export function init(u: Util<typeof params>): Model {
  return { shown: [], verdict: judge(u.params.answer) };
}

export function update(model: DeepReadonly<Model>, msg: Msg, u: Util<typeof params>): Model {
  switch (msg.type) {
    case "param":
      return { ...model, verdict: judge(u.params.answer) };
    case "mousedown": {
      const hit = tiles((s) => u.textWidth(s, LABEL), model.shown).find((t) => msg.x >= t.x && msg.x <= t.x + t.w && msg.y >= t.y && msg.y <= t.y + t.h);
      if (hit === undefined) return model;
      u.handled(`tile-${hit.symbol}`);
      const shown = model.shown.includes(hit.symbol) ? model.shown.filter((s) => s !== hit.symbol) : [...model.shown, hit.symbol];
      return { ...model, shown };
    }
    case "tick":
    case "mouseup":
    case "mousemove":
    case "keydown":
    case "keyup":
    case "trigger":
      return model;
  }
}

/** What the state means now, for a host that logs it: the answer's verdict and the tiles opened. */
export function activity(model: DeepReadonly<Model>): Record<string, unknown> {
  return { verdict: model.verdict, shown: [...model.shown] };
}

const VERDICT: Record<Model["verdict"], { text: string; fill: string }> = {
  empty: { text: "Type the molar mass of water.", fill: "#475569" },
  unreadable: { text: "Write a number, like 20.5.", fill: "#b45309" },
  right: { text: "Right: 2 × 1.008 + 16.000 = 18.016 g/mol.", fill: "#15803d" },
  wrong: { text: "Not yet. Click the tiles for the atomic masses.", fill: "#b91c1c" },
};

export function draw(v: View, model: DeepReadonly<Model>): void {
  v.background("#f8fafc");
  v.text("What is the molar mass of water (H2O)?", { x: 20, y: 22 }, { size: 17, fill: "#0f172a" });
  for (const t of tiles((s) => v.textWidth(s, LABEL), model.shown)) {
    v.roundRect(t.x, t.y, t.w, t.h, 6, { fill: model.shown.includes(t.symbol) ? "#dbeafe" : "#ffffff", stroke: "#94a3b8", weight: 1 });
    v.text(t.label, { x: t.x + 12, y: t.y + t.h / 2 }, { ...LABEL, valign: "middle", fill: "#1e293b" });
  }
  v.text("Answer:", { x: 20, y: 142 }, { size: 15, valign: "middle", fill: "#0f172a" });
  v.control("answer", { x: 90, y: 128, w: 120, h: 28, size: 15 });
  v.text("g/mol", { x: 218, y: 142 }, { size: 15, valign: "middle", fill: "#475569" });
  const verdict = VERDICT[model.verdict];
  v.text(verdict.text, { x: 20, y: 186 }, { size: 15, fill: verdict.fill });
}
