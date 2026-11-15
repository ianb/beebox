// The renderer's plan for one frame: a tree of jobs. A job is one layer (the
// canvas, a group, a mask body or artwork, a shape with effects, a placed
// picture) in canvas device pixels; its items draw into it in order.
// Rectangles are integer device pixels with exclusive ends.
import type { SmearBrush } from "../core/brush/types.js";
import type { Dab, Run } from "../scene/brush/expand.js";
import type { Rgba } from "../scene/colors.js";
import type { Mat, PictureVersion, ShapeNode } from "../scene/nodes.js";
import type { FxPlan } from "./effects.js";
import type { LightPlan } from "./light.js";
import type { BevelPlan } from "./material.js";
import type { GlyphCell } from "./glyphs.js";
import type { PaintRec } from "./paint.js";
import type { MarkPeak } from "./peaks.js";

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

/** The side of a coverage, mark or clip atlas page: the largest texture this renderer asks for. */
export const ATLAS_MAX = 8192;

/**
 * Where a shape, mark or clip is cut before it reaches an atlas: what can be
 * seen plus 2 px, except on an axis where the padding would pass the atlas
 * side (a canvas exactly as wide as the largest texture).
 */
export function cutOf(visible: R): R {
  const p = pad(visible, 2);
  const [x0, x1] = widthOf(p) > ATLAS_MAX ? [visible.x0, visible.x1] : [p.x0, p.x1];
  const [y0, y1] = heightOf(p) > ATLAS_MAX ? [visible.y0, visible.y1] : [p.y0, p.y1];
  return { x0, y0, x1, y1 };
}

/** Where something packed into an atlas page sits. */
export interface Slot {
  readonly page: number;
  readonly x: number;
  readonly y: number;
}

/**
 * Closed rings whose nonzero union is one coverage: a ring point plus (ox, oy)
 * is in device pixels (rings kept between frames are shared, untranslated).
 * `box` bounds them in device pixels. `slot` is set when packed into the atlas.
 */
export interface Piece {
  readonly rings: readonly (readonly number[])[];
  readonly box: R;
  readonly ox: number;
  readonly oy: number;
  slot?: Slot;
}

/** A brushed mark's dabs and bristle runs, accumulated in the mark atlas inside `box`; a point plus (ox, oy) is in device pixels. */
export interface TexMark {
  readonly box: R;
  readonly dabs: readonly Dab[];
  readonly runs: readonly Run[];
  readonly ox: number;
  readonly oy: number;
  slot?: Slot;
}

/** The paper a grainy mark bites into (R9): device pixel → paper pixel (the stroke's call coordinates × ratio), and the paper's settings in paper pixels. */
export interface PaperRec {
  readonly toPaper: Mat;
  readonly scale: number;
  readonly lo: number;
  readonly hi: number;
  readonly seed: number;
  /** The row width the paper's per-pixel hash uses (a constant). */
  readonly width: number;
}

/** What a brushed mark applies once, in its draw (brushes probe): grain, then opacity. */
export interface BrushRec {
  readonly grain: number;
  readonly opacity: number;
  readonly paper: PaperRec;
}

/** A smudge or wet stroke: its dabs in device pixels (first of each contour flagged), its patch size, brush and paint. */
export interface SmearRec {
  readonly dabs: readonly { readonly x: number; readonly y: number; readonly r: number; readonly a: number; readonly first: boolean }[];
  readonly size: number;
  readonly brush: SmearBrush;
  /** The wet paint, straight alpha (unused for a smudge). */
  readonly paint: Rgba;
  readonly paper: PaperRec;
}

/** One glyph cell: device pixel → texel in its cell (`a` linear, `t` offset), and the cell. */
export interface GlyphQuad {
  readonly box: R;
  readonly a: readonly [number, number, number, number];
  readonly t: readonly [number, number];
  readonly cell: GlyphCell;
}

export type MarkSource = { readonly kind: "piece"; readonly piece: Piece } | { readonly kind: "tex"; readonly mark: TexMark };

interface Common {
  readonly box: R;
  readonly mode: number;
  readonly erase: boolean;
  readonly clip: ClipMask | null;
}

/** In a lit group's material layer (R8): the material drawn in place of the paint's colour, straight. */
interface Mat4 {
  readonly mat?: Rgba | undefined;
}

export type Item =
  | (Common & Mat4 & { readonly k: "shape"; readonly piece: Piece; readonly paint: PaintRec })
  /** A layer; `shift` (whole device pixels) moves a picture tile from raster space to the target's. */
  | (Common & Mat4 & { readonly k: "layer"; readonly job: Job; readonly mask: Job | undefined; readonly opacity: number; readonly shift?: readonly [number, number] })
  /** A brushed mark; `node` (in colour, not material layers) is the stroke it draws, for testing mode's faint-mark check. */
  | (Common & Mat4 & { readonly k: "mark"; readonly source: MarkSource; readonly tinted: boolean; readonly paint: PaintRec; readonly brush: BrushRec; readonly node?: ShapeNode | undefined })
  | (Common & { readonly k: "smear"; readonly smear: SmearRec })
  | (Common & Mat4 & { readonly k: "glyphs"; readonly quads: readonly GlyphQuad[]; readonly paint: PaintRec });

/**
 * A clip region in its job's device pixels, times its parent clip: one shape's
 * coverage from the atlas (`piece`, exact area as a fill), or for a union of
 * shapes their rings (each oriented positive), inside where the summed winding
 * is not zero. Every clip of a frame is drawn once, inside its own `box`, on a
 * shared clip page per nesting depth (clip-pages.ts): `slot` and `page`.
 */
export interface ClipMask {
  readonly rings: readonly (readonly number[])[];
  readonly piece: Piece | undefined;
  readonly parent: ClipMask | null;
  readonly depth: number;
  readonly box: R;
  slot?: Slot;
  page?: GPUTexture | undefined;
}

/** A lit group's material layers (material.ts): normals and shine; emissive and casters; and, where needed, non-receiving. */
export type Mats = readonly [Job, Job] | readonly [Job, Job, Job];

export interface Job {
  readonly name: string;
  rect: R;
  readonly items: Item[];
  readonly clips: ClipMask[];
  readonly fx: FxPlan | undefined;
  /** Where the job's drawing can be seen (device px; the canvas, or a picture's tile): a wash reads its layer as continuous past it. */
  readonly seen?: R | undefined;
  /** A lit group (R8): shaded from its material layers before its effects (the third only where a shape receives no shadow). */
  light?: { readonly plan: LightPlan; readonly mats: Mats } | undefined;
  /** A bevelled shape in material layer 0: its coverage becomes rim normals. */
  bevel?: BevelPlan | undefined;
  /** The finished layer once encoded; texel (0, 0) is device pixel (rect.x0, rect.y0). Set when lowered for a kept picture tile. */
  tex?: GPUTexture | undefined;
  /** A kept picture tile reused this frame: its marks' strengths relative to the tile, measured when it was drawn (testing mode, peaks.ts). */
  keptPeaks?: readonly MarkPeak[] | undefined;
  /** A picture tile to keep once drawn (rasters.ts), in raster space. */
  keep?: { readonly version: PictureVersion; readonly key: string } | undefined;
}

/** Every job below `j` (children first, each once: a picture tile may be placed twice), so a job's sources are encoded before it. */
export function postOrder(j: Job, out: Job[]): Job[] {
  visit(j, { out, seen: new Set() });
  return out;
}

function visit(j: Job, a: { out: Job[]; seen: Set<Job> }): void {
  if (a.seen.has(j)) return;
  a.seen.add(j);
  for (const it of j.items) {
    if (it.k !== "layer") continue;
    if (!isEmpty(it.job.rect) && it.job.tex === undefined) visit(it.job, a);
    if (it.mask !== undefined && !isEmpty(it.mask.rect)) visit(it.mask, a);
  }
  for (const m of j.light?.mats ?? []) if (!isEmpty(m.rect)) visit(m, a);
  a.out.push(j);
}
