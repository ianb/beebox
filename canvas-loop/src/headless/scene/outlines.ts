// `run --outline` on the scene surface: where clips cut and pictures were
// placed, in canvas coordinates, as today's painter outlines clips and
// sprites. The recorder's debug boxes (`FrameRecord.debugBoxes`) are drawn
// beside these.
import type { Vec2 } from "../../core/paint.js";
import { polylines } from "../../scene/geometry/flatten.js";
import { IDENTITY, apply, mul } from "../../scene/mat.js";
import type { Geom, Mat, SceneNode } from "../../scene/nodes.js";

/** A clip's outline or a placed picture's box, for `run --outline`, in canvas coordinates. */
export interface Outline {
  readonly kind: "clip" | "picture";
  readonly label: string;
  readonly points: readonly Vec2[];
}

function clipOutlines(shapes: readonly Geom[], a: { m: Mat; out: Outline[] }): void {
  for (const g of shapes) {
    for (const poly of polylines(g, 1)) {
      const points: Vec2[] = [];
      for (let i = 0; i + 1 < poly.pts.length; i += 2) points.push(apply(a.m, [poly.pts[i] ?? 0, poly.pts[i + 1] ?? 0]));
      a.out.push({ kind: "clip", label: "clip", points });
    }
  }
}

function walkOutlines(nodes: readonly SceneNode[], a: { m: Mat; out: Outline[] }): void {
  for (const n of nodes) {
    switch (n.kind) {
      case "at":
        walkOutlines(n.children, { ...a, m: mul(a.m, n.matrix) });
        break;
      case "group":
        if (n.clip !== undefined) clipOutlines(n.clip, a);
        walkOutlines(n.children, a);
        break;
      case "clip":
        clipOutlines(n.shapes, a);
        walkOutlines(n.children, a);
        break;
      case "mask":
        walkOutlines(n.mask, a);
        walkOutlines(n.body, a);
        break;
      case "place": {
        const { x, y } = n;
        const { width: w, height: h } = n.picture;
        a.out.push({ kind: "picture", label: n.picture.key, points: [apply(a.m, [x, y]), apply(a.m, [x + w, y]), apply(a.m, [x + w, y + h]), apply(a.m, [x, y + h])] });
        if (n.picture.kind === "picture") walkOutlines(n.picture.children, { ...a, m: mul(a.m, [1, 0, 0, 1, x, y]) });
        break;
      }
      case "shape":
      case "background":
      case "text":
      case "light":
      case "debug":
        break;
    }
  }
}

/** Where clips cut and pictures were placed, walking into placed pictures under their placement. */
export function outlinesOf(nodes: readonly SceneNode[]): Outline[] {
  const out: Outline[] = [];
  walkOutlines(nodes, { m: IDENTITY, out });
  return out;
}
