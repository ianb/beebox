// The Painter's style state: what push() saves and pop() restores.
import type { Brush, Gesture } from "../brush/types.js";
import type { BlendMode, CtxTextAlign, CtxTextBaseline, Paint } from "../paint.js";

export interface StyleState {
  fillColor: Paint;
  fillEnabled: boolean;
  strokeColor: Paint;
  strokeEnabled: boolean;
  strokeW: number;
  textSize: number;
  textAlignH: CtxTextAlign;
  textAlignV: CtxTextBaseline;
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
    brush: undefined,
    gesture: {},
    blend: "normal",
    erasing: false,
  };
}
