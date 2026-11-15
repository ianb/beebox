// The scene as an indented outline (`run --scene`): one node per line, then
// each picture version the frame placed, once, with its body.
import type { Paint } from "../core/paint.js";
import type { Geom, PictureVersion, PixelsVersion, Scene, SceneNode, ShapeNode } from "./scene.js";

const r = (n: number): string => String(Math.round(n * 100) / 100);

function geomText(g: Geom): string {
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

/** A picture version's name in messages: its key and its deps. */
export function versionName(v: Pick<PictureVersion | PixelsVersion, "kind" | "key" | "deps">): string {
  return `${v.kind} "${v.key}"${v.deps === undefined ? "" : ` ${JSON.stringify(v.deps)}`}`;
}

function shapeLine(n: ShapeNode): string {
  const s = n.style;
  const brush = s.brush === undefined ? "" : ` brush ${s.brush.brush.kind} blend ${s.brush.blend}`;
  const material = s.material === undefined ? "" : ` material ${Object.keys(s.material).join(",")}`;
  const dash = s.dash === undefined ? "" : ` dash ${s.dash.join(",")}`;
  const extra = [s.blend === "normal" ? "" : ` blend ${s.blend}`, s.erase ? " erase" : "", s.effects === undefined ? "" : ` effects ${Object.keys(s.effects).join(",")}`, brush, material, dash].join("");
  return `${n.call} ${geomText(n.geom)} fill ${paintText(s.fill)} stroke ${paintText(s.stroke)}${extra}`;
}

function nodeLine(n: SceneNode): string {
  switch (n.kind) {
    case "shape":
      return shapeLine(n);
    case "background":
      return `background ${paintText(n.paint)}`;
    case "at":
      return `at [${n.matrix.map((v) => Math.round(v * 1000) / 1000).join(", ")}]`;
    case "group": {
      const name = n.name === undefined ? "" : ` "${n.name}"`;
      const fx = n.effects === undefined ? "" : ` effects ${Object.keys(n.effects).join(",")}`;
      const l = n.lighting;
      const lit = l === undefined ? "" : ` lit ambient ${l.ambient} shadows ${l.shadows}${l.exposure === 0 ? "" : ` exposure ${l.exposure}`}${l.toneCurve === 0 ? "" : ` toneCurve ${l.toneCurve}`}`;
      return `group${name} opacity ${n.opacity} blend ${n.blend}${fx}${lit}${n.clip === undefined ? "" : ` clip ${n.clip.length}`}`;
    }
    case "clip":
      return `clip ${n.shapes.length} shape${n.shapes.length === 1 ? "" : "s"}`;
    case "mask":
      return "mask";
    case "text":
      return `text ${JSON.stringify(n.content)} ${n.size}px ${n.family} fill ${paintText(n.fill)}${n.erase ? " erase" : ""}`;
    case "debug":
      return `debugBox "${n.label}" (${r(n.x)},${r(n.y)}) ${r(n.w)}×${r(n.h)}`;
    case "light": {
      const l = n.light;
      return `light ${l.kind} at (${r(l.at[0])},${r(l.at[1])}) height ${r(l.height)} ${l.color} energy ${r(l.energy)}`;
    }
    case "place":
      return `place ${versionName(n.picture)} at (${r(n.x)},${r(n.y)}) opacity ${n.opacity} blend ${n.blend}${n.erase ? " erase" : ""}`;
  }
}

function outlineInto(out: string[], args: { nodes: readonly SceneNode[]; depth: number; versions: Set<PictureVersion | PixelsVersion> }): void {
  const pad = "  ".repeat(args.depth);
  for (const n of args.nodes) {
    out.push(pad + nodeLine(n));
    if (n.kind === "mask") {
      out.push(`${pad}  mask body:`);
      outlineInto(out, { ...args, nodes: n.mask, depth: args.depth + 2 });
      out.push(`${pad}  drawn:`);
      outlineInto(out, { ...args, nodes: n.body, depth: args.depth + 2 });
    } else if (n.kind === "at" || n.kind === "group" || n.kind === "clip") {
      outlineInto(out, { ...args, nodes: n.children, depth: args.depth + 1 });
    } else if (n.kind === "place") {
      args.versions.add(n.picture);
    }
  }
}

/** The scene as an indented outline, one node per line, then the picture versions it places. */
export function sceneOutline(scene: Scene): string {
  const out = [`scene ${scene.width}×${scene.height}`];
  const versions = new Set<PictureVersion | PixelsVersion>();
  outlineInto(out, { nodes: scene.children, depth: 1, versions });
  const done = new Set<PictureVersion | PixelsVersion>();
  for (const v of versions) {
    if (done.has(v)) continue;
    done.add(v);
    out.push(`${versionName(v)} ${r(v.width)}×${r(v.height)}`);
    if (v.kind === "picture") outlineInto(out, { nodes: v.children, depth: 1, versions });
  }
  return out.join("\n");
}
