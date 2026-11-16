// Debug boxes (section 8) gathered from a recorded scene: each `debug` node in
// canvas coordinates under its `at` scopes, and, inside a placed picture, once
// per placement under that placement. So a box in a picture moves with it and
// is there whether or not the picture recorded this frame.
import type { Vec2 } from "../../core/paint.js";
import { IDENTITY, apply, mul } from "../mat.js";
import type { Mat, SceneNode } from "../nodes.js";

/** A labelled box for `run --outline`, in canvas coordinates. */
export interface DebugBox {
  readonly label: string;
  readonly corners: readonly Vec2[];
}

function walk(nodes: readonly SceneNode[], a: { m: Mat; out: DebugBox[] }): void {
  for (const n of nodes) {
    switch (n.kind) {
      case "debug": {
        const { x, y, w, h } = n;
        a.out.push({ label: n.label, corners: [apply(a.m, [x, y]), apply(a.m, [x + w, y]), apply(a.m, [x + w, y + h]), apply(a.m, [x, y + h])] });
        break;
      }
      case "at":
        walk(n.children, { ...a, m: mul(a.m, n.matrix) });
        break;
      case "group":
      case "clip":
        walk(n.children, a);
        break;
      case "mask":
        walk(n.mask, a);
        walk(n.body, a);
        break;
      case "place":
        if (n.picture.kind === "picture") walk(n.picture.children, { ...a, m: mul(a.m, [1, 0, 0, 1, n.x, n.y]) });
        break;
      case "shape":
      case "background":
      case "text":
      case "light":
        break;
    }
  }
}

export function debugBoxesOf(nodes: readonly SceneNode[]): DebugBox[] {
  const out: DebugBox[] = [];
  walk(nodes, { m: IDENTITY, out });
  return out;
}
