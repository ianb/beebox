// game-world's sample map, drawn by canvas-loop instead of the LPC tile atlas.
// Ground is painted by per-cell passes (ground-tea.ts) that can run over the whole
// map or one 32 px cell at a time; props are sprites (objects-tea.ts).
import type { DeepReadonly, Msg, ParamsDecl, ParamValues, Util, View } from "@ianbicking/canvas-loop";
import { type GroundStyle, type Pass, passesFor } from "./ground-tea.js";
import { paintField } from "./field-tea.js";
import { H, PERIOD, S, W } from "./map-tea.js";
import { paintObjects } from "./objects-tea.js";

export const params = {
  ground: {
    type: "select",
    options: ["painted cells", "brushed paths", "field"] as const,
    default: "field",
    label: "Ground",
    hint: "Painted cells: shapes per cell. Brushed paths: paths as brush strokes. Field: every pixel computed from its position.",
  },
  render: {
    type: "select",
    options: ["whole map", "tile by tile"] as const,
    default: "whole map",
    label: "Ground drawn as",
    hint: "Tile by tile paints each 32 px cell on its own, clipped to its square.",
  },
  grid: { type: "boolean", default: false, label: "Show tile grid" },
  props: { type: "boolean", default: true, label: "Show props" },
  wind: { type: "boolean", default: true, label: "Wind" },
} as const satisfies ParamsDecl;

/** Drawn at twice game-world's pixel size, to judge detail. */
const ZOOM = 2;
export const canvas = { width: W * S * ZOOM, height: H * S * ZOOM };

export interface Model {
  frame: number;
}

export function init(): Model {
  return { frame: 0 };
}

export function update(model: DeepReadonly<Model>, msg: Msg, u: Util<typeof params>): Model {
  switch (msg.type) {
    case "tick":
      return u.params.wind ? { frame: msg.frame } : model;
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

/** Consecutive passes that are all static or all animated. */
function runs(style: GroundStyle): Pass[][] {
  const out: Pass[][] = [];
  for (const p of passesFor(style)) {
    const last = out.at(-1);
    if (last?.[0]?.animated === p.animated) last.push(p);
    else out.push([p]);
  }
  return out;
}
const RUNS: Record<GroundStyle, Pass[][]> = {
  "painted cells": runs("painted cells"),
  "brushed paths": runs("brushed paths"),
  field: runs("field"),
};

function paintRunWhole(v: View, run: readonly Pass[], t: number): void {
  for (const pass of run) {
    for (let y = -1; y <= H; y++) for (let x = -1; x <= W; x++) pass.paint(v, { x, y, t });
  }
}

function paintRunTiles(v: View, run: readonly Pass[], t: number): void {
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const px = x * S, py = y * S;
      v.clip([[px, py], [px + S, py], [px + S, py + S], [px, py + S]], () => {
        for (const pass of run) {
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) pass.paint(v, { x: x + dx, y: y + dy, t });
        }
      });
    }
  }
}

export function draw(v: View, model: DeepReadonly<Model>, p: ParamValues<typeof params>): void {
  v.background("#5f9a3e");
  const t = model.frame % PERIOD;
  const tiles = p.render === "tile by tile";
  v.at({ scale: ZOOM }, () => {
    if (p.ground === "field") {
      v.cache(`field-${p.render}`, () => {
        if (!tiles) paintField(v, { x: 0, y: 0, w: W * S, h: H * S });
        else for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) paintField(v, { x: x * S, y: y * S, w: S, h: S });
      });
    }
    for (const [i, run] of RUNS[p.ground].entries()) {
      const paint = (): void => (tiles ? paintRunTiles(v, run, t) : paintRunWhole(v, run, t));
      if (run[0]?.animated === true) paint();
      else v.cache(`ground-${p.ground}-${i}-${p.render}`, paint);
    }
    if (p.props) paintObjects(v, t);
    if (p.grid) {
      for (let x = 0; x <= W; x++) v.line(x * S, 0, x * S, H * S, { stroke: "rgba(255,255,255,0.35)", weight: 0.5 });
      for (let y = 0; y <= H; y++) v.line(0, y * S, W * S, y * S, { stroke: "rgba(255,255,255,0.35)", weight: 0.5 });
    }
  });
}
