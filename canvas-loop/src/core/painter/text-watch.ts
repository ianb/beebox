// Two checks on drawn text, reported as warnings: labels that overlap other
// labels in one frame, and characters the font has no glyph for (they draw
// as empty boxes or not at all, with no error from the canvas).
import type { CtxTransform, Layer, MakeLayer } from "../paint.js";

/** A text's ink box in canvas coordinates. */
export interface TextRect {
  readonly content: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

// Most texts compared in one frame.
const MAX_TEXTS = 2000;
// Most overlap warnings in one run; a changing label could otherwise warn every frame.
const MAX_REPORTS = 10;
// Overlap smaller than this in either direction is not reported (antialiasing, touching edges).
const SLACK = 2;

const quote = (s: string): string => JSON.stringify(s.length > 30 ? `${s.slice(0, 29)}…` : s);

/**
 * Collects one frame's text boxes and reports pairs that overlap. Boxes are
 * upright: a rotated label is compared by the upright box around it.
 */
/** A drawn text's letter box in canvas coordinates, from its layout box under transform `m`. */
export function textRect(content: string, args: { box: { x: number; y: number; w: number; h: number; size: number }; m: CtxTransform; pixelRatio: number }): TextRect {
  const { box, m, pixelRatio } = args;
  // Trim the line gap above and below the letters.
  const trim = box.size * 0.12;
  const top = box.y + trim;
  const bottom = box.y + box.h - trim;
  const corners = [[box.x, top], [box.x + box.w, top], [box.x, bottom], [box.x + box.w, bottom]] as const;
  const xs = corners.map(([x, y]) => (m.a * x + m.c * y + m.e) / pixelRatio);
  const ys = corners.map(([x, y]) => (m.b * x + m.d * y + m.f) / pixelRatio);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { content, x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

export class TextOverlap {
  #frame: TextRect[] = [];
  // Texts each cache being drawn collects, innermost last (not capped).
  #collecting: TextRect[][] = [];
  #report: (message: string) => void;
  // Pairs already reported: each pair once per run, wherever it moves.
  #reported = new Set<string>();

  constructor(report: (message: string) => void) {
    this.#report = report;
  }

  add(rect: TextRect): void {
    if (rect.content.trim() === "") return;
    for (const list of this.#collecting) list.push(rect);
    if (this.#frame.length < MAX_TEXTS) this.#frame.push(rect);
  }

  /** Run `body` and also return the texts it added (a cache's texts, added again each time it is pasted). */
  collect<T>(body: () => T): { result: T; texts: TextRect[] } {
    const texts: TextRect[] = [];
    this.#collecting.push(texts);
    try {
      return { result: body(), texts };
    } finally {
      this.#collecting.pop();
    }
  }

  /** Report this frame's overlapping pairs and start a new frame. */
  finish(): void {
    const texts = this.#frame.toSorted((a, b) => a.x - b.x);
    this.#frame = [];
    if (this.#reported.size > MAX_REPORTS) return;
    // Sweep left to right: only texts that start before `a` ends can overlap it.
    for (const [i, a] of texts.entries()) {
      for (let j = i + 1; j < texts.length; j += 1) {
        const b = texts[j];
        if (b === undefined || b.x >= a.x + a.w - SLACK) break;
        this.#check(a, b);
        if (this.#reported.size > MAX_REPORTS) return;
      }
    }
  }

  #check(a: TextRect, b: TextRect): void {
    // The same words twice is a shadow or an outline, drawn on purpose.
    if (a.content === b.content) return;
    const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    if (w <= SLACK || h <= SLACK) return;
    const pair = JSON.stringify([a.content, b.content].toSorted());
    if (this.#reported.has(pair)) return;
    this.#reported.add(pair);
    if (this.#reported.size > MAX_REPORTS) {
      this.#report(`text: more than ${MAX_REPORTS} pairs of texts overlap; no more overlaps are reported this run`);
      return;
    }
    this.#report(`text ${quote(a.content)} overlaps text ${quote(b.content)} near (${Math.round(Math.max(a.x, b.x))}, ${Math.round(Math.max(a.y, b.y))}); move one, or place them with v.textBounds first`);
  }
}

const PROBE = 48;
// A private-use character no common font draws: what "no glyph" looks like in a font.
const MISSING = "\u{10FFFD}";

/**
 * Finds characters a font cannot draw by comparing each one's pixels with
 * the font's missing-glyph mark. Each (font, character) is checked once.
 */
export class GlyphWatch {
  #makeLayer: MakeLayer;
  #probe: Layer | undefined;
  #warn: (message: string) => void;
  #checked = new Set<string>();
  #missingMark = new Map<string, string>();

  constructor(makeLayer: MakeLayer, warn: (message: string) => void) {
    this.#makeLayer = makeLayer;
    this.#warn = warn;
  }

  check(content: string, font: { style: string; family: string }): void {
    for (const char of content) {
      const code = char.codePointAt(0) ?? 0;
      // Spaces, controls, format characters and variation selectors draw nothing by design.
      if (/[\p{Cc}\p{Cf}\s\uFE00-\uFE0F]/u.test(char)) continue;
      const name = `${font.style} ${font.family}`;
      const key = `${name}\u0000${char}`;
      if (this.#checked.has(key)) continue;
      this.#checked.add(key);
      if (this.#ink(char, font) === this.#missing(font)) {
        this.#warn(`text: the font "${name}" has no glyph for "${char}" (U+${code.toString(16).toUpperCase().padStart(4, "0")}); it draws as an empty box or nothing`);
      }
    }
  }

  #missing(font: { style: string; family: string }): string {
    const name = `${font.style} ${font.family}`;
    const known = this.#missingMark.get(name);
    if (known !== undefined) return known;
    const mark = this.#ink(MISSING, font);
    this.#missingMark.set(name, mark);
    return mark;
  }

  /** A fingerprint of `char`'s pixels at 24px. */
  #ink(char: string, font: { style: string; family: string }): string {
    this.#probe ??= this.#makeLayer({ width: PROBE, height: PROBE });
    const { ctx } = this.#probe;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, PROBE, PROBE);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.font = `${font.style} 24px ${font.family}`;
    ctx.fillStyle = "#000";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(char, 8, PROBE / 2);
    const { data } = ctx.getImageData(0, 0, PROBE, PROBE);
    let hash = 0;
    for (let i = 3; i < data.length; i += 4) hash = (Math.imul(hash, 31) + (data[i] ?? 0)) >>> 0;
    return `${String(ctx.measureText(char).width)}:${String(hash)}`;
  }
}
