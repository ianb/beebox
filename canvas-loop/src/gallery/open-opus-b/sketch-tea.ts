// "Old Pell Lights the Lamps" — a picture-book page. Every dusk an old heron
// walks the long boardwalk out from the stilt village, lighting the lamps one
// by one so the fishing boats can find their way home. This page: the last
// lamp, at the very end of the pier, with one small boat still out on the water.
import type { DeepReadonly, Drawing, RootDrawing, Util, View } from "@ianbicking/canvas-loop";

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

export function draw(v: View, model: DeepReadonly<Model>): RootDrawing {
  // Port: `v.paperTexture(0.35)` at the end becomes what was drawn before it, in a group with
  // `effects.paper` (draft section 2).
  return v.paper({ scale: 3, contrast: 0.6, seed: 7 }, v.group({ effects: { paper: 0.35 } }, ((): Drawing => {
    const parts: Drawing[] = [];
    parts.push(drawSky(v, model.rolls));
    parts.push(drawWater(v, model.rolls));
    parts.push(drawVillage(v, model.rolls));
    parts.push(drawWalkway(v));
    for (const lamp of LIT_LAMPS) parts.push(drawLantern(v, lamp, false));
    parts.push(drawLantern(v, LAMP, true));
    parts.push(drawHeron(v));
    parts.push(drawReeds(v, model.rolls));
    parts.push(drawText(v));
    v.log("horizon", HORIZON);
    return parts;
  })()));
}

/** The page's line of text, set in the quiet sky at upper right. */
function drawText(v: View): Drawing {
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
  return [
    v.text("At the very end of the pier,", { x: 756, y: 92 }, line),
    v.text("Old Pell lit the last lamp of all.", { x: 756, y: 126 }, line),
  ];
}
