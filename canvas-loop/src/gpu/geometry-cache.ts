// Coverage geometry kept between frames (draft section 6). A shape's outline
// is flattened and stroked for the linear part of its device transform, and
// kept under its recorded geometry's key and that linear part; translation is
// added afterwards. Lowering always goes through this split, so a frame drawn
// with the cache, without it, or after waking computes the same numbers: the
// cache only skips recomputing a pure function of its key. An entry not used
// in the last frame is dropped.
import type { Piece, R } from "./jobs.js";
import { cutRings, pieceOf, ringArea } from "./rings.js";

/** Rings in device pixels without the transform's translation, their bounds, and which have area. */
export interface LinShape {
  readonly rings: readonly (readonly number[])[];
  /** The rings with nonzero area: what a piece wholly inside its cut box keeps. */
  readonly live: readonly (readonly number[])[];
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export function linShape(rings: readonly (readonly number[])[]): LinShape {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const r of rings) {
    for (let i = 0; i + 1 < r.length; i += 2) {
      const x = r[i] ?? 0;
      const y = r[i + 1] ?? 0;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return { rings, live: rings.filter((r) => r.length >= 6 && ringArea(r) !== 0), x0, y0, x1, y1 };
}

/** Linear rings: each point under the linear part of `m` (no translation). */
export function linearRings(rings: readonly (readonly number[])[], m: readonly number[]): number[][] {
  const [a = 1, b = 0, c = 0, d = 1] = m;
  return rings.map((r) => {
    const o: number[] = [];
    for (let i = 0; i + 1 < r.length; i += 2) {
      const x = r[i] ?? 0;
      const y = r[i + 1] ?? 0;
      o.push(a * x + c * y, b * x + d * y);
    }
    return o;
  });
}

/**
 * `s` translated by (tx, ty), cut to `cut`, as a coverage piece. A shape
 * wholly inside `cut` keeps its rings (shared, untranslated: the piece carries
 * the translation); one wholly outside is nothing; one across the edge is
 * translated and cut (Sutherland–Hodgman keeps every inside point's winding).
 */
export function placePiece(s: LinShape, a: { tx: number; ty: number; cut: R }): Piece | undefined {
  const { tx, ty, cut } = a;
  if (!(s.x1 > s.x0 && s.y1 > s.y0)) return undefined;
  const x0 = s.x0 + tx;
  const y0 = s.y0 + ty;
  const x1 = s.x1 + tx;
  const y1 = s.y1 + ty;
  if (!Number.isFinite(x0 + x1 + y0 + y1)) return undefined;
  if (x1 < cut.x0 || x0 > cut.x1 || y1 < cut.y0 || y0 > cut.y1) return undefined;
  if (x0 >= cut.x0 && x1 <= cut.x1 && y0 >= cut.y0 && y1 <= cut.y1) {
    if (s.live.length === 0) return undefined;
    return { rings: s.live, box: { x0: Math.floor(x0), y0: Math.floor(y0), x1: Math.ceil(x1), y1: Math.ceil(y1) }, ox: tx, oy: ty };
  }
  return pieceOf(cutRings(translated(s.rings, [tx, ty]), cut));
}

/** Rings moved by `t`. */
export function translated(rings: readonly (readonly number[])[], t: readonly [number, number]): number[][] {
  const [tx, ty] = t;
  return rings.map((r) => {
    const o: number[] = [];
    for (let i = 0; i + 1 < r.length; i += 2) o.push((r[i] ?? 0) + tx, (r[i + 1] ?? 0) + ty);
    return o;
  });
}

/** Values kept by key while used: an entry not asked for in the last frame is dropped. Disabled, it computes every time. */
export class KeptValues {
  readonly #map = new Map<string, { value: unknown; frame: number }>();
  readonly #enabled: boolean;
  #frame = 0;
  hits = 0;
  misses = 0;

  constructor(enabled: boolean) {
    this.#enabled = enabled;
  }

  beginFrame(): void {
    this.#frame++;
    for (const [k, e] of this.#map) if (e.frame < this.#frame - 1) this.#map.delete(k);
    this.hits = 0;
    this.misses = 0;
  }

  /** The value under `key`, made by `make` when not kept. `T` must be what `make` returns for that key every time. */
  get<T>(key: string, make: () => T): T {
    if (!this.#enabled) {
      this.misses++;
      return make();
    }
    const e = this.#map.get(key);
    if (e !== undefined) {
      e.frame = this.#frame;
      this.hits++;
      // eslint-disable-next-line no-restricted-syntax -- one typed helper: each key is only ever made by one `make`, so its value has that make's type
      return e.value as T;
    }
    this.misses++;
    const value = make();
    this.#map.set(key, { value, frame: this.#frame });
    return value;
  }

  get size(): number {
    return this.#map.size;
  }

  /** Forget every kept value (sleep). */
  clear(): void {
    this.#map.clear();
  }
}
