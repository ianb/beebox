// The brushed strokes of a recorded scene, as the renderer's lowering asks the
// expander for them (gpu/marks.ts `brushDraw`): one request per brushed shape,
// under the logical transform of its call. Pictures are walked where placed.
import type { ExpandRequest } from "../../src/scene/brush/expand.js";
import type { ColorParser } from "../../src/scene/colors.js";
import { mul } from "../../src/scene/mat.js";
import type { Mat, Scene, SceneNode } from "../../src/scene/nodes.js";

/** A parser for scenes whose brushes need no colour (no hue or light jitter). */
export const NO_COLORS: ColorParser = (css) => {
  throw new Error(`no colour parser in this test (asked for ${css})`);
};

export function brushRequests(scene: Scene, colors: ColorParser): ExpandRequest[] {
  const out: ExpandRequest[] = [];
  const walk = (nodes: readonly SceneNode[], m: Mat): void => {
    for (const n of nodes) {
      if (n.kind === "shape" && n.style.brush !== undefined && n.style.stroke !== undefined && n.style.weight > 0) {
        out.push({ geom: n.geom, weight: n.style.weight, stroke: n.style.brush, paint: n.style.stroke, linear: [m[0], m[1], m[2], m[3], 0, 0], colors });
      }
      if (n.kind === "at") walk(n.children, mul(m, n.matrix));
      else if (n.kind === "group" || n.kind === "clip") walk(n.children, m);
      else if (n.kind === "mask") {
        walk(n.mask, m);
        walk(n.body, m);
      } else if (n.kind === "place" && n.picture.kind === "picture") walk(n.picture.children, mul(m, [1, 0, 0, 1, n.x, n.y]));
    }
  };
  walk(scene.children, [1, 0, 0, 1, 0, 0]);
  return out;
}
