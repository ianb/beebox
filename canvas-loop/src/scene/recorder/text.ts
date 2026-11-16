// Text at the call (draft section 7): laid out and measured with the runtime's
// fonts by today's measurer (one 2D canvas context), so `v.text` returns its
// bounds at once. The node keeps each glyph and its pen position (the width of
// the line up to it, so kerning holds), for the renderer's glyph atlas.
import { compositeOp } from "../../core/compose.js";
import type { TextBounds, TextBox, TextOptions } from "../../core/paint.js";
import { fontString, haloWidth } from "../../core/text/measure.js";
import type { TextMeasurer } from "../../core/text/measure.js";
import type { Mat, TextLine, TextNode } from "../nodes.js";
import { copyPaint } from "./style.js";
import { checkNumbers } from "./checks.js";

const BASELINES = { top: "top", middle: "middle", bottom: "bottom", baseline: "alphabetic" } as const;

function glyphLine(text: string, at: { x: number; y: number; font: string; measurer: TextMeasurer }): TextLine {
  const glyphs = Array.from(text);
  const xs: number[] = [];
  let prefix = "";
  for (const g of glyphs) {
    xs.push(at.x + (prefix === "" ? 0 : at.measurer.measure(prefix, at.font)));
    prefix += g;
  }
  return { glyphs, xs, y: at.y };
}

const GENERIC_FONTS = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-serif", "ui-sans-serif", "ui-monospace", "emoji", "math"]);

/** A warning when no family in the node's font list is generic or one the runtime has (`known`), so it draws in a fallback font. */
export function fontWarning(node: TextNode, known: ((family: string) => boolean) | undefined): string | undefined {
  if (known === undefined) return undefined;
  const found = node.family.split(",").some((f) => {
    const name = f.trim().replace(/^["']|["']$/g, "");
    return GENERIC_FONTS.has(name) || known(name);
  });
  if (found) return undefined;
  return `text ${JSON.stringify(node.content.slice(0, 24))}: no font family in "${node.family}" is installed here, so it draws in a fallback font; name an installed family or end the list with a generic one (sans-serif, serif, monospace)`;
}

/** Lay out `content` where it is called: under `matrix` (logical), keeping inside `canvas` (the scene, or the picture's box). */
export function recordText(content: string, at: { box: TextBox; options: TextOptions; measurer: TextMeasurer; matrix: Mat; canvas: { width: number; height: number } }): { node: TextNode; bounds: TextBounds } {
  const box = at.box;
  if (!(Number.isFinite(box.x) && Number.isFinite(box.y) && (box.w === undefined || Number.isFinite(box.w)) && (box.h === undefined || Number.isFinite(box.h)))) checkNumbers("text box", { values: { x: box.x, y: box.y, ...(box.w === undefined ? {} : { w: box.w }), ...(box.h === undefined ? {} : { h: box.h }) } });
  const [a, b, c, d, e, f] = at.matrix;
  const laid = at.measurer.place(content, { box: at.box, options: at.options, where: { transform: { a, b, c, d, e, f }, pixelRatio: 1, canvas: at.canvas } });
  const o = laid.options;
  const blend = o.blend ?? "normal";
  compositeOp(blend);
  const size = laid.bounds.size;
  const font = fontString({ size, font: o.font, style: o.style });
  const measurer = at.measurer;
  let lines: TextLine[];
  let baseline: TextNode["baseline"];
  if (laid.layout === undefined) {
    baseline = BASELINES[o.valign];
    const w = measurer.measure(content, font);
    const x = o.align === "center" ? laid.box.x - w / 2 : o.align === "right" ? laid.box.x - w : laid.box.x;
    lines = [glyphLine(content, { x, y: laid.box.y, font, measurer })];
  } else {
    const onBaseline = o.valign === "baseline";
    baseline = onBaseline ? "alphabetic" : "middle";
    const lineHeight = size * (o.lineHeight ?? 1.25);
    lines = laid.layout.lines.map((line, i) => glyphLine(line.text, { x: line.x, y: onBaseline ? laid.box.y + i * lineHeight : line.y, font, measurer }));
  }
  const halo = o.halo === undefined ? undefined : { paint: copyPaint(o.halo, "text halo"), width: haloWidth(size) };
  const lb = laid.bounds;
  const baselineY = (lines[0]?.y ?? lb.y) + measurer.baselineGap(font, lines[0] === undefined ? "top" : baseline);
  const node: TextNode = { kind: "text", content, family: o.font, style: o.style, size, baseline, lines, box: { x: lb.x, y: lb.y, w: lb.w, h: lb.h }, baselineY, fill: copyPaint(o.fill, "text"), halo, blend, erase: o.erase ?? false };
  return { node, bounds: laid.bounds };
}
