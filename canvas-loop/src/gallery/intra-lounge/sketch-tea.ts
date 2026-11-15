// The Archive Lounge (intra-game): "A small, quiet room lined with old, glitching
// monitors displaying unreadable data. A vending machine hums quietly in the corner,
// offering unlabeled drinks. The sky above is a pixelated blue with occasional
// bursts of static, flashing error messages before resetting."
//
// The room is rendered per pixel with its lighting baked per light (scene-tea.ts);
// each frame the screens decide what they show and what light they throw
// (screens-tea.ts), and the room is relit from that.
import type { DeepReadonly, Msg, SceneView as View } from "@ianbicking/canvas-loop";
import type { ParamsDecl, ParamValues } from "@ianbicking/canvas-loop";
import { paintDabs } from "./dabs-tea.js";
import { H, W, paintRoom } from "./scene-tea.js";
import { lightColours, paintLeds, paintMotes, paintScreens, paintVending, skyBurst, skyColour } from "./screens-tea.js";
import { paintWalker } from "./walker-tea.js";

/** Draws with the scene View on the GPU renderer (`cli run` reads this). */
export const renderer = "scene";

export const params = {
  style: { type: "select", options: ["painted", "rendered"] as const, default: "painted", label: "Style" },
} as const satisfies ParamsDecl;

export const canvas = { width: W, height: H };

export interface Model {
  frame: number;
}
export function init(): Model {
  return { frame: 0 };
}
export function update(model: DeepReadonly<Model>, msg: Msg): Model {
  switch (msg.type) {
    case "tick":
      return { frame: msg.frame };
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

export function draw(v: View, model: DeepReadonly<Model>, p: ParamValues<typeof params>): void {
  const t = model.frame;
  const lights = lightColours(t), sky = skyColour(t);
  if (p.style === "painted") paintDabs(v, { lights, sky });
  else paintRoom(v, { lights, sky });
  paintLeds(v, t);
  paintVending(v, t);
  paintScreens(v, t);
  paintWalker(v, { t, lights, sky });
  paintMotes(v, t);
  // When the sky screen bursts into static, a faint flicker of it falls over everything.
  if (skyBurst(t) > 0) {
    for (let y = 0; y < H; y += 3) v.rect(0, y, W, 1, { fill: `rgba(170,190,255,${(0.05 * skyBurst(t)).toFixed(3)})` });
  }
  v.rect(0, 0, W, H, { fill: v.ellipseGradient(W / 2, H * 0.5, W * 0.7, H * 0.7, [[0.55, "rgba(5,5,10,0)"], [1, "rgba(5,5,10,0.6)"]]) });
}
