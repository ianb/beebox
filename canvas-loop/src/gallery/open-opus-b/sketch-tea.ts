// "Old Pell Lights the Lamps" — a picture-book page. Every dusk an old heron
// walks the long boardwalk out from the stilt village, lighting the lamps one
// by one so the fishing boats can find their way home. This page: the last
// lamp, at the very end of the pier, with one small boat still out on the water.
import type { DeepReadonly, Util, View } from "@ianbicking/canvas-loop";

import { drawHeron } from "./heron-tea.js";
import { drawLantern, drawWalkway, LAMP, LIT_LAMPS } from "./pier-tea.js";
import {
  drawReeds,
  drawSky,
  drawVillage,
  drawWater,
  HORIZON,
  rollScene,
} from "./scene-tea.js";
import type { SceneRandom } from "./scene-tea.js";

export const canvas = { width: 800, height: 800 };

export interface Model {
  readonly rolls: SceneRandom;
}

export function init(u: Util): Model {
  return { rolls: rollScene(u) };
}

export function update(model: DeepReadonly<Model>): Model {
  return model;
}

export function draw(v: View, model: DeepReadonly<Model>): void {
  v.paper({ scale: 3, contrast: 0.6, seed: 7 });
  drawSky(v, model.rolls);
  drawWater(v, model.rolls);
  drawVillage(v, model.rolls);
  drawWalkway(v);
  for (const lamp of LIT_LAMPS) drawLantern(v, lamp, false);
  drawLantern(v, LAMP, true);
  drawHeron(v);
  drawReeds(v, model.rolls);
  drawText(v);
  v.log("horizon", HORIZON);
  v.paperTexture(0.35);
}

/** The page's line of text, set in the quiet sky at upper right. */
function drawText(v: View): void {
  const line: {
    size: number;
    font: string;
    style: "italic";
    fill: string;
    align: "right";
    valign: "baseline";
  } = {
    size: 25,
    font: "Georgia",
    style: "italic",
    fill: "rgba(252,240,214,0.92)",
    align: "right",
    valign: "baseline",
  };
  v.text("At the very end of the pier,", { x: 756, y: 92 }, line);
  v.text("Old Pell lit the last lamp of all.", { x: 756, y: 126 }, line);
}
