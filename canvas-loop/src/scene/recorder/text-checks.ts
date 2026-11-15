// Testing mode: checks on recorded text, ported from today's runtime
// (core/painter/text-watch.ts), and the unknown-font check (text.ts). Labels that overlap other labels in one
// frame (text bounds under their transform, each pair once per run, at most
// 10 pairs), and characters the font has no glyph for (headless only: the
// runtime's rasteriser answers `glyphMissing`). Text in a picture body is
// collected when the body records and counted again where each placement puts
// it; mask artwork is never seen and is not checked.
import type { TextBounds } from "../../core/paint.js";
import type { CallSite } from "../call-site.js";
import { callSite } from "../call-site.js";
import type { Mat, SceneNode, TextNode } from "../nodes.js";
import { fontWarning } from "./text.js";

/** A text's letter box, upright, in the coordinates of the frame (or of the picture body it was drawn in). */
export interface TextRect {
  readonly content: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** The letter box's four corners, transformed: a placement moves these, so a rotation undone by an outer one gives an upright box again. */
  readonly corners: readonly (readonly [number, number])[];
  /** Where the sketch drew it. */
  readonly site: CallSite;
}

/** Whether the runtime's font `font` has no glyph for `char`. */
export type GlyphMissing = (char: string, font: { readonly style: string; readonly family: string }) => boolean;

// Most texts compared in one frame.
const MAX_TEXTS = 2000;
/** Most overlapping pairs reported in one run; a changing label could otherwise warn every frame. */
export const MAX_PAIRS = 10;
// Overlap smaller than this in either direction is not reported (antialiasing, touching edges).
const SLACK = 2;

const quote = (s: string): string => JSON.stringify(s.length > 30 ? `${s.slice(0, 29)}…` : s);

type Corners = readonly (readonly [number, number])[];

/** `corners` under `m`. */
const mapped = (m: Mat, corners: Corners): Corners => corners.map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]] as const);

/** The upright box around `corners`. */
function upright(corners: Corners): { x: number; y: number; w: number; h: number } {
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** A text's letter box from its laid-out bounds under `matrix`: the line gap above and below the letters is trimmed. */
export function textRect(content: string, a: { bounds: Pick<TextBounds, "x" | "y" | "w" | "h" | "size">; matrix: Mat; site: CallSite }): TextRect {
  const b = a.bounds;
  const trim = b.size * 0.12;
  const [y0, y1] = [b.y + trim, b.y + b.h - trim];
  const corners = mapped(a.matrix, [[b.x, y0], [b.x + b.w, y0], [b.x, y1], [b.x + b.w, y1]]);
  return { content, ...upright(corners), corners, site: a.site };
}

/** A picture body's text where a placement under `matrix` puts it: its corners move, and the upright box is taken around them once. */
export function placedRect(r: TextRect, matrix: Mat): TextRect {
  const corners = mapped(matrix, r.corners);
  return { ...r, ...upright(corners), corners };
}

/** A pair to report: the earlier-drawn text, the later one (whose line the warning names), and where they meet. */
export interface Overlap {
  readonly first: TextRect;
  readonly second: TextRect;
  readonly at: readonly [number, number];
}

/**
 * The pairs of one frame's texts (in draw order) that overlap and were not
 * reported before, adding them to `reported`. After `MAX_PAIRS` pairs in a
 * run it returns `"more"` once, then nothing.
 */
export function newOverlaps(texts: readonly TextRect[], reported: Set<string>): (Overlap | "more")[] {
  const out: (Overlap | "more")[] = [];
  if (reported.size > MAX_PAIRS) return out;
  const order = new Map(texts.map((t, i) => [t, i]));
  const sorted = texts.slice(0, MAX_TEXTS).toSorted((a, b) => a.x - b.x);
  // Sweep left to right: only texts that start before `a` ends can overlap it.
  for (const [i, a] of sorted.entries()) {
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j];
      if (b === undefined || b.x >= a.x + a.w - SLACK) break;
      const found = overlapOf([a, b], reported);
      if (found === undefined) continue;
      if (reported.size > MAX_PAIRS) return [...out, "more"];
      const [first, second] = (order.get(a) ?? 0) < (order.get(b) ?? 0) ? [a, b] : [b, a];
      out.push({ first, second, at: found });
    }
  }
  return out;
}

function overlapOf([a, b]: readonly [TextRect, TextRect], reported: Set<string>): [number, number] | undefined {
  // The same words twice is a shadow or an outline, drawn on purpose.
  if (a.content === b.content || a.content.trim() === "" || b.content.trim() === "") return undefined;
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (w <= SLACK || h <= SLACK) return undefined;
  const pair = JSON.stringify([a.content, b.content].toSorted());
  if (reported.has(pair)) return undefined;
  reported.add(pair);
  return [Math.max(a.x, b.x), Math.max(a.y, b.y)];
}

/** The warning for one reported pair, or for the cap. */
export function overlapMessage(o: Overlap | "more"): string {
  if (o === "more") return `text: more than ${MAX_PAIRS} pairs of texts overlap; no more overlaps are reported this run`;
  return `text ${quote(o.second.content)} overlaps text ${quote(o.first.content)} near (${Math.round(o.at[0])}, ${Math.round(o.at[1])}); move one, or place them with v.textBounds first`;
}

/** The warning for a character `char` font `font` has no glyph for. */
export function glyphMessage(char: string, font: { style: string; family: string }): string {
  const code = (char.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0");
  return `text: the font "${font.style} ${font.family}" has no glyph for "${char}" (U+${code}); it draws as an empty box or nothing`;
}

// Spaces, controls, format characters and variation selectors draw nothing by design.
const DRAWS_NOTHING = /[\p{Cc}\p{Cf}\s︀-️]/u;

/** One recorder's text checks (testing mode). Each warning goes to `warn` with the line of the call it is about. */
export class TextChecks {
  readonly #glyphMissing: GlyphMissing | undefined;
  readonly #fontKnown: ((family: string) => boolean) | undefined;
  readonly #warn: (once: string, a: { message: string; line: string | undefined }) => void;
  /** This frame's texts, then each recording picture body's, innermost last. */
  #collect: TextRect[][] = [];
  /** Each recorded body's texts, by its node list (a kept version's `children`). */
  readonly #bodies = new WeakMap<readonly SceneNode[], readonly TextRect[]>();
  readonly #reported = new Set<string>();
  /** Contents already checked for glyphs, by font; and the (font, character) pairs warned about, each once per run. */
  readonly #glyphsChecked = new Set<string>();
  readonly #glyphsWarned = new Set<string>();

  constructor(o: { glyphMissing: GlyphMissing | undefined; fontKnown: ((family: string) => boolean) | undefined; warn: (once: string, a: { message: string; line: string | undefined }) => void }) {
    this.#glyphMissing = o.glyphMissing;
    this.#fontKnown = o.fontKnown;
    this.#warn = o.warn;
  }

  begin(): void {
    this.#collect = [[]];
  }

  /** A `v.text` call recorded `node`, laid out in `bounds` under `matrix`; `seen` is false in mask artwork. */
  text(node: TextNode, a: { bounds: TextBounds; matrix: Mat; seen: boolean }): void {
    const font = fontWarning(node, this.#fontKnown);
    if (font !== undefined) this.#warn(`font ${node.family}`, { message: font, line: callSite().line });
    this.#glyphs(node);
    if (a.seen) this.#collect.at(-1)?.push(textRect(node.content, { bounds: a.bounds, matrix: a.matrix, site: callSite() }));
  }

  /** Record a picture body, keeping its texts (in body coordinates) for its placements. */
  body(record: () => SceneNode[]): SceneNode[] {
    const texts: TextRect[] = [];
    this.#collect.push(texts);
    try {
      const children = record();
      this.#bodies.set(children, texts);
      return children;
    } finally {
      this.#collect.pop();
    }
  }

  /** A placement of a version with body `children` under `matrix`: its texts count where they land. */
  placed(children: readonly SceneNode[], matrix: Mat): void {
    const into = this.#collect.at(-1);
    for (const r of this.#bodies.get(children) ?? []) into?.push(placedRect(r, matrix));
  }

  /** The frame's draw returned: warn for pairs of its texts that overlap. */
  end(): void {
    for (const o of newOverlaps(this.#collect[0] ?? [], this.#reported)) {
      this.#warn(o === "more" ? "overlap more" : `overlap ${o.first.content}\u0000${o.second.content}`, { message: overlapMessage(o), line: o === "more" ? undefined : o.second.site.line });
    }
    this.#collect = [];
  }

  #glyphs(node: TextNode): void {
    const missing = this.#glyphMissing;
    if (missing === undefined) return;
    const key = `${node.style} ${node.family}\u0000${node.content}`;
    if (this.#glyphsChecked.has(key)) return;
    // A label that changes every frame (a counter) adds a key each frame.
    if (this.#glyphsChecked.size > 10_000) this.#glyphsChecked.clear();
    this.#glyphsChecked.add(key);
    for (const char of new Set(node.content)) {
      const once = `glyph ${node.style} ${node.family} ${char}`;
      if (DRAWS_NOTHING.test(char) || this.#glyphsWarned.has(once) || !missing(char, node)) continue;
      this.#glyphsWarned.add(once);
      this.#warn(once, { message: glyphMessage(char, node), line: callSite().line });
    }
  }
}
