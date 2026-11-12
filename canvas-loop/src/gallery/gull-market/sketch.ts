// "The Gull and the Mackerel" — a picture-book page. A sunny morning at a
// seaside fish market: a cheeky herring gull flaps off to the left with a
// mackerel from the fishmonger's tray, and the fishmonger, cap jumping off
// his head, notices a moment too late.
import type { Sketch } from "@ianbicking/canvas-loop";
import { H, headland, quay, sea, sky, W } from "./backdrop.js";
import { fishmonger, shock } from "./fishmonger.js";
import { bollardGull, castShadows, cat, child, crates, shadowAndBunting, strollers, trail } from "./foreground.js";
import { gull } from "./gull.js";
import { awning, counter, stallBack } from "./stall.js";

export function setup(s: Sketch): void {
  s.createCanvas(W, H);
}

export function draw(s: Sketch): void {
  s.paper({ scale: 3, contrast: 0.6, seed: 12 });
  sky(s);
  sea(s);
  headland(s);
  quay(s);
  castShadows(s);
  strollers(s);
  stallBack(s);
  fishmonger(s);
  counter(s);
  awning(s);
  shock(s);
  shadowAndBunting(s);
  crates(s);
  bollardGull(s);
  child(s);
  cat(s);
  trail(s);
  gull(s);
  s.paperTexture(0.35);
}
