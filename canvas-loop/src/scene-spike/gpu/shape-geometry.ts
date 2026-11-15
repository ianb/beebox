// A shape's coverage geometry for lowering, kept between frames under its
// recorded geometry's key and the linear part of its transform
// (geometry-cache.ts): flattened outlines, fill and stroke rings, and a clip's
// coverage (a one-shape clip whose outline is one simple ring reads the
// coverage atlas; any other clip sums windings per pixel).
import { polylines as flatten } from "../geometry/flatten.js";
import type { Poly } from "../geometry/flatten.js";
import { dotRings, strokeRings } from "../geometry/stroke.js";
import { dashPolys } from "../geometry/dash.js";
import { keyOf, linearKey } from "../hash.js";
import { maxScale } from "../mat.js";
import type { Geom, Mat, ShapeStyle } from "../scene.js";
import type { KeptValues, LinShape } from "./geometry-cache.js";
import { linShape, linearRings, placePiece, translated } from "./geometry-cache.js";
import type { Piece, R } from "./jobs.js";
import { cutRings, isSimpleRing, orientShape } from "./rings.js";

export class ShapeGeometry {
  readonly #kept: KeptValues;

  constructor(kept: KeptValues) {
    this.#kept = kept;
  }

  /** `g` flattened for the scale of `m`. */
  #polys(g: Geom, m: Mat): readonly Poly[] {
    const sc = maxScale(m);
    return this.#kept.get(`p|${keyOf(g)}|${sc}`, () => flatten(g, sc));
  }

  /** `g`'s fill rings under the linear part of `m`. */
  fill(g: Geom, m: Mat): LinShape {
    return this.#kept.get(`f|${keyOf(g)}|${linearKey(m)}`, () => linShape(linearRings(this.#polys(g, m).map((p) => p.pts).filter((r) => r.length >= 6), m)));
  }

  /** `g`'s plain stroke rings under the linear part of `m`. */
  stroke(g: Geom, a: { style: ShapeStyle; m: Mat }): LinShape {
    const { style: s, m } = a;
    return this.#kept.get(`s|${keyOf(g)}|${s.weight}|${s.cap}|${s.join}|${s.dash?.join(",") ?? ""}|${linearKey(m)}`, () => {
      const at = { style: s, scale: maxScale(m) };
      const rings = this.#polys(g, m).flatMap((p) => {
        if (s.dash === undefined) return strokeRings(p, at);
        const { pieces, dots } = dashPolys(p, s.dash);
        return [...pieces.flatMap((q) => strokeRings(q, at)), ...dots.flatMap((d) => dotRings(d, at))];
      });
      return linShape(linearRings(rings, m));
    });
  }

  /** Whether `g` under `m` is one simple closed ring (no edge touching another). */
  #simple(g: Geom, m: Mat): boolean {
    if (g.kind === "rect" || g.kind === "ellipse" || g.kind === "arc") return true;
    return this.#kept.get(`simple|${keyOf(g)}|${linearKey(m)}`, () => {
      const rings = this.fill(g, m).live;
      return rings.length === 1 && rings[0] !== undefined && isSimpleRing(rings[0]);
    });
  }

  /** A clip's coverage in device pixels, cut to `cut`: a piece for one simple shape, else every distinct shape's rings (each oriented positive). */
  clip(shapes: readonly Geom[], a: { m: Mat; cut: R }): { piece: Piece | undefined } | { rings: number[][] } {
    const { m, cut } = a;
    // Repeats of one shape are that shape: the union of equal shapes is the shape.
    const distinct = [...new Map(shapes.map((g) => [keyOf(g), g])).values()];
    const only = distinct.length === 1 ? distinct[0] : undefined;
    if (only !== undefined && this.#simple(only, m)) return { piece: placePiece(this.fill(only, m), { tx: m[4], ty: m[5], cut }) };
    return { rings: cutRings(distinct.flatMap((g) => orientShape(translated(this.fill(g, m).rings, [m[4], m[5]]))), cut) };
  }
}
