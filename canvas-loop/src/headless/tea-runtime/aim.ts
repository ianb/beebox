// Scripted aim (plan:canvas-loop-layout-text-hits.subplan, Track B item 4): a
// mouse entry with `"target": "pan-left"` and no x or y clicks the centre of
// the layout box of the topmost drawing named so in the hit scene (any depth,
// inside placed pictures too), in canvas pixels rounded as the browser
// rounds pointer positions. The centre is then hit-tested like any click; if
// it does not land on the name (a ring's hole, another named drawing on top),
// the run stops rather than click something else.
import type { Vec2 } from "../../core/paint.js";
import { EventScriptError } from "../errors.js";
import { hitTest } from "../../scene/hit.js";
import type { Hit } from "../../scene/hit.js";
import { layoutBox } from "../../scene/layout-box.js";
import { IDENTITY, apply, mul } from "../../scene/mat.js";
import type { Mat, Scene, SceneNode } from "../../scene/nodes.js";

interface Found {
  readonly node: SceneNode;
  /** From the node's coordinates to the canvas. */
  readonly m: Mat;
}

/** The topmost node named `name` in `nodes` (drawn last first), or undefined. A named node is found before the nodes inside it. */
function find(nodes: readonly SceneNode[], a: { name: string; m: Mat }): Found | undefined {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    if (n === undefined) continue;
    if ("name" in n && n.name === a.name) return { node: n, m: a.m };
    const found = findInside(n, a);
    if (found !== undefined) return found;
  }
  return undefined;
}

function findInside(n: SceneNode, a: { name: string; m: Mat }): Found | undefined {
  switch (n.kind) {
    case "at":
      return find(n.children, { ...a, m: mul(a.m, n.matrix) });
    case "group":
    case "clip":
      return find(n.children, a);
    case "mask":
      return find(n.body, a);
    case "place":
      return n.picture.kind === "picture" ? find(n.picture.children, { ...a, m: mul(a.m, [1, 0, 0, 1, n.x, n.y]) }) : undefined;
    case "shape":
    case "text":
    case "background":
    case "light":
    case "debug":
      return undefined;
  }
}

/** The centre of the found node's layout box on the canvas, rounded; undefined when it has none (it draws nothing). */
function centre(f: Found): Vec2 | undefined {
  const b = layoutBox([f.node]);
  if (b === null) return undefined;
  const corners = [apply(f.m, [b.x, b.y]), apply(f.m, [b.x + b.w, b.y]), apply(f.m, [b.x, b.y + b.h]), apply(f.m, [b.x + b.w, b.y + b.h])];
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  return [Math.round((Math.min(...xs) + Math.max(...xs)) / 2), Math.round((Math.min(...ys) + Math.max(...ys)) / 2)];
}

/**
 * Where a mouse entry with a `target` clicks, and what is there. Throws
 * `EventScriptError` naming the frame, the type and the name when there is no
 * scene (frame 0), no drawing named so with a layout box, or when the centre
 * lands on something else.
 */
export function aimAt(scene: Scene | undefined, e: { frame: number; type: string; target: string }): { point: Vec2; hit: Hit } {
  const where = `frame ${e.frame}: ${e.type} target ${JSON.stringify(e.target)}`;
  if (scene === undefined) throw new EventScriptError({ detail: `${where}: nothing is drawn before frame 0's events, so there is nothing to aim at; aim with x and y, or from frame 1` });
  const found = find(scene.children, { name: e.target, m: IDENTITY });
  const point = found === undefined ? undefined : centre(found);
  if (point === undefined) throw new EventScriptError({ detail: `${where}: no drawing named so, with a size, in the scene drawn at frame ${e.frame - 1}` });
  const hit = hitTest(scene, point);
  if (!hit.targets.includes(e.target)) {
    const landed = hit.targets.length === 0 ? "no named drawing" : hit.targets.map((t) => JSON.stringify(t)).join(" in ");
    throw new EventScriptError({ detail: `${where}: its centre (${point[0]},${point[1]}) lands on ${landed}; aim with x and y` });
  }
  return { point, hit };
}
