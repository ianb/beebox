// Which pictures cannot be cut into tiles (rasters.ts): those whose drawing at
// a pixel depends on what lies beyond the tile. A smudge or wet stroke picks up
// paint along its path; hatching measures its group's tone range; a wash bleeds
// and blurs its pigment; a lit group casts shadows across itself. Such a
// picture, or one placing such a picture, renders as one layer over its whole
// extent. Decided once per version.
import type { Effects } from "../core/tea.js";
import type { PictureVersion, SceneNode } from "../scene/nodes.js";

const memo = new WeakMap<PictureVersion, boolean>();

const reads = (e: Effects | undefined): boolean => e?.wash !== undefined || e?.hatching !== undefined;

function nodeReads(n: SceneNode): boolean {
  switch (n.kind) {
    case "shape":
      return n.style.brush?.brush.kind === "smear" || reads(n.style.effects);
    case "group":
      return n.lighting !== undefined || reads(n.effects) || n.children.some(nodeReads);
    case "at":
    case "clip":
      return n.children.some(nodeReads);
    case "mask":
      return n.mask.some(nodeReads) || n.body.some(nodeReads);
    case "place":
      return n.picture.kind === "picture" && readsSurroundings(n.picture);
    case "background":
    case "text":
    case "debug":
    case "light":
      return false;
  }
}

/** The picture has content that reads beyond any tile it would be cut into. */
export function readsSurroundings(v: PictureVersion): boolean {
  const hit = memo.get(v);
  if (hit !== undefined) return hit;
  const r = v.children.some(nodeReads);
  memo.set(v, r);
  return r;
}
