/**
 * Backdrop audit: a theme's artwork must fill the box it paints, at the
 * screen sizes the app runs at. An image set not to repeat must leave no bare
 * strip, and no image may be stretched out of its aspect ratio. Cropping is
 * fine. A repeat seam is a lesser fault than either, so painted (raster)
 * artwork that repeats is reported too, but an SVG that repeats is a pattern
 * drawn to tile. The browser half is in backdrop-page.ts.
 */

import { COLLECT_BACKDROPS_SCRIPT, type BackdropLayer, type BackdropPage } from "./backdrop-page.js";

export type { BackdropLayer, BackdropPage } from "./backdrop-page.js";

export interface BackdropFailure {
  kind: "repeats" | "gap" | "distorts";
  axis: "x" | "y";
  layer: BackdropLayer;
}

/** Sub-pixel rounding in the resolved sizes. */
const SLACK = 1;

export function scoreBackdrops(layers: readonly BackdropLayer[]): BackdropFailure[] {
  const failures: BackdropFailure[] = [];
  for (const layer of layers) {
    // An SVG with preserveAspectRatio="none" has no ratio of its own; the
    // browser reports it as 300×150 and stretches it, so it is caught here.
    // A `#view` fragment shows part of a sprite sheet, whose size is all the
    // browser reports, so its ratio cannot be checked.
    const height = layer.tile.w * layer.natural.h / layer.natural.w;
    if (!layer.image.includes("#") && Math.abs(layer.tile.h - height) > SLACK) failures.push({ kind: "distorts", axis: layer.tile.h > height ? "y" : "x", layer });
    for (const axis of ["x", "y"] as const) {
      const box = axis === "x" ? layer.box.w : layer.box.h;
      const tile = axis === "x" ? layer.tile.w : layer.tile.h;
      const start = layer.offset[axis];
      if (layer.repeat[axis]) {
        if (layer.raster && tile < box - SLACK) failures.push({ kind: "repeats", axis, layer });
      } else if (start > SLACK || start + tile < box - SLACK) {
        failures.push({ kind: "gap", axis, layer });
      }
    }
  }
  return failures;
}

export function describeBackdropFailure(f: BackdropFailure): string {
  const { layer } = f;
  const box = f.axis === "x" ? layer.box.w : layer.box.h;
  const tile = f.axis === "x" ? layer.tile.w : layer.tile.h;
  const px = (n: number): string => `${String(Math.round(n))}px`;
  if (f.kind === "distorts") {
    return `${layer.image} is stretched in ${layer.selector}: ${px(layer.natural.w)}×${px(layer.natural.h)} painted at ${px(layer.tile.w)}×${px(layer.tile.h)}`;
  }
  if (f.kind === "repeats") {
    return `${layer.image} repeats ${f.axis === "x" ? "across" : "down"} ${layer.selector}: ${px(tile)} tile in a ${px(box)} box`;
  }
  const start = layer.offset[f.axis];
  const bare = start > SLACK ? `${px(start)} bare at the ${f.axis === "x" ? "left" : "top"}` : `${px(box - start - tile)} bare at the ${f.axis === "x" ? "right" : "bottom"}`;
  return `${layer.image} leaves ${bare} of ${layer.selector}: ${px(tile)} image in a ${px(box)} box`;
}

export interface BackdropAuditPage {
  eval(expression: string): Promise<string>;
}

export interface BackdropResult {
  failures: BackdropFailure[];
  layers: number;
  unloaded: string[];
}

export async function auditBackdrops(page: BackdropAuditPage): Promise<BackdropResult> {
  const once: unknown = JSON.parse((await page.eval(COLLECT_BACKDROPS_SCRIPT)).trim());
  // agent-browser prints eval results as JSON; a string result is JSON again.
  // eslint-disable-next-line no-restricted-syntax -- parse boundary: COLLECT_BACKDROPS_SCRIPT builds exactly this shape in the page
  const result = (typeof once === "string" ? JSON.parse(once) : once) as BackdropPage;
  return { failures: scoreBackdrops(result.layers), layers: result.layers.length, unloaded: result.unloaded };
}
