// Lighting at the call (R8): `group({ lighting })`, `v.light` and
// `style.material`, checked and copied with their defaults filled in, and the
// painterly effects' options (`wash`, `hatching`, `paper`). Colours are parsed
// by the renderer; here a colour must be a non-empty string.
import { SketchUsageError } from "../../core/errors.js";
import type { Vec2 } from "../../core/paint.js";
import type { Effects, Light, Lighting, Material } from "../../scene-draft/scene-api.js";
import type { LightRec, LightingRec, SceneNode } from "../scene.js";
import { MAX_CASTER_HEIGHT } from "../scene.js";

type Range = readonly [number, number];
const UNIT: Range = [0, 1];
const NON_NEGATIVE: Range = [0, Infinity];

function fail(where: string, detail: string): SketchUsageError {
  return new SketchUsageError({ detail: `${where}: ${detail}` });
}

function onlyKeys(value: object, a: { where: string; keys: readonly string[] }): void {
  for (const key of Object.keys(value)) if (!a.keys.includes(key)) throw fail(a.where, `no "${key}" (${a.keys.join(", ")})`);
}

function num(value: unknown, a: { where: string; range: Range }): void {
  const [lo, hi] = a.range;
  if (typeof value === "number" && Number.isFinite(value) && value >= lo && value <= hi) return;
  const want = hi === Infinity ? (lo === -Infinity ? "a finite number" : `a number ≥ ${lo}`) : `a number in ${lo}..${hi}`;
  throw fail(a.where, `must be ${want}, got ${String(value)}`);
}

function optNum(value: unknown, a: { where: string; range: Range }): void {
  if (value !== undefined) num(value, a);
}

function color(value: unknown, where: string): void {
  if (typeof value !== "string" || value.trim() === "") throw fail(where, "must be a CSS colour string");
}

/** `effects.wash`, `effects.hatching` and `effects.paper`, checked. */
export function checkPainterly(effects: Effects): void {
  const { wash, hatching, paper } = effects;
  if (wash !== undefined) {
    onlyKeys(wash, { where: "effects.wash", keys: ["granulate", "edges", "blotch", "bleed"] });
    for (const key of ["granulate", "edges", "blotch"] as const) optNum(wash[key], { where: `effects.wash.${key}`, range: UNIT });
    optNum(wash.bleed, { where: "effects.wash.bleed", range: NON_NEGATIVE });
  }
  if (hatching !== undefined) {
    onlyKeys(hatching, { where: "effects.hatching", keys: ["amount", "angle", "spacing", "color"] });
    num(hatching.amount, { where: "effects.hatching.amount", range: UNIT });
    optNum(hatching.angle, { where: "effects.hatching.angle", range: [-Infinity, Infinity] });
    optNum(hatching.spacing, { where: "effects.hatching.spacing", range: [0.5, Infinity] });
    if (hatching.color !== undefined) color(hatching.color, "effects.hatching.color");
  }
  if (paper !== undefined) num(paper, { where: "effects.paper", range: UNIT });
}

const MATERIAL_KEYS = ["bevel", "relief", "shine", "emissive", "castsShadow"];


/** A material, checked and copied (R8). It is kept even outside a lit group, where the renderer ignores it. */
export function copyMaterial(material: Material | undefined, where: string): Material | undefined {
  if (material === undefined) return undefined;
  const w = `${where} material`;
  if (typeof material !== "object") throw fail(w, "must be an object");
  onlyKeys(material, { where: w, keys: MATERIAL_KEYS });
  optNum(material.bevel, { where: `${w}.bevel`, range: NON_NEGATIVE });
  for (const key of ["relief", "shine", "emissive"] as const) optNum(material[key], { where: `${w}.${key}`, range: UNIT });
  if (material.castsShadow !== undefined && typeof material.castsShadow !== "boolean") optNum(material.castsShadow, { where: `${w}.castsShadow`, range: [0, MAX_CASTER_HEIGHT] });
  return { ...material };
}

/** `group({ lighting })`, checked, with defaults (R8): a dim neutral ambient, soft shadows, exposure 0, no tone curve. */
export function resolveLighting(lighting: Lighting | undefined): LightingRec | undefined {
  if (lighting === undefined) return undefined;
  onlyKeys(lighting, { where: "group lighting", keys: ["ambient", "shadows", "exposure", "toneCurve"] });
  if (lighting.ambient !== undefined) color(lighting.ambient, "group lighting.ambient");
  const shadows = lighting.shadows ?? "soft";
  if (!["none", "hard", "soft"].includes(shadows)) throw fail("group lighting.shadows", `must be none, hard or soft (got ${String(shadows)})`);
  optNum(lighting.exposure, { where: "group lighting.exposure", range: [-16, 16] });
  optNum(lighting.toneCurve, { where: "group lighting.toneCurve", range: UNIT });
  return { ambient: lighting.ambient ?? "#4d4d4d", shadows, exposure: lighting.exposure ?? 0, toneCurve: lighting.toneCurve ?? 0 };
}

const KINDS = new Set(["point", "spot", "directional"]);

function point(at: Vec2 | undefined, kind: string): Vec2 {
  if (at === undefined) {
    if (kind === "directional") return [0, 0];
    throw fail(`light (${kind})`, "needs at: [x, y]");
  }
  const parts: unknown = at;
  if (!Array.isArray(parts) || parts.length !== 2 || !parts.every((v) => typeof v === "number" && Number.isFinite(v))) throw fail("light at", "must be [x, y] with finite numbers");
  return [at[0], at[1]];
}

/**
 * `v.light`, checked, with defaults: height 80, white, energy 1, reach 400,
 * pointing down (+y, π/2), a spot's cone half-angle π/6.
 */
export function resolveLight(light: Light): LightRec {
  if (typeof light !== "object") throw fail("light", "takes { kind, at, height, color, energy, reach, direction, cone }");
  onlyKeys(light, { where: "light", keys: ["kind", "at", "height", "color", "energy", "reach", "direction", "cone"] });
  if (!KINDS.has(light.kind)) throw fail("light kind", `must be point, spot or directional (got ${String(light.kind)})`);
  optNum(light.height, { where: "light height", range: NON_NEGATIVE });
  if (light.color !== undefined) color(light.color, "light color");
  optNum(light.energy, { where: "light energy", range: NON_NEGATIVE });
  optNum(light.reach, { where: "light reach", range: [1e-6, Infinity] });
  optNum(light.direction, { where: "light direction", range: [-Infinity, Infinity] });
  optNum(light.cone, { where: "light cone", range: [1e-6, Math.PI] });
  return {
    kind: light.kind,
    at: point(light.at, light.kind),
    height: light.height ?? 80,
    color: light.color ?? "#ffffff",
    energy: light.energy ?? 1,
    reach: light.reach ?? 400,
    direction: light.direction ?? Math.PI / 2,
    cone: light.cone ?? Math.PI / 6,
  };
}

/** The warning for a light (or a placed picture holding one) where it does nothing (R8). */
export function lightWarning(where: "mask" | "unlit", what: string): string {
  return where === "mask" ? `${what} is inside a mask's artwork and does nothing (R8)` : `${what} is outside any lit group and does nothing (R8); put it inside group({ lighting: {} }, …)`;
}

/** The warning for a lit group with no light inside it (R8). */
export function noLightWarning(name: string | undefined, lighting: LightingRec): string {
  return `lit group${name === undefined ? "" : ` "${name}"`} has no light inside it, so only its ambient (${lighting.ambient}) lights it (R8); add v.light({ kind: "point", at: [x, y] }) inside the group`;
}

/** Whether `nodes` hold a light that would light an enclosing lit group: outside nested lit groups and mask artwork, through placements. */
export function hasOpenLight(nodes: readonly SceneNode[]): boolean {
  return nodes.some((n) => {
    switch (n.kind) {
      case "light":
        return true;
      case "group":
        return n.lighting === undefined && hasOpenLight(n.children);
      case "at":
      case "clip":
        return hasOpenLight(n.children);
      case "mask":
        return hasOpenLight(n.body);
      case "place":
        return n.picture.kind === "picture" && hasOpenLight(n.picture.children);
      case "shape":
      case "background":
      case "text":
      case "debug":
        return false;
    }
  });
}
