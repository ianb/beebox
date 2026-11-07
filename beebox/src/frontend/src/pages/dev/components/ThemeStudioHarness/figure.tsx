/**
 * A real canvas-loop figure with one control of each kind and the play
 * toolbar, mounted as a card mounts one, so theme-check measures the figure
 * library's own controls on each card material. Paused on frame 0, so every
 * screenshot draws the same canvas.
 */

import { mountSketch } from "@ianbicking/canvas-loop/browser";
import type { DeepReadonly, ParamsDecl, ParamValues, View } from "@ianbicking/canvas-loop";
import { FigureMount, type FigureContext, type FigureSketch } from "../../../../components/FigureView/FigureMount";
import { useViewFileHelpers } from "../../../../hooks/useViewFileHelpers";

const params = {
  warmth: { type: "number", min: 0, max: 30, default: 20 },
  "show-labels": { type: "boolean", default: true },
  tray: { type: "select", options: ["seedlings", "cuttings"], default: "seedlings" },
  water: { type: "trigger" },
} as const satisfies ParamsDecl;

const SKETCH = {
  params,
  canvas: { width: 240, height: 80 },
  init: (): null => null,
  update: (model: DeepReadonly<null>): null => model,
  // eslint-disable-next-line max-params -- canvas-loop's TEA contract fixes draw(view, model, params)
  draw: (v: View, _model: DeepReadonly<null>, p: ParamValues<typeof params>): void => {
    v.background("#0b0e17");
    v.noStroke();
    v.fill(p.tray === "seedlings" ? "#86efac" : "#fb923c");
    v.circle(40 + p.warmth * 5, 40, 16);
  },
};

const sketch: FigureSketch = (_lib, { mount }) => mountSketch(mount, { module: SKETCH, autoplay: false, transport: true });

function reportError(message: string) { console.error("theme studio figure failed", message); }

export function StudioFigure() {
  const file = useViewFileHelpers("/api");
  const figure: FigureContext = { params: {}, data: {}, meta: {}, file };
  return <FigureMount runtime="canvas-loop" sketch={sketch} figure={figure} onError={reportError} />;
}
