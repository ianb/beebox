// The glyph atlas (draft section 7): each glyph is rasterised once by the
// runtime's own 2D canvas, at its device size, baseline, halo width and
// quarter-pixel offset, and its coverage kept on the CPU. Each frame packs the
// glyphs it uses onto r8 pages. Headless testing mode also asks the same
// rasteriser which characters a font has no glyph for (`GlyphWatch`).
import type { MakeRaster, RasterCtx } from "../device/open.js";
import type { AtlasPage } from "./atlas.js";
import { shelfPack } from "./atlas.js";
import type { R, Slot } from "./jobs.js";
import type { TexturePool } from "./pool.js";

export interface GlyphKey {
  /** The CSS font at device size. */
  readonly font: string;
  readonly ch: string;
  readonly baseline: string;
  /** A halo's stroke width in device pixels; 0 for the glyph itself. */
  readonly halo: number;
  /** Where the pen sits inside its pixel, in quarters (0..0.75). */
  readonly fx: number;
  readonly fy: number;
}

/** A rasterised glyph: its cell, the pen position inside it, and its coverage row by row. */
export interface GlyphCell {
  readonly w: number;
  readonly h: number;
  readonly ax: number;
  readonly ay: number;
  readonly alpha: Uint8Array;
  /** The cell as a packed box (origin at 0, 0). */
  readonly box: R;
  slot?: Slot;
}

const CACHE_LIMIT = 20_000;

export class GlyphCache {
  readonly #make: MakeRaster;
  #ctx: RasterCtx | undefined;
  #cap = 0;
  readonly #cells = new Map<string, GlyphCell | null>();

  constructor(make: MakeRaster) {
    this.#make = make;
  }

  /** Forget every rasterised glyph and the 2D canvas they were drawn on (sleep). */
  clear(): void {
    this.#cells.clear();
    this.#ctx = undefined;
    this.#cap = 0;
  }

  #canvas(w: number, h: number): RasterCtx {
    const need = Math.max(w, h);
    if (this.#ctx === undefined || need > this.#cap) {
      this.#cap = Math.max(256, Math.ceil(need / 64) * 64);
      this.#ctx = this.#make({ width: this.#cap, height: this.#cap });
    }
    return this.#ctx;
  }

  /** The glyph's cell, or undefined for one that leaves no ink (a space). */
  cell(key: GlyphKey): GlyphCell | undefined {
    const id = `${key.font}\n${key.ch}\n${key.baseline}\n${key.halo}\n${key.fx}\n${key.fy}`;
    const hit = this.#cells.get(id);
    if (hit !== undefined) return hit ?? undefined;
    if (this.#cells.size >= CACHE_LIMIT) this.#cells.clear();
    const cell = this.#raster(key);
    this.#cells.set(id, cell ?? null);
    return cell;
  }

  #raster(key: GlyphKey): GlyphCell | undefined {
    const setup = (c: RasterCtx): void => {
      c.font = key.font;
      c.textBaseline = key.baseline;
      c.textAlign = "left";
    };
    let ctx = this.#canvas(1, 1);
    setup(ctx);
    const m = ctx.measureText(key.ch);
    const pad = 2 + Math.ceil(key.halo / 2);
    const [left, right, up, down] = [m.actualBoundingBoxLeft, m.actualBoundingBoxRight, m.actualBoundingBoxAscent, m.actualBoundingBoxDescent].map((v) => Math.ceil(v));
    if (left === undefined || right === undefined || up === undefined || down === undefined || left + right <= 0 || up + down <= 0) return undefined;
    const w = left + right + 2 * pad + 1;
    const h = up + down + 2 * pad + 1;
    ctx = this.#canvas(w, h);
    setup(ctx);
    ctx.clearRect(0, 0, w, h);
    const ax = pad + left + key.fx;
    const ay = pad + up + key.fy;
    if (key.halo > 0) {
      ctx.lineWidth = key.halo;
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#000000";
      ctx.strokeText(key.ch, ax, ay);
    } else {
      ctx.fillStyle = "#000000";
      ctx.fillText(key.ch, ax, ay);
    }
    const rgba = ctx.getImageData(0, 0, w, h).data;
    const alpha = new Uint8Array(w * h);
    for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * 4 + 3] ?? 0;
    return { w, h, ax, ay, alpha, box: { x0: 0, y0: 0, x1: w, y1: h } };
  }

  /** Pack this frame's cells onto r8 pages and upload them (pool textures the caller releases). */
  build(cells: readonly GlyphCell[], f: { device: GPUDevice; pool: TexturePool }): AtlasPage[] {
    const sizes = shelfPack(cells, Math.max(1024, ...cells.map((c) => c.w + 1)));
    return sizes.map((size, page) => {
      const tex = f.pool.acquire({ w: size.w, h: size.h, format: "r8unorm" });
      for (const c of cells) {
        if (c.slot?.page !== page) continue;
        f.device.queue.writeTexture({ texture: tex, origin: [c.slot.x, c.slot.y] }, c.alpha, { bytesPerRow: c.w }, [c.w, c.h]);
      }
      return { tex, width: tex.width, height: tex.height };
    });
  }
}

// Characters a font has no glyph for (the Canvas2D painter's check, kept):
// a character whose pixels and box match the font's missing-glyph mark draws
// as an empty box or nothing. Headless only, as today: a browser loads web
// fonts later. Each (font, character) is drawn once.
const PROBE = 48;
// A private-use character no common font draws: what "no glyph" looks like in a font.
const MISSING = "\u{10FFFD}";

export class GlyphWatch {
  readonly #make: MakeRaster;
  #ctx: RasterCtx | undefined;
  readonly #answers = new Map<string, boolean>();
  readonly #missingMark = new Map<string, string>();

  constructor(make: MakeRaster) {
    this.#make = make;
  }

  /** Whether `font` (its style and family list) has no glyph for `char`. */
  readonly missing = (char: string, font: { readonly style: string; readonly family: string }): boolean => {
    const name = `${font.style} 24px ${font.family}`;
    const key = `${name}\u0000${char}`;
    const known = this.#answers.get(key);
    if (known !== undefined) return known;
    let mark = this.#missingMark.get(name);
    if (mark === undefined) {
      mark = this.#ink(MISSING, name);
      this.#missingMark.set(name, mark);
    }
    const answer = this.#ink(char, name) === mark;
    this.#answers.set(key, answer);
    return answer;
  };

  /** A fingerprint of `char`'s pixels and box in CSS font `font`. */
  #ink(char: string, font: string): string {
    this.#ctx ??= this.#make({ width: PROBE, height: PROBE });
    const ctx = this.#ctx;
    ctx.clearRect(0, 0, PROBE, PROBE);
    ctx.font = font;
    ctx.fillStyle = "#000000";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(char, 8, PROBE / 2);
    const { data } = ctx.getImageData(0, 0, PROBE, PROBE);
    let hash = 0;
    for (let i = 3; i < data.length; i += 4) hash = (Math.imul(hash, 31) + (data[i] ?? 0)) >>> 0;
    const m = ctx.measureText(char);
    return `${[m.actualBoundingBoxLeft, m.actualBoundingBoxRight, m.actualBoundingBoxAscent, m.actualBoundingBoxDescent].join(",")}:${String(hash)}`;
  }
}
