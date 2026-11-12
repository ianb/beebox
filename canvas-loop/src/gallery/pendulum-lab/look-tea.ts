// Shared look: palette, fonts and a one-line text helper.
import type { View } from "@ianbicking/canvas-loop";

export const FONT = "Avenir Next, Helvetica Neue, Helvetica, Arial, sans-serif";
export const PAGE = "#f3efe6";
export const CARD = "#fffdf8";
export const CARD_EDGE = "#ddd3bf";
export const INK = "#2a2833";
export const SOFT = "#6d6878";
export const FAINT = "#a39d8f";
export const GRID = "#ece5d6";
export const GOOD = "#2f8a4a";
export const ACCENT = "#7a3fc2";

export interface Say {
  size: number;
  fill?: string;
  bold?: boolean;
  align?: "left" | "center" | "right";
  valign?: "top" | "middle" | "bottom" | "baseline";
  italic?: boolean;
}

function fontStyle(o: Say): "normal" | "bold" | "italic" | "bold italic" {
  if (o.bold === true) return o.italic === true ? "bold italic" : "bold";
  return o.italic === true ? "italic" : "normal";
}

/** One line of text in the page font; (x, y) is on the baseline unless `valign` says otherwise. */
export function say(v: View, s: string, at: { x: number; y: number }, o: Say): void {
  v.text(s, at, {
    size: o.size,
    font: FONT,
    style: fontStyle(o),
    fill: o.fill ?? INK,
    align: o.align ?? "left",
    valign: o.valign ?? "baseline",
  });
}

export function sayWidth(v: View, s: string, o: Say): number {
  return v.textWidth(s, { size: o.size, font: FONT, style: fontStyle(o) });
}

export function card(v: View, box: { x: number; y: number; w: number; h: number }): void {
  v.roundRect(box.x + 2, box.y + 3, box.w, box.h, 12, { fill: "rgba(80, 60, 30, 0.08)" });
  v.roundRect(box.x, box.y, box.w, box.h, 12, { fill: CARD, stroke: CARD_EDGE, weight: 1.25 });
}
