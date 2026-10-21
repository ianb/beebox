/**
 * Backdrop audit: a theme's artwork must fill the box it paints, with no
 * repeat seam and no bare strip, at the screen sizes the app runs at. The
 * browser half is in backdrop-page.ts.
 */

import { COLLECT_BACKDROPS_SCRIPT, type BackdropLayer, type BackdropPage } from "./backdrop-page.js";

export type { BackdropLayer, BackdropPage } from "./backdrop-page.js";

export interface BackdropFailure {
  kind: "repeats" | "gap";
  axis: "x" | "y";
  layer: BackdropLayer;
}

/** Sub-pixel rounding in the resolved sizes. */
const SLACK = 1;

export function scoreBackdrops(layers: readonly BackdropLayer[]): BackdropFailure[] {
  const failures: BackdropFailure[] = [];
  for (const layer of layers) {
    for (const axis of ["x", "y"] as const) {
      const box = axis === "x" ? layer.box.w : layer.box.h;
      const tile = axis === "x" ? layer.tile.w : layer.tile.h;
      const start = layer.offset[axis];
      if (layer.repeat[axis]) {
        if (tile < box - SLACK) failures.push({ kind: "repeats", axis, layer });
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
