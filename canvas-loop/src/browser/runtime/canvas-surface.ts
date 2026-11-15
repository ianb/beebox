// Today's drawing surface for the browser runtime: the sketch's `draw` on a
// Canvas2D view over the figure's own 2D context.
import type { TextMeasure } from "../../core/view.js";
import type { PlaygroundModule } from "../sketch-types.js";
import { BrowserView } from "./browser-view.js";
import type { CanvasDeps, DrawSurface } from "./engine-types.js";

/** Today's surface: the module's `draw` on a Canvas2D view over `deps.ctx`. */
export function canvasSurface(a: { deps: CanvasDeps; module: PlaygroundModule; log: (args: readonly unknown[]) => void }): DrawSurface {
  const { deps, module } = a;
  const view = new BrowserView({ ctx: deps.ctx, width: deps.width, height: deps.height, pixelRatio: deps.pixelRatio ?? 1, log: a.log, params: new Set(Object.keys(module.params ?? {})) });
  return {
    get textMeasure(): TextMeasure {
      return view.textMeasure;
    },
    forgetTextWidths: () => view.forgetTextWidths(),
    draw: (model, params) => {
      module.draw(view, model, params);
      view.finishFrame();
      return view.takePlacements();
    },
  };
}
