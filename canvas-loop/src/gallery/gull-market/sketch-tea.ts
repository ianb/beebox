// "The Gull and the Mackerel" — a picture-book page. A sunny morning at a
// seaside fish market: a cheeky herring gull flaps off to the left with a
// mackerel from the fishmonger's tray, and the fishmonger, cap jumping off
// his head, notices a moment too late.
import type { View } from "@ianbicking/canvas-loop";
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
  v.paperTexture(0.35);
}
