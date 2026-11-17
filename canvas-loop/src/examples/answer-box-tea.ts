// A typed answer over the canvas: `answer` is a `text` param placed with
// `v.control`, so a browser shows a real text box, and every edit arrives as a
// `param` msg that `update` checks. `activity` reports what the state means
// after each handled input. The tiles are as wide as their labels and hit by
// name. Linked from TEA.md "Inputs over the canvas" and "Activity".
import type { DeepReadonly, Drawing, Msg, ParamsDecl, RootDrawing, TextOptions, Util, View } from "@ianbicking/canvas-loop";

export const canvas = { width: 420, height: 220 };

export const params = {
  answer: { type: "text", default: "", placeholder: "g/mol", maxLength: 12, label: "Answer", panel: false },
} as const satisfies ParamsDecl;

const ELEMENTS = [
  { symbol: "H", name: "Hydrogen", mass: 1.008 },
  { symbol: "O", name: "Oxygen", mass: 16.0 },
] as const;
const MOLAR_MASS = 2 * 1.008 + 16.0;
const LABEL: TextOptions = { size: 15, style: "bold", valign: "middle", fill: "#1e293b" };
const BODY: TextOptions = { size: 15, valign: "middle", fill: "#0f172a" };

export interface Model {
  shown: readonly string[];
  verdict: "empty" | "unreadable" | "right" | "wrong";
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
      const hit = ELEMENTS.find((e) => msg.targets.includes(`tile-${e.symbol}`));
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
    case "mouseleave":
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

/** One element tile, as wide as its label, named for its symbol. */
function tile(v: View, e: (typeof ELEMENTS)[number], open: boolean): Drawing {
  const label = open ? `${e.name} ${e.mass.toFixed(3)}` : e.name;
  const w = v.textWidth(label, LABEL) + 24;
  return v.at({ name: `tile-${e.symbol}` }, [
    v.roundRect(0, 0, w, 34, 6, { fill: open ? "#dbeafe" : "#ffffff", stroke: "#94a3b8", weight: 1 }),
    v.text(label, { x: 12, y: 17 }, LABEL),
  ]);
}

export function draw(v: View, model: DeepReadonly<Model>): RootDrawing {
  const verdict = VERDICT[model.verdict];
  v.control("answer", { x: 90, y: 128, w: 120, h: 28, size: 15 });
  return [
    v.background("#f8fafc"),
    v.text(["What is the molar mass of water (H", { text: "2", sub: true }, "O)?"], { x: 20, y: 22 }, { size: 17, fill: "#0f172a" }),
    v.row({ x: 20, y: 70, gap: 12 }, ELEMENTS.map((e) => tile(v, e, model.shown.includes(e.symbol)))),
    v.text("Answer:", { x: 20, y: 142 }, BODY),
    v.text("g/mol", { x: 218, y: 142 }, { ...BODY, fill: "#475569" }),
    v.text(verdict.text, { x: 20, y: 186 }, { size: 15, fill: verdict.fill }),
  ];
}
