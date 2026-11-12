// Brush, gesture, and paper data. All plain data: a sketch passes these to
// `brush()`, `gesture()` and `paper()`, and the engine reads them at paint time.
import type { BlendMode } from "../paint.js";

/** A named pressure shape over a mark's length. */
export type EnvelopePreset = "even" | "taper" | "taper-in" | "taper-out" | "swell" | "press";

/**
 * A value over a mark's length, `t` from 0 (start) to 1 (end): a constant, a
 * preset name, or keyframes `[[t, value], …]` sorted by `t`, eased between.
 */
export type Envelope = number | EnvelopePreset | readonly (readonly [number, number])[];

/**
 * How the hand moves along a mark. One gesture works with any brush.
 * - `pressure`: 0..1 over the mark. Default: `"taper"` for open marks,
 *   `"even"` for closed shapes.
 * - `wobble`: sideways hand wobble in device pixels (default 0).
 * - `seed`: fixes the mark's random character. Without it, the seed is a hash
 *   of the mark's own points.
 * - `faint`: the mark is meant to be faint; no faint-mark warning.
 */
export interface Gesture {
  readonly pressure?: Envelope;
  readonly wobble?: number;
  readonly seed?: number;
  /** The mark is meant to be faint: no faint-mark warning for it. */
  readonly faint?: boolean;
}

interface BrushCommon {
  /** Opacity of the whole finished mark, 0..1. Overlaps inside one mark do not darken. */
  readonly opacity: number;
  /** How much the paper texture bites into the mark, 0..1. */
  readonly grain: number;
  /** Blend with the drawing below. A non-normal `blend` in the call's style wins. */
  readonly blend?: BlendMode;
}

/** Smooth variable-width ink (perfect-freehand outline, filled). */
export interface InkBrush extends BrushCommon {
  readonly kind: "ink";
  /** How much pressure thins the line: 0 = constant width, 1 = width goes to 0 at pressure 0. */
  readonly thinning: number;
}

/** Dabs of a tip placed along the path (pencil, chalk, airbrush). */
export interface StampBrush extends BrushCommon {
  readonly kind: "stamp";
  readonly tip: "hard" | "soft";
  /** Dab spacing as a fraction of the dab size. */
  readonly spacing: number;
  /** Opacity of a single dab, 0..1. */
  readonly flow: number;
  /** How much pressure shrinks the dab, 0..1. */
  readonly sizeByPressure: number;
  /** How much pressure fades the dab, 0..1. */
  readonly opacityByPressure: number;
  /** Random sideways dab offset, as a fraction of the stroke width. */
  readonly scatter: number;
  /** Random dab size variation, 0..1. */
  readonly sizeJitter: number;
}

/** Separate bristles that follow the path and run out of paint. */
export interface BristleBrush extends BrushCommon {
  readonly kind: "bristle";
  readonly bristles: number;
  /** Opacity of a single bristle line, 0..1. */
  readonly flow: number;
  /** Paint each bristle carries, as a fraction of the mark's length (lower = drier). */
  readonly load: number;
  /** Random variation in bristle placement and thickness, 0..1. */
  readonly spread: number;
}

export type Brush = InkBrush | StampBrush | BristleBrush;
export type BrushKind = Brush["kind"];

/** Fields a preset can be overridden with (each must belong to the preset's kind). */
export type BrushOverrides = Partial<Omit<InkBrush, "kind">> &
  Partial<Omit<StampBrush, "kind">> &
  Partial<Omit<BristleBrush, "kind">>;

/**
 * The canvas's paper texture: fixed in canvas space, so it lines up across marks.
 * - `scale`: size of the paper's tooth in pixels (default 3).
 * - `contrast`: how strongly ridges and valleys differ, 0..1 (default 0.7).
 * - `seed`: which paper sheet (default 1).
 */
export interface Paper {
  readonly scale?: number;
  readonly contrast?: number;
  readonly seed?: number;
}
