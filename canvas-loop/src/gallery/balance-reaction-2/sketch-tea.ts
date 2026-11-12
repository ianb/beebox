// Balancing a chemical equation, for a learner of about 12-15.
//
// The learner picks a reaction and types a whole-number coefficient (1-12) in
// front of each substance. The picture draws each side's molecules, repeated
// by coefficient, and tallies every element on each side. Pointing at a tally
// row lights up that element's atoms; clicking a row keeps it lit. When every
// element matches, the banner turns green and a few atoms burst out of it.
import type { DeepReadonly, Msg, ParamsDecl, ParamValues, Util, View } from "@ianbicking/canvas-loop";
import { analyse, REACTION_LABELS } from "./chem-tea.js";
import type { Analysis, El } from "./chem-tea.js";
import { paint } from "./draw-tea.js";
import { H, tallyRowAt, W } from "./layout-tea.js";

const coefficient = (n: number) =>
  ({
    type: "number",
    min: 1,
    max: 12,
    step: 1,
    default: 1,
    control: "field",
    label: `Number ${n}`,
    hint: "How many of this molecule (1-12)",
    panel: false,
  }) as const;

export const params = {
  reaction: { type: "select", options: REACTION_LABELS, default: REACTION_LABELS[0], label: "Reaction", panel: false },
  c1: coefficient(1),
  c2: coefficient(2),
  c3: coefficient(3),
  c4: coefficient(4),
} as const satisfies ParamsDecl;

export const canvas = { width: W, height: H };

export type Params = ParamValues<typeof params>;

export interface Model {
  frame: number;
  /** The element under the pointer in the tally. */
  hover: El | null;
  /** The element the learner clicked to keep lit. */
  pinned: El | null;
  /** The frame the current balanced answer was first reached, or null. */
  balancedAt: number | null;
  /** Which answer `balancedAt` belongs to (reaction + numbers). */
  balancedKey: string;
}

export function analysisOf(p: DeepReadonly<Params>): Analysis {
  return analyse(p.reaction, [p.c1, p.c2, p.c3, p.c4]);
}

function answerKey(analysis: Analysis): string {
  return [analysis.reaction.label, ...[...analysis.left, ...analysis.right].map((s) => s.coefficient)].join(",");
}

export function init(): Model {
  return { frame: 0, hover: null, pinned: null, balancedAt: null, balancedKey: "" };
}

function elementAt(p: DeepReadonly<Params>, x: number, y: number): El | null {
  const { tallies } = analysisOf(p);
  const row = tallyRowAt(tallies.length, x, y);
  return row === null ? null : (tallies[row]?.el ?? null);
}

function onTick(model: DeepReadonly<Model>, frame: number, p: DeepReadonly<Params>): Model {
  const analysis = analysisOf(p);
  if (!analysis.balanced) return { ...model, frame, balancedAt: null, balancedKey: "" };
  const key = answerKey(analysis);
  if (model.balancedAt !== null && model.balancedKey === key) return { ...model, frame };
  return { ...model, frame, balancedAt: frame, balancedKey: key };
}

export function update(model: DeepReadonly<Model>, msg: Msg, u: Util<typeof params>): Model {
  switch (msg.type) {
    case "tick":
      return onTick(model, msg.frame, u.params);
    case "mousemove": {
      const hover = elementAt(u.params, msg.x, msg.y);
      if (hover !== null) u.handled(`point-at-${hover}`);
      return hover === model.hover ? model : { ...model, hover };
    }
    case "mousedown": {
      const el = elementAt(u.params, msg.x, msg.y);
      if (el === null) return model.pinned === null ? model : { ...model, pinned: null };
      u.handled(model.pinned === el ? `unpin-${el}` : `pin-${el}`);
      return { ...model, pinned: model.pinned === el ? null : el };
    }
    case "param":
      return msg.name === "reaction" ? { ...model, hover: null, pinned: null } : model;
    case "mouseup":
    case "keydown":
    case "keyup":
    case "trigger":
      return model;
  }
}

export function draw(v: View, model: DeepReadonly<Model>, p: Params): void {
  paint(v, { model, analysis: analysisOf(p) });
}
