// Checks at the call that name the argument at fault: numbers that are not
// finite (a NaN from `undefined` in arithmetic, an Infinity from a division by
// zero) and negative radii, which would otherwise draw nothing or fail later in
// the renderer far from the sketch's line; and colours, parsed as the runtime
// parses them, so a bad colour fails at the call rather than at render.
import { SketchUsageError } from "../../core/errors.js";
import type { Paint, PathCommand, Vec2 } from "../../core/paint.js";
import type { AtOptions, Effects } from "../../scene-draft/scene-api.js";
import type { ColorParser } from "../colors.js";
import type { Geom, SceneNode } from "../scene.js";

const NAN_HINT = " (NaN usually comes from undefined in arithmetic: a model field or param that is not there)";

function bad(call: string, what: { name: string; want: string; got: unknown }): SketchUsageError {
  const hint = typeof what.got === "number" && Number.isNaN(what.got) ? NAN_HINT : "";
  const got = Array.isArray(what.got) ? `[${what.got.map(String).join(", ")}]` : String(what.got);
  return new SketchUsageError({ detail: `${call}: ${what.name} must be ${what.want}, got ${got}${hint}` });
}

const fin = Number.isFinite;

/** Each named argument a finite number; those in `nonNegative` also ≥ 0. The slow path: callers test the numbers directly first. */
export function checkNumbers(call: string, args: { values: Readonly<Record<string, number>>; nonNegative?: readonly string[] }): void {
  for (const [name, v] of Object.entries(args.values)) {
    const positive = args.nonNegative?.includes(name) === true;
    if (typeof v !== "number" || !Number.isFinite(v)) throw bad(call, { name, want: positive ? "a finite number ≥ 0" : "a finite number", got: v });
    if (positive && v < 0) throw bad(call, { name, want: "a finite number ≥ 0", got: v });
  }
}

/** Every point two finite numbers. */
export function checkPoints(call: string, points: readonly Vec2[]): void {
  let i = -1;
  for (const p of points) {
    i++;
    const parts: unknown = p;
    if (!Array.isArray(parts) || parts.length < 2 || !fin(p[0]) || !fin(p[1])) {
      const nan = Array.isArray(parts) && parts.some((v) => typeof v === "number" && Number.isNaN(v));
      throw new SketchUsageError({ detail: `${call}: points[${i}] must be [x, y] with finite numbers, got ${Array.isArray(parts) ? `[${parts.map(String).join(", ")}]` : String(parts)}${nan ? NAN_HINT : ""}` });
    }
  }
}

/** Every number in every path command finite. */
export function checkCommands(call: string, commands: readonly PathCommand[]): void {
  let i = -1;
  for (const c of commands) {
    i++;
    if (commandFinite(c)) continue;
    const nan = c.some((v) => typeof v === "number" && Number.isNaN(v));
    throw new SketchUsageError({ detail: `${call}: command ${i} (${c[0]}) must hold finite numbers, got [${c.map(String).join(", ")}]${nan ? NAN_HINT : ""}` });
  }
}

function commandFinite(c: PathCommand): boolean {
  let first = true;
  for (const v of c) {
    if (!first && !fin(v)) return false;
    first = false;
  }
  return true;
}

/** `line` and `triangle` points, named as their arguments (x1, y1, …). */
function checkNamedPoints(call: string, points: readonly Vec2[]): void {
  let i = 0;
  for (const p of points) {
    i++;
    if (!fin(p[0])) throw bad(call, { name: `x${i}`, want: "a finite number", got: p[0] });
    if (!fin(p[1])) throw bad(call, { name: `y${i}`, want: "a finite number", got: p[1] });
  }
}

/** A shape's geometry, by the names of its call's arguments. The numbers are tested directly; only a bad one builds a message. */
export function checkGeom(call: string, g: Geom): void {
  switch (g.kind) {
    case "rect":
      if (!(fin(g.x) && fin(g.y) && fin(g.w) && fin(g.h))) checkNumbers(call, { values: { x: g.x, y: g.y, w: g.w, h: g.h } });
      return;
    case "ellipse":
      if (fin(g.x) && fin(g.y) && fin(g.rx) && fin(g.ry) && g.rx >= 0 && g.ry >= 0) return;
      if (call === "circle") checkNumbers(call, { values: { x: g.x, y: g.y, radius: g.rx }, nonNegative: ["radius"] });
      else checkNumbers(call, { values: { x: g.x, y: g.y, rx: g.rx, ry: g.ry }, nonNegative: ["rx", "ry"] });
      return;
    case "arc":
      if (!(fin(g.x) && fin(g.y) && fin(g.r) && g.r >= 0 && fin(g.start) && fin(g.end))) checkNumbers(call, { values: { x: g.x, y: g.y, radius: g.r, startAngle: g.start, endAngle: g.end }, nonNegative: ["radius"] });
      return;
    case "poly":
      if (call === "line" || call === "triangle") checkNamedPoints(call, g.points);
      else checkPoints(call, g.points);
      return;
    case "path":
      checkCommands(call, g.commands);
      return;
  }
}

/** `at` options: every number finite (a NaN transform hides everything inside it). */
export function checkAt(at: AtOptions): void {
  const { matrix, translate, rotate, skew, scale } = at;
  const ok = (matrix === undefined || matrix.every(fin)) && (translate === undefined || (fin(translate[0]) && fin(translate[1]))) && (rotate === undefined || fin(rotate))
    && (skew === undefined || (fin(skew[0]) && fin(skew[1]))) && (scale === undefined || (typeof scale === "number" ? fin(scale) : fin(scale[0]) && fin(scale[1])));
  if (ok) return;
  const values: Record<string, number> = {};
  const add = (name: string, v: number | readonly number[] | undefined): void => {
    if (v === undefined) return;
    if (typeof v === "number") values[name] = v;
    else for (const [i, x] of v.entries()) values[`${name}[${i}]`] = x;
  };
  add("matrix", at.matrix);
  add("translate", at.translate);
  add("rotate", at.rotate);
  add("skew", at.skew);
  add("scale", at.scale);
  checkNumbers("at", { values });
}

type Parse = (where: string, css: string) => void;

function paintColours(paint: Paint | undefined, a: { where: string; parse: Parse }): void {
  if (paint === undefined) return;
  if (typeof paint === "string") a.parse(a.where, paint);
  else for (const [i, [, css]] of paint.stops.entries()) a.parse(`${a.where} stop ${i}`, css);
}

function effectColours(effects: Effects | undefined, a: { where: string; parse: Parse }): void {
  if (effects?.glow !== undefined) a.parse(`${a.where} effects.glow.color`, effects.glow.color);
  if (effects?.shadow !== undefined) a.parse(`${a.where} effects.shadow.color`, effects.shadow.color);
  if (effects?.hatching?.color !== undefined) a.parse(`${a.where} effects.hatching.color`, effects.hatching.color);
}

/** Every colour a node holds (not its children), parsed; the first that does not parse is an error naming the call and the field. */
export function checkColours(node: SceneNode, colors: ColorParser): void {
  const parse: Parse = (where, css) => {
    try {
      colors(css);
    } catch (error) {
      if (!(error instanceof SketchUsageError)) throw error;
      throw new SketchUsageError({ detail: `${where} "${css}" is not a CSS colour (for example "#2a9d8f", "rgba(42,157,143,0.5)" or "teal")` });
    }
  };
  switch (node.kind) {
    case "shape":
      paintColours(node.style.fill, { where: `${node.call} fill`, parse });
      paintColours(node.style.stroke, { where: `${node.call} stroke`, parse });
      effectColours(node.style.effects, { where: node.call, parse });
      return;
    case "background":
      paintColours(node.paint, { where: "background", parse });
      return;
    case "text":
      paintColours(node.fill, { where: "text fill", parse });
      paintColours(node.halo?.paint, { where: "text halo", parse });
      return;
    case "light":
      parse("light color", node.light.color);
      return;
    case "group": {
      const where = node.name === undefined ? "group" : `group "${node.name}"`;
      effectColours(node.effects, { where, parse });
      if (node.lighting !== undefined) parse(`${where} lighting.ambient`, node.lighting.ambient);
      return;
    }
    case "at":
    case "clip":
    case "mask":
    case "place":
    case "debug":
      return;
  }
}
