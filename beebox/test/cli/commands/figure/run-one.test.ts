// # bbx figure run-one: which renderer a figure entry gets
//
// `export const renderer = "scene"` sends a figure to the GPU scene runner
// (canvas-loop scene spike); no export keeps the Canvas2D runner. Any other
// value is an error, so a typo cannot run the sketch with the wrong View.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { figureRenderer } from "../../../../src/cli/commands/figure/run-one.js";

void test("the renderer export picks the runner; an unknown value is an error", (t) => {
  const draw = (): void => {};
  t.check(figureRenderer({ draw }), "canvas");
  t.check(figureRenderer({ draw, renderer: "scene" }), "scene");
  const wrong = (renderer: unknown): string => {
    try {
      return figureRenderer({ draw, renderer });
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  };
  t.check([wrong("Scene"), wrong(true)], [
    'export const renderer must be "scene" or absent; got "Scene"',
    'export const renderer must be "scene" or absent; got true',
  ]);
  t.end();
});
