// Kept picture rasters (draft section 6, 2.6). A placed picture renders in
// raster space: its device transform with the translation snapped to whole
// device pixels and taken out, so every placement of a version under one
// linear transform shares one raster, and a placement that moves (a panning
// camera) reuses it. Raster space is cut into a fixed grid of 2048 px tiles
// aligned to the picture's origin; a tile's pixels depend only on the version,
// the linear transform, the pixel ratio and the tile, so a kept tile, a fresh
// one and one drawn after waking agree byte for byte. A picture whose content
// reads its surroundings (smudge, wet, wash, hatching, lighting) is one layer
// over its whole extent instead (picture-reads.ts). Tiles not placed in the
// last two frames are destroyed, and past 256 MB the least recently placed go
// first; no texture is held outside that count.
import type { PictureVersion } from "../scene.js";
import type { R } from "./jobs.js";
import { heightOf, widthOf } from "./jobs.js";
import { GpuRenderError } from "../errors.js";

/** Tile side in device pixels. */
export const TILE = 2048;
/** The largest side of a texture: a picture drawn as one layer must fit. */
const TILE_MAX = 8192;

/** The fixed grid's tiles that `r` (raster space) touches. */
/**
 * The one layer of a picture that reads its surroundings: the grid tiles the
 * placement can be seen in (`grid`, raster space, the visible area grown by
 * enclosing effects' reach), joined. The layer's region, and so its pixels,
 * depends only on which tiles those are, so it is kept under them; a layer
 * past the texture limit is an error.
 */
export function wholeLayer(grid: readonly R[], a: { raster: string; name: string }): { key: string; tile: R } {
  const x0 = Math.min(...grid.map((t) => t.x0));
  const y0 = Math.min(...grid.map((t) => t.y0));
  const x1 = Math.max(...grid.map((t) => t.x1));
  const y1 = Math.max(...grid.map((t) => t.y1));
  if (x1 - x0 > TILE_MAX || y1 - y0 > TILE_MAX) throw new GpuRenderError({ detail: `picture "${a.name}" reads its surroundings (smudge, wet, wash, hatching or lighting), so it draws as one layer, and the ${x1 - x0}×${y1 - y0} device px it can be seen in is larger than ${TILE_MAX}` });
  return { key: `${a.raster}|whole ${x0},${y0},${x1},${y1}`, tile: { x0, y0, x1, y1 } };
}

export function tilesOver(r: R): R[] {
  const out: R[] = [];
  for (let ty = Math.floor(r.y0 / TILE); ty * TILE < r.y1; ty++) for (let tx = Math.floor(r.x0 / TILE); tx * TILE < r.x1; tx++) out.push({ x0: tx * TILE, y0: ty * TILE, x1: (tx + 1) * TILE, y1: (ty + 1) * TILE });
  return out;
}
/** Bytes of kept raster textures before the least recently placed are destroyed. */
const BUDGET = 256 * 1024 * 1024;
const USES = 0x10 | 0x04 | 0x01 | 0x02; // RENDER_ATTACHMENT | TEXTURE_BINDING | COPY_SRC | COPY_DST

export interface KeptTile {
  /** The tile's drawn region in raster space (empty when the tile holds nothing). */
  readonly rect: R;
  readonly tex: GPUTexture | undefined;
  frame: number;
}

export class RasterCache {
  readonly #device: GPUDevice;
  readonly #enabled: boolean;
  readonly #tiles = new Map<PictureVersion, Map<string, KeptTile>>();
  #frame = 0;
  hits = 0;
  drawn = 0;

  constructor(device: GPUDevice, enabled: boolean) {
    this.#device = device;
    this.#enabled = enabled;
  }

  beginFrame(): void {
    this.#frame++;
    this.hits = 0;
    this.drawn = 0;
  }

  /** The kept tile, marked as placed this frame. */
  kept(version: PictureVersion, key: string): KeptTile | undefined {
    if (!this.#enabled) return undefined;
    const t = this.#tiles.get(version)?.get(key);
    if (t === undefined) return undefined;
    t.frame = this.#frame;
    this.hits++;
    return t;
  }

  /** A new texture for a tile of `rect`'s size. */
  texture(rect: R): GPUTexture {
    return this.#device.createTexture({ size: [widthOf(rect), heightOf(rect)], format: "rgba8unorm", usage: USES });
  }

  /** Keep a drawn tile (its texture now belongs to the cache, replacing any tile under its key); disabled, the texture is destroyed once the frame's work is done. */
  store(version: PictureVersion, a: { key: string; rect: R; tex: GPUTexture | undefined }): void {
    this.drawn++;
    if (!this.#enabled) {
      a.tex?.destroy();
      return;
    }
    const map = this.#tiles.get(version) ?? new Map<string, KeptTile>();
    const replaced = map.get(a.key)?.tex;
    if (replaced !== undefined && replaced !== a.tex) replaced.destroy();
    map.set(a.key, { rect: a.rect, tex: a.tex, frame: this.#frame });
    this.#tiles.set(version, map);
  }

  /** A texture made by `texture` that will not be kept (a failed frame). */
  discard(tex: GPUTexture): void {
    tex.destroy();
  }

  /** After a frame: destroy tiles not placed in the last two frames, then the least recently placed past the budget. */
  endFrame(): void {
    const all: { version: PictureVersion; key: string; tile: KeptTile }[] = [];
    for (const [version, map] of this.#tiles) {
      for (const [key, tile] of map) {
        if (tile.frame < this.#frame - 1) this.#drop(version, key);
        else all.push({ version, key, tile });
      }
    }
    let bytes = all.reduce((n, e) => n + tileBytes(e.tile), 0);
    for (const e of all.toSorted((a, b) => a.tile.frame - b.tile.frame)) {
      if (bytes <= BUDGET) break;
      bytes -= tileBytes(e.tile);
      this.#drop(e.version, e.key);
    }
  }

  #drop(version: PictureVersion, key: string): void {
    const map = this.#tiles.get(version);
    const t = map?.get(key);
    if (map === undefined || t === undefined) return;
    map.delete(key);
    if (map.size === 0) this.#tiles.delete(version);
    t.tex?.destroy();
  }

  /** Kept tiles holding a texture (empty tiles hold none), and their bytes: every raster texture the cache owns. */
  get held(): { tiles: number; bytes: number } {
    let tiles = 0;
    let bytes = 0;
    for (const map of this.#tiles.values()) {
      for (const t of map.values()) {
        if (t.tex === undefined) continue;
        tiles++;
        bytes += tileBytes(t);
      }
    }
    return { tiles, bytes };
  }

  destroy(): void {
    for (const map of this.#tiles.values()) for (const t of map.values()) t.tex?.destroy();
    this.#tiles.clear();
  }
}

function tileBytes(t: KeptTile): number {
  return t.tex === undefined ? 0 : t.tex.width * t.tex.height * 4;
}
