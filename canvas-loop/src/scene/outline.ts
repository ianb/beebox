// The scene as an indented outline (`run --scene`): one node per line, then
// each picture version the frame placed, once, with its body. Also the name a
// node takes in an error's node path (`nodeName`).
//
// A light's line says how bright it makes the floor at its brightest (drawing-
// round finding 3): its added term in the lit group's sum (shader-light.ts
// `light`) on a flat matte floor, where it peaks: below a point light, beside a
// spot on its beam (`peakPlace`): energy × the window at height ÷ reach; a
// directional light adds the same everywhere: energy × its slope's cosine.
// With the lit group's ambient, exposure and tone curve, it also gives what a
// white floor shows there, ambient alone and with this light.
import type { Paint } from "../core/paint.js";
import type { ColorParser } from "./colors.js";
import type { Geom, LightRec, LightingRec, PictureVersion, PixelsVersion, Scene, SceneNode, ShapeNode } from "./nodes.js";

const r = (n: number): string => String(Math.round(n * 100) / 100);

const r2 = (n: number): string => n.toFixed(2);
const lum = (c: readonly number[]): number => 0.2126 * (c[0] ?? 0) + 0.7152 * (c[1] ?? 0) + 0.0722 * (c[2] ?? 0);

/** shader-light.ts `tone`: from a clip at white toward a film curve (strength `k`). */
function tone(x: number, k: number): number {
  const p = 1.4;
  const m = 0.6 ** p;
  const w = 4 ** p;
  const v = Math.max(x, 0) ** p;
  return (1 - k) * Math.min(x, 1) + k * Math.min(1, ((v / (v + m)) * (w + m)) / w);
}

/** Linear light to an sRGB value 0..1. */
function toSrgb(x: number): number {
  const c = Math.min(Math.max(x, 0), 1);
  return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
}

/** The light's peak added term on a flat floor, per unit of its colour. */
function peakOf(l: LightRec): number {
  if (l.kind === "directional") {
    const slope = l.height / 100;
    return l.energy * (slope / Math.hypot(1, slope));
  }
  const x = l.height / l.reach;
  const win = Math.min(Math.max(1 - x ** 4, 0), 1);
  return (l.energy * win * win) / (1 + 6 * x * x);
}

/**
 * Where the light peaks on the floor, in words. A point light peaks right below it. A spot's cone is an angle
 * around its direction in the plane: along that direction the cone lets all of it through, so it peaks just
 * beside the light on its beam (the same value as a point light's), and behind the light it adds nothing.
 */
function peakPlace(l: LightRec): string {
  if (l.kind === "directional") return "everywhere";
  const at = `(${r(l.at[0])},${r(l.at[1])})`;
  if (l.kind === "point" || l.cone >= Math.PI) return `below ${at}`;
  return `beside ${at} on its beam, toward ${r(l.direction)} rad`;
}

/** ` peak +X` where it peaks and, inside a known lit group, what a white floor there shows. */
function peakText(l: LightRec, a: { colors: ColorParser | undefined; lighting: LightingRec | undefined }): string {
  if (a.colors === undefined) return "";
  const c = a.colors(l.color);
  const added = peakOf(l) * lum(c) * c[3];
  const head = ` peak +${r2(added)} ${peakPlace(l)}`;
  if (a.lighting === undefined) return head;
  const amb = a.colors(a.lighting.ambient);
  const base = lum(amb) * amb[3];
  const k = a.lighting.toneCurve;
  const exp = 2 ** a.lighting.exposure;
  const before = toSrgb(tone(base * exp, k));
  const after = toSrgb(tone((base + added) * exp, k));
  return `${head}, over ambient ${r2(base)} (a white floor there: ${r2(before)} → ${r2(after)})`;
}

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

/** What a light line needs to say how bright the light is: the colour parser and the lit group around it, if known. */
interface LightContext {
  readonly colors: ColorParser | undefined;
  readonly lighting: LightingRec | undefined;
}

function nodeLine(n: SceneNode, cx: LightContext): string {
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
      return `light ${l.kind} at (${r(l.at[0])},${r(l.at[1])}) height ${r(l.height)} ${l.color} energy ${r(l.energy)}${peakText(l, cx)}`;
    }
    case "place":
      return `place ${versionName(n.picture)} at (${r(n.x)},${r(n.y)}) opacity ${n.opacity} blend ${n.blend}${n.erase ? " erase" : ""}`;
  }
}

function outlineInto(out: string[], args: { nodes: readonly SceneNode[]; depth: number; versions: Set<PictureVersion | PixelsVersion>; cx: LightContext }): void {
  const pad = "  ".repeat(args.depth);
  for (const n of args.nodes) {
    out.push(pad + nodeLine(n, args.cx));
    if (n.kind === "mask") {
      out.push(`${pad}  mask body:`);
      outlineInto(out, { ...args, nodes: n.mask, depth: args.depth + 2 });
      out.push(`${pad}  drawn:`);
      outlineInto(out, { ...args, nodes: n.body, depth: args.depth + 2 });
    } else if (n.kind === "at" || n.kind === "clip") {
      outlineInto(out, { ...args, nodes: n.children, depth: args.depth + 1 });
    } else if (n.kind === "group") {
      outlineInto(out, { ...args, nodes: n.children, depth: args.depth + 1, cx: n.lighting === undefined ? args.cx : { ...args.cx, lighting: n.lighting } });
    } else if (n.kind === "place") {
      args.versions.add(n.picture);
    }
  }
}

/**
 * The scene as an indented outline, one node per line, then the picture versions it places. With `colors`, each
 * light says how much it adds where it peaks and, inside a lit group, what a white floor there shows.
 */
export function sceneOutline(scene: Scene, colors?: ColorParser): string {
  const out = [`scene ${scene.width}×${scene.height}`];
  const versions = new Set<PictureVersion | PixelsVersion>();
  outlineInto(out, { nodes: scene.children, depth: 1, versions, cx: { colors, lighting: undefined } });
  const done = new Set<PictureVersion | PixelsVersion>();
  for (const v of versions) {
    if (done.has(v)) continue;
    done.add(v);
    out.push(`${versionName(v)} ${r(v.width)}×${r(v.height)}`);
    if (v.kind === "picture") outlineInto(out, { nodes: v.children, depth: 1, versions, cx: { colors, lighting: undefined } });
  }
  return out.join("\n");
}

/** A node's name in a path: its group name or picture key when it has one, else its call and place among its siblings (1-based). */
export function nodeName(n: SceneNode, index: number): string {
  switch (n.kind) {
    case "group":
      return n.name === undefined ? `group #${index}` : `group ${JSON.stringify(n.name)}`;
    case "place":
      return `place ${n.picture.kind} ${JSON.stringify(n.picture.key)}`;
    case "shape":
      return `${n.call} #${index}`;
    case "background":
    case "at":
    case "clip":
    case "mask":
    case "text":
    case "debug":
    case "light":
      return `${n.kind} #${index}`;
  }
}
