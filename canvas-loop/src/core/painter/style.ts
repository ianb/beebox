// The Painter's style state: what push() saves and pop() restores.
import { resolveBrush } from "../brush/presets.js";
import type { BrushName } from "../brush/presets.js";
import type { Brush, BrushOverrides, Gesture } from "../brush/types.js";
import type { BlendMode, CtxTextAlign, CtxTextBaseline, Paint, TextStyle } from "../paint.js";

export interface StyleState {
  fillColor: Paint;
  fillEnabled: boolean;
  strokeColor: Paint;
  strokeEnabled: boolean;
  strokeW: number;
  textSize: number;
  textAlignH: CtxTextAlign;
  textAlignV: CtxTextBaseline;
  textFont: string;
  textStyle: TextStyle;
  brush: Brush | undefined;
  gesture: Gesture;
  blend: BlendMode;
  erasing: boolean;
}

/** The style a fresh Painter starts with (p5's defaults). */
export function initialStyle(): StyleState {
  return {
    fillColor: "#ffffff",
    fillEnabled: true,
    strokeColor: "#000000",
    strokeEnabled: false,
    strokeW: 1,
    textSize: 12,
    textAlignH: "left",
    textAlignV: "alphabetic",
    textFont: "sans-serif",
    textStyle: "normal",
    brush: undefined,
    gesture: {},
    blend: "normal",
    erasing: false,
  };
}

/**
 * The style half of the Painter: setters for what `push()` saves and `pop()`
 * restores. The Painter extends it with the drawing that reads the style.
 */
export class StyledPainter {
  protected style: StyleState = initialStyle();

  // ── style ────────────────────────────────────────────────────────
  fill(paint: Paint): void {
    this.style.fillColor = paint;
    this.style.fillEnabled = true;
  }
  noFill(): void {
    this.style.fillEnabled = false;
  }
  stroke(paint: Paint): void {
    this.style.strokeColor = paint;
    this.style.strokeEnabled = true;
  }
  noStroke(): void {
    this.style.strokeEnabled = false;
  }
  strokeWeight(weight: number): void {
    this.style.strokeW = weight;
  }
  textSize(size: number): void {
    this.style.textSize = size;
  }
  textAlign(horizontal: CtxTextAlign, vertical?: CtxTextBaseline): void {
    this.style.textAlignH = horizontal;
    if (vertical !== undefined) this.style.textAlignV = vertical;
  }
  /** The font family for `text`, as CSS names it (`"Georgia, serif"`). Which fonts exist depends on the machine. */
  textFont(family: string): void {
    this.style.textFont = family;
  }
  textStyle(style: TextStyle): void {
    this.style.textStyle = style;
  }

  // ── brushes ──────────────────────────────────────────────────────
  /** Strokes from now on are brushed marks: a preset name (with overrides) or a Brush. */
  brush(base: BrushName | Brush, overrides?: BrushOverrides): void {
    this.style.brush = resolveBrush(base, overrides);
  }
  /** Back to plain Canvas2D strokes. */
  noBrush(): void {
    this.style.brush = undefined;
  }
  /** How the hand moves for the marks that follow (pressure, wobble, seed). */
  gesture(gesture: Gesture): void {
    this.style.gesture = gesture;
  }
  blendMode(blend: BlendMode): void {
    this.style.blend = blend;
  }
  /** Fills, strokes and marks remove pixels instead of adding them, until `noErase()`. */
  erase(): void {
    this.style.erasing = true;
  }
  noErase(): void {
    this.style.erasing = false;
  }
}
