// "The Gull and the Mackerel" — a picture-book page. A sunny morning at a
// seaside fish market: a cheeky herring gull flaps off to the left with a
// mackerel from the fishmonger's tray, and the fishmonger, cap jumping off
// his head, notices a moment too late.
import type { SceneView as View } from "@ianbicking/canvas-loop";
import { H, headland, quay, sea, sky, W } from "./backdrop-tea.js";
import { fishmonger, shock } from "./fishmonger-tea.js";
import {
  bollardGull,
  castShadows,
  cat,
  child,
  crates,
  shadowAndBunting,
  strollers,
  trail,
} from "./foreground-tea.js";
import { gull } from "./gull-tea.js";
import { awning, counter, stallBack } from "./stall-tea.js";

/** Draws with the scene View on the GPU renderer (`cli run` reads this). */
export const renderer = "scene";

export const canvas = { width: W, height: H };

export type Model = Record<string, never>;

export function init(): Model {
  return {};
}

export function update(model: Model): Model {
  return model;
}

export function draw(v: View): void {
  v.paper({ scale: 3, contrast: 0.6, seed: 12 });
  // Port: `v.paperTexture(0.35)` at the end becomes what was drawn before it, in a group with
  // `effects.paper` (draft section 2).
  v.group({ effects: { paper: 0.35 } }, () => {
    sky(v);
    sea(v);
    headland(v);
    quay(v);
    castShadows(v);
    strollers(v);
    stallBack(v);
    fishmonger(v);
    counter(v);
    awning(v);
    shock(v);
    shadowAndBunting(v);
    crates(v);
    bollardGull(v);
    child(v);
    cat(v);
    trail(v);
    gull(v);
  });
}
