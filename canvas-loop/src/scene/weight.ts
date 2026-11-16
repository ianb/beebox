// An estimate of the memory a picture version's recording holds, for the
// picture table's and the raster cache's idle budgets.
import type { PictureVersion, PixelsVersion, SceneNode } from "./nodes.js";

type Version = PictureVersion | PixelsVersion;

/** A rough size of one recorded node in bytes. */
const NODE_BYTES = 512;

function nodeCount(nodes: readonly SceneNode[]): number {
  let n = nodes.length;
  for (const node of nodes) {
    if (node.kind === "mask") n += nodeCount(node.mask) + nodeCount(node.body);
    else if ("children" in node) n += nodeCount(node.children);
  }
  return n;
}

const weights = new WeakMap<Version, number>();

/** An estimate of the bytes a version's recording holds: its deps and its pixels, or its nodes at `NODE_BYTES` each. Kept per version. */
export function weightOf(v: Version): number {
  const known = weights.get(v);
  if (known !== undefined) return known;
  const deps = v.deps === undefined ? 0 : JSON.stringify(v.deps).length * 2;
  const w = deps + (v.kind === "pixels" ? v.data.byteLength : Math.max(1, nodeCount(v.children)) * NODE_BYTES);
  weights.set(v, w);
  return w;
}
