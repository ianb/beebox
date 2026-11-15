// The renderer's plan for one frame: a tree of jobs. A job is one layer (the
// canvas, a group, a mask body or artwork, a shape with effects) in canvas
// device pixels; its items draw into it in order. Rectangles are integer
// device pixels with exclusive ends.
import type { FxPlan } from "./effects.js";
import type { PaintRec } from "./paint.js";

export interface R {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export const EMPTY: R = { x0: 0, y0: 0, x1: 0, y1: 0 };
export const isEmpty = (r: R): boolean => r.x1 <= r.x0 || r.y1 <= r.y0;
export const inter = (a: R, b: R): R => ({ x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) });
export const union = (a: R, b: R): R => (isEmpty(a) ? b : isEmpty(b) ? a : { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) });
export const pad = (a: R, p: number): R => ({ x0: a.x0 - p, y0: a.y0 - p, x1: a.x1 + p, y1: a.y1 + p });
export const widthOf = (r: R): number => r.x1 - r.x0;
export const heightOf = (r: R): number => r.y1 - r.y0;

/** Closed rings in device pixels whose nonzero union is one coverage; `box` bounds them. `slot` is set when packed into the atlas. */
export interface Piece {
  readonly rings: readonly (readonly number[])[];
  readonly box: R;
  slot?: { readonly page: number; readonly x: number; readonly y: number };
}

/**
 * A clip region in its job: every shape's rings (each shape oriented positive),
 * inside where their summed winding is not zero, times its parent clip. `tex`
 * lives while its job draws.
 */
export interface ClipMask {
  readonly rings: readonly (readonly number[])[];
  readonly parent: ClipMask | null;
  readonly box: R;
  tex?: GPUTexture | undefined;
}

export type Item =
  | { readonly k: "shape"; readonly piece: Piece; readonly paint: PaintRec; readonly box: R; readonly mode: number; readonly erase: boolean; readonly clip: ClipMask | null }
  | { readonly k: "layer"; readonly job: Job; readonly mask: Job | undefined; readonly box: R; readonly opacity: number; readonly mode: number; readonly erase: boolean; readonly clip: ClipMask | null };

export interface Job {
  readonly name: string;
  rect: R;
  readonly items: Item[];
  readonly clips: ClipMask[];
  readonly fx: FxPlan | undefined;
  /** The finished layer once encoded; texel (0, 0) is device pixel (rect.x0, rect.y0). */
  tex?: GPUTexture | undefined;
}

/** Every job below `j` (children first), so a job's sources are encoded before it. */
export function postOrder(j: Job, out: Job[]): Job[] {
  for (const it of j.items) {
    if (it.k !== "layer") continue;
    if (!isEmpty(it.job.rect)) postOrder(it.job, out);
    if (it.mask !== undefined && !isEmpty(it.mask.rect)) postOrder(it.mask, out);
  }
  out.push(j);
  return out;
}
