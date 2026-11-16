// `v.row` and `v.column`: each child placed by its layout box (layout-box.ts),
// in order, `gap` apart. A child is moved by `cursor − box.x` (or `box.y`), so
// one drawn at its own origin and one drawn at (240, 80) land the same. A
// child that draws nothing a layout can place keeps its place in the list but
// takes no room and no gap. The positions are fixed when the call returns.
import { SketchUsageError } from "../../core/errors.js";
import type { Bounds, FlowOptions } from "../../core/paint.js";
import type { AtNode, SceneNode } from "../nodes.js";
import { layoutBox } from "./layout-box.js";

type Flow = "row" | "column";

const KEYS: readonly string[] = ["x", "y", "gap", "align", "valign"];
const ALIGNS = ["left", "center", "right"];
const VALIGNS = { row: ["top", "middle", "bottom", "baseline"], column: ["top", "middle", "bottom"] } as const;

/** The options, checked at the call: known keys, finite numbers, and the alignments this flow takes. */
function checked(call: Flow, options: FlowOptions): Required<FlowOptions> {
  if (typeof options !== "object" || Array.isArray(options)) throw new SketchUsageError({ detail: `${call}: the first argument is an options object ({ x, y, gap, align, valign }); the children come second` });
  for (const key of Object.keys(options)) {
    if (!KEYS.includes(key)) throw new SketchUsageError({ detail: `${call}: unknown option "${key}" (${KEYS.join(", ")})` });
  }
  const o = { x: options.x ?? 0, y: options.y ?? 0, gap: options.gap ?? 0, align: options.align ?? "left", valign: options.valign ?? "top" };
  for (const key of ["x", "y", "gap"] as const) {
    if (!Number.isFinite(o[key])) throw new SketchUsageError({ detail: `${call}: option ${key} must be a finite number (got ${String(o[key])})` });
  }
  if (!ALIGNS.includes(o.align)) throw new SketchUsageError({ detail: `${call}: option align must be ${ALIGNS.join(", ")} (got ${JSON.stringify(o.align)})` });
  const valigns: readonly string[] = VALIGNS[call];
  if (!valigns.includes(o.valign)) throw new SketchUsageError({ detail: `${call}: option valign must be ${valigns.join(", ")} (got ${JSON.stringify(o.valign)})${o.valign === "baseline" ? "; a column's baseline is its first child's, so put the column in a row with valign baseline" : ""}` });
  return o;
}

/** Where along the cross axis `b` is aligned: its top (left), middle (centre), bottom (right) or baseline (a box with none by its bottom). */
function crossEdge(b: Bounds, a: { along: "x" | "y"; mode: string }): number {
  const start = a.along === "x" ? b.x : b.y;
  const size = a.along === "x" ? b.w : b.h;
  if (a.mode === "middle" || a.mode === "center") return start + size / 2;
  if (a.mode === "bottom" || a.mode === "right") return start + size;
  if (a.mode === "baseline") return b.baseline ?? start + size;
  return start;
}

/** The children of a flow's `at` node: each child with a box inside its own translating `at`, the rest as they are. */
export function flowChildren(call: Flow, a: { options: FlowOptions; nodes: readonly SceneNode[] }): SceneNode[] {
  const o = checked(call, a.options);
  const row = call === "row";
  const items = a.nodes.map((node) => ({ node, box: layoutBox([node]) }));
  // Main axis: the offset of each child from the flow's start, and the total length.
  let cursor = 0;
  let first = true;
  const along = items.map(({ box }) => {
    if (box === null) return 0;
    if (!first) cursor += o.gap;
    first = false;
    const d = cursor - (row ? box.x : box.y);
    cursor += row ? box.w : box.h;
    return d;
  });
  const anchor = row ? { left: 0, center: 0.5, right: 1 }[o.align] : { top: 0, middle: 0.5, bottom: 1, baseline: 0 }[o.valign];
  const start = (row ? o.x : o.y) - anchor * cursor;
  return items.map(({ node, box }, i): SceneNode => {
    if (box === null) return node;
    const main = start + (along[i] ?? 0);
    const cross = row ? o.y - crossEdge(box, { along: "y", mode: o.valign }) : o.x - crossEdge(box, { along: "x", mode: o.align });
    const at: AtNode = { kind: "at", matrix: row ? [1, 0, 0, 1, main, cross] : [1, 0, 0, 1, cross, main], children: [node] };
    return at;
  });
}
