// Two checks on drawn text, reported as warnings: labels that overlap other
// labels in one frame, and characters the font has no glyph for (they draw
// as empty boxes or not at all, with no error from the canvas).
import type { Layer, MakeLayer } from "../paint.js";

/** A text's ink box in canvas coordinates. */
export interface TextRect {
  readonly content: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

// Most texts compared in one frame (pairs grow with the square).
const MAX_TEXTS = 1500;
// Overlap smaller than this in either direction is not reported (antialiasing, touching edges).
const SLACK = 2;

const quote = (s: string): string => JSON.stringify(s.length > 30 ? `${s.slice(0, 29)}…` : s);

/** Collects one frame's text boxes and reports pairs that overlap. */
export class TextOverlap {
  #frame: TextRect[] = [];
  #report: (message: string) => void;
  // Pairs already reported: each pair once per run, wherever it moves.
  #reported = new Set<string>();

  constructor(report: (message: string) => void) {
    this.#report = report;
  }

  add(rect: TextRect): void {
    if (rect.content.trim() !== "" && this.#frame.length < MAX_TEXTS) this.#frame.push(rect);
  }

  /** How many texts this frame has so far (with `since`, the texts a cache draws). */
  mark(): number {
    return this.#frame.length;
  }

  since(mark: number): TextRect[] {
    return this.#frame.slice(mark);
  }

  /** Report this frame's overlapping pairs and start a new frame. */
  finish(): void {
    const texts = this.#frame;
    this.#frame = [];
    for (const [i, a] of texts.entries()) {
      for (const b of texts.slice(i + 1)) {
        // The same words twice is a shadow or an outline, drawn on purpose.
        if (a.content === b.content) continue;
        const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        const pair = JSON.stringify([a.content, b.content].toSorted());
        if (w > SLACK && h > SLACK && !this.#reported.has(pair)) {
          this.#reported.add(pair);
          this.#report(`text ${quote(a.content)} overlaps text ${quote(b.content)} near (${Math.round(Math.max(a.x, b.x))}, ${Math.round(Math.max(a.y, b.y))}); move one, or place them with v.textBounds first`);
        }
      }
    }
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
      if (code < 0x80 || /[\p{M}\p{Cc}\p{Cf}\s]/u.test(char)) continue;
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
