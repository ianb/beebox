// The Painter's style state: what push() saves and pop() restores.
import { resolveBrush } from "../brush/presets.js";
import type { BrushName } from "../brush/presets.js";
import type { Brush, BrushOverrides, Gesture } from "../brush/types.js";
import type { BlendMode, CtxTextAlign, CtxTextBaseline, Paint, Style, TextStyle } from "../paint.js";
import { SketchUsageError } from "../errors.js";

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

/** A Style with every default filled in: what one drawing call paints with. */
export interface ResolvedStyle {
  readonly fill: Paint | undefined;
  readonly stroke: Paint | undefined;
  readonly weight: number;
  readonly brush: Brush | undefined;
  readonly gesture: Gesture;
  readonly blend: BlendMode;
  readonly erase: boolean;
}

const STYLE_KEYS = new Set(["fill", "stroke", "weight", "brush", "gesture", "blend", "erase"]);

/** Check a Style at the call that received it; errors name the call and the key. */
export function assertStyle(style: Style, call: string): void {
  for (const key of Object.keys(style)) {
    if (!STYLE_KEYS.has(key)) throw new SketchUsageError({ detail: `${call}: unknown style key "${key}" (fill, stroke, weight, brush, gesture, blend, erase)` });
  }
  const { weight } = style;
  if (weight !== undefined && !(Number.isFinite(weight) && weight >= 0)) {
    throw new SketchUsageError({ detail: `${call}: style.weight must be a number ≥ 0 (got ${String(weight)})` });
  }
}

/** Validate `style` and fill in its defaults. */
export function resolveStyle(style: Style, call: string): ResolvedStyle {
  assertStyle(style, call);
  return {
    fill: style.fill,
    stroke: style.stroke,
    weight: style.weight ?? 1,
    brush: style.brush === undefined ? undefined : resolveBrush(style.brush, undefined),
    gesture: style.gesture ?? {},
    blend: style.blend ?? "normal",
    erase: style.erase ?? false,
  };
}

/** Why a call with this style would draw nothing, or undefined. `open` shapes (lines, open curves) have no fill. */
export function styleProblem(call: string, args: { style: ResolvedStyle; open: boolean }): string | undefined {
  const { style, open } = args;
  if (open && style.stroke === undefined) {
    return style.fill === undefined ? `${call}: the style has no stroke, so nothing is drawn` : `${call}: a line has no inside, so its fill draws nothing; give the style a stroke`;
  }
  if (!open && style.fill === undefined && style.stroke === undefined) return `${call}: the style has neither fill nor stroke, so nothing is drawn`;
  return undefined;
}

/**
 * The style half of the Painter: setters for what `push()` saves and `pop()`
 * restores. The Painter extends it with the drawing that reads the style.
 */
export class StyledPainter {
  protected style: StyleState = initialStyle();

  /** The modal state as the style the next shape paints with. */
  protected current(): ResolvedStyle {
    const st = this.style;
    return {
      fill: st.fillEnabled ? st.fillColor : undefined,
      stroke: st.strokeEnabled ? st.strokeColor : undefined,
      weight: st.strokeW,
      brush: st.brush,
      gesture: st.gesture,
      blend: st.blend,
      erase: st.erasing,
    };
  }

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
