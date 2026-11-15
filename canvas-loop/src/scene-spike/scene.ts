// The scene that one `draw` records (draft 2.2, beebox/docs/plans/canvas-loop-scene/scene-api-draft.md):
// plain data, captured by value at each call. A renderer draws it by the
// lowering contract (R1–R9). Transforms are `at` nodes; every other node's
// geometry is in the coordinates of its enclosing `at` scopes.
import type { BlendMode, Paint, PathCommand, Vec2 } from "../core/paint.js";
import type { Effects } from "../scene-draft/scene-api.js";

/** A 2D affine transform `[a, b, c, d, e, f]`: x' = a·x + c·y + e, y' = b·x + d·y + f (Canvas2D order). */
export type Mat = readonly [number, number, number, number, number, number];

/** A shape's outline as data. Round shapes stay exact here; the renderer flattens them for its pixel size. */
export type Geom =
  | { readonly kind: "rect"; readonly x: number; readonly y: number; readonly w: number; readonly h: number }
  | { readonly kind: "ellipse"; readonly x: number; readonly y: number; readonly rx: number; readonly ry: number }
  /** Canvas2D `arc`: the fill closes the chord; the stroke is the open arc. */
  | { readonly kind: "arc"; readonly x: number; readonly y: number; readonly r: number; readonly start: number; readonly end: number }
  | { readonly kind: "poly"; readonly points: readonly Vec2[]; readonly closed: boolean }
  | { readonly kind: "path"; readonly commands: readonly PathCommand[] };

/** A style with its defaults filled in (draft 2.2 `Style`, minus what the spike does not draw yet). */
export interface ShapeStyle {
  readonly fill: Paint | undefined;
  readonly stroke: Paint | undefined;
  readonly weight: number;
  readonly cap: "butt" | "round" | "square";
  readonly join: "miter" | "round" | "bevel";
  readonly blend: BlendMode;
  readonly erase: boolean;
  /** R2: the shape draws into its own layer, these apply, then the layer composites with `blend` or `erase`. */
  readonly effects: Effects | undefined;
}

export interface ShapeNode {
  readonly kind: "shape";
  /** The View call that made it (`rect`, `curve`, …), for messages and outlines. */
  readonly call: string;
  readonly geom: Geom;
  readonly style: ShapeStyle;
}
/** `background(paint)`: the whole canvas, ignoring transforms, source-over onto the current target. */
export interface BackgroundNode {
  readonly kind: "background";
  readonly paint: Paint;
}
/** R3: a transform for the children; no layer. */
export interface AtNode {
  readonly kind: "at";
  readonly matrix: Mat;
  readonly children: readonly SceneNode[];
}
/** R5: the children as one isolated layer. */
export interface GroupNode {
  readonly kind: "group";
  readonly name: string | undefined;
  readonly opacity: number;
  readonly blend: BlendMode;
  readonly effects: Effects | undefined;
  /** The group's `clip` option (after its effects), as a union of shapes. */
  readonly clip: readonly Geom[] | undefined;
  readonly children: readonly SceneNode[];
}
/** R4: the children draw onto the current target, inside the union of `shapes`. */
export interface ClipNode {
  readonly kind: "clip";
  readonly shapes: readonly Geom[];
  readonly children: readonly SceneNode[];
}
/** R6: `body` kept in proportion to the alpha of `mask`. */
export interface MaskNode {
  readonly kind: "mask";
  readonly mask: readonly SceneNode[];
  readonly body: readonly SceneNode[];
}

export type SceneNode = ShapeNode | BackgroundNode | AtNode | GroupNode | ClipNode | MaskNode;

/** What one `draw` recorded: the canvas size in logical pixels and the top-level nodes. */
export interface Scene {
  readonly width: number;
  readonly height: number;
  readonly children: readonly SceneNode[];
}

function geomText(g: Geom): string {
  const r = (n: number): string => String(Math.round(n * 100) / 100);
  switch (g.kind) {
    case "rect":
      return `(${r(g.x)},${r(g.y)}) ${r(g.w)}×${r(g.h)}`;
    case "ellipse":
      return `(${r(g.x)},${r(g.y)}) r ${r(g.rx)}×${r(g.ry)}`;
    case "arc":
      return `(${r(g.x)},${r(g.y)}) r ${r(g.r)} ${r(g.start)}..${r(g.end)}`;
    case "poly":
      return `${g.points.length} points${g.closed ? "" : " open"}`;
    case "path":
      return `${g.commands.length} commands`;
  }
}

function paintText(p: Paint | undefined): string {
  if (p === undefined) return "none";
  return typeof p === "string" ? p : p.kind;
}

function nodeLine(n: SceneNode): string {
  switch (n.kind) {
    case "shape": {
      const s = n.style;
      const extra = [s.blend === "normal" ? "" : ` blend ${s.blend}`, s.erase ? " erase" : "", s.effects === undefined ? "" : ` effects ${Object.keys(s.effects).join(",")}`].join("");
      return `${n.call} ${geomText(n.geom)} fill ${paintText(s.fill)} stroke ${paintText(s.stroke)}${extra}`;
    }
    case "background":
      return `background ${paintText(n.paint)}`;
    case "at":
      return `at [${n.matrix.map((v) => Math.round(v * 1000) / 1000).join(", ")}]`;
    case "group": {
      const name = n.name === undefined ? "" : ` "${n.name}"`;
      const fx = n.effects === undefined ? "" : ` effects ${Object.keys(n.effects).join(",")}`;
      return `group${name} opacity ${n.opacity} blend ${n.blend}${fx}${n.clip === undefined ? "" : ` clip ${n.clip.length}`}`;
    }
    case "clip":
      return `clip ${n.shapes.length} shape${n.shapes.length === 1 ? "" : "s"}`;
    case "mask":
      return "mask";
  }
}

function outlineInto(out: string[], args: { nodes: readonly SceneNode[]; depth: number }): void {
  const pad = "  ".repeat(args.depth);
  for (const n of args.nodes) {
    out.push(pad + nodeLine(n));
    if (n.kind === "mask") {
      out.push(`${pad}  mask body:`);
      outlineInto(out, { nodes: n.mask, depth: args.depth + 2 });
      out.push(`${pad}  drawn:`);
      outlineInto(out, { nodes: n.body, depth: args.depth + 2 });
    } else if (n.kind === "at" || n.kind === "group" || n.kind === "clip") {
      outlineInto(out, { nodes: n.children, depth: args.depth + 1 });
    }
  }
}

/** The scene as an indented outline, one node per line (`run --scene`). */
export function sceneOutline(scene: Scene): string {
  const out = [`scene ${scene.width}×${scene.height}`];
  outlineInto(out, { nodes: scene.children, depth: 1 });
  return out.join("\n");
}
