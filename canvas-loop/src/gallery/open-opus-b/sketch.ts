// "Old Pell Lights the Lamps" — a picture-book page. Every dusk an old heron
// walks the long boardwalk out from the stilt village, lighting the lamps one
// by one so the fishing boats can find their way home. This page: the last
// lamp, at the very end of the pier, with one small boat still out on the water.
import type { Sketch } from "@ianbicking/canvas-loop";

import { drawHeron } from "./heron.js";
import { drawLantern, drawWalkway, LAMP, LIT_LAMPS } from "./pier.js";
import { drawReeds, drawSky, drawVillage, drawWater, HORIZON } from "./scene.js";

export function setup(s: Sketch): void {
  s.createCanvas(800, 800);
  s.paper({ scale: 3, contrast: 0.6, seed: 7 });
}

export function draw(s: Sketch): void {
  drawSky(s);
  drawWater(s);
  drawVillage(s);
  drawWalkway(s);
  for (const lamp of LIT_LAMPS) drawLantern(s, lamp, false);
  drawLantern(s, LAMP, true);
  drawHeron(s);
  drawReeds(s);
  drawText(s);
  s.log("horizon", HORIZON);
  s.paperTexture(0.35);
}

/** The page's line of text, set in the quiet sky at upper right. */
function drawText(s: Sketch): void {
  const ctx = s.ctx;
  ctx.save();
  ctx.fillStyle = "rgba(252,240,214,0.92)";
  ctx.font = "italic 25px Georgia";
  ctx.textAlign = "right";
  ctx.fillText("At the very end of the pier,", 756, 92);
  ctx.fillText("Old Pell lit the last lamp of all.", 756, 126);
  ctx.restore();
}
