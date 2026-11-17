// CSS colours as numbers, parsed the way the runtime's 2D canvas parses them:
// set `fillStyle` and read back the normalised `#rrggbb` or `rgba(…)` (both
// runtimes normalise). `oklch()`, `oklab()` and `color-mix()` are parsed here
// instead, so both runtimes read them alike: a 2D context in one runtime reads
// them back as `oklch(…)` and in another refuses them. Colours outside sRGB
// keep their lightness and hue and lose chroma until they fit (CSS Color 4's
// gamut mapping, without its tolerance).
import type { Ctx2D } from "../core/ctx2d.js";
import { SketchUsageError } from "../core/errors.js";

/** Red, green, blue, alpha in 0..1, unpremultiplied. */
export type Rgba = readonly [number, number, number, number];

/** Parses a CSS colour string; throws for one the runtime does not know. */
export type ColorParser = (css: string) => Rgba;

// ── Perceptual colours ──

type Lab = readonly [number, number, number];

/** sRGB 0..1 per channel, gamma encoded, from linear light. */
function encode(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
}

function decode(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** OKLab to gamma-encoded sRGB, unclipped. */
function labToRgb([L, a, b]: Lab): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    encode(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    encode(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    encode(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

function rgbToLab([r, g, b]: readonly number[]): Lab {
  const [lr, lg, lb] = [decode(r ?? 0), decode(g ?? 0), decode(b ?? 0)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363288629 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

const inGamut = (rgb: readonly number[]): boolean => rgb.every((c) => c >= -1e-4 && c <= 1 + 1e-4);
const clip = (c: number): number => Math.min(1, Math.max(0, c));

/** OKLab to sRGB in 0..1: lightness clamped to 0..1 (black or white at the ends), then chroma reduced by bisection until it fits. */
function fit(lab: Lab, alpha: number): Rgba {
  const L = clip(lab[0]);
  if (L === 0 || L === 1) return [L, L, L, clip(alpha)];
  const direct = labToRgb([L, lab[1], lab[2]]);
  if (inGamut(direct)) return [clip(direct[0]), clip(direct[1]), clip(direct[2]), clip(alpha)];
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 20; i++) {
    const k = (lo + hi) / 2;
    if (inGamut(labToRgb([L, lab[1] * k, lab[2] * k]))) lo = k;
    else hi = k;
  }
  const rgb = labToRgb([L, lab[1] * lo, lab[2] * lo]);
  return [clip(rgb[0]), clip(rgb[1]), clip(rgb[2]), clip(alpha)];
}

/** A CSS number, or a percentage of `full` (`50%` of 0.4 is 0.2); undefined when it is neither. */
function amount(text: string | undefined, full: number): number | undefined {
  if (text === undefined) return undefined;
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(%?)$/i.exec(text);
  if (m === null) return undefined;
  const n = Number(m[1]);
  return m[2] === "%" ? (n / 100) * full : n;
}

/** A hue in degrees: a number, or `deg`, `rad`, `grad` or `turn`. */
function hue(text: string | undefined): number | undefined {
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(deg|rad|grad|turn)?$/i.exec(text ?? "");
  if (m === null) return undefined;
  const n = Number(m[1]);
  const unit = (m[2] ?? "deg").toLowerCase();
  return unit === "rad" ? (n * 180) / Math.PI : unit === "grad" ? n * 0.9 : unit === "turn" ? n * 360 : n;
}

/** `L C H [/ A]` or `L a b [/ A]`: three channel tokens and an alpha (1 when not given). */
function channels(body: string): { parts: string[]; alpha: number } | undefined {
  const [main, alphaText, extra] = body.split("/").map((s) => s.trim());
  if (extra !== undefined || main === undefined) return undefined;
  const parts = main.split(/\s+/);
  const alpha = alphaText === undefined ? 1 : amount(alphaText, 1);
  return parts.length === 3 && alpha !== undefined ? { parts, alpha } : undefined;
}

function lchToLab([L, C, h]: readonly [number, number, number]): Lab {
  const r = (h * Math.PI) / 180;
  return [L, Math.max(0, C) * Math.cos(r), Math.max(0, C) * Math.sin(r)];
}

/** `oklch(…)` or `oklab(…)` as OKLab and alpha, or undefined when malformed. */
function parseOk(fn: string, body: string): { lab: Lab; alpha: number } | undefined {
  const c = channels(body);
  if (c === undefined) return undefined;
  const L = amount(c.parts[0], 1);
  if (fn === "oklch") {
    const C = amount(c.parts[1], 0.4);
    const h = hue(c.parts[2]);
    return L === undefined || C === undefined || h === undefined ? undefined : { lab: lchToLab([L, C, h]), alpha: c.alpha };
  }
  const a = amount(c.parts[1], 0.4);
  const b = amount(c.parts[2], 0.4);
  return L === undefined || a === undefined || b === undefined ? undefined : { lab: [L, a, b], alpha: c.alpha };
}

/** Split at commas outside parentheses. */
function topLevel(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) {
      out.push(body.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(body.slice(start).trim());
  return out;
}

/** A `color-mix` operand: a colour and its optional percentage, at either end. */
function operand(text: string, parse: (css: string) => Rgba): { color: Rgba; share: number | undefined } {
  const m = /^(.*?)\s+([\d.]+%)$/.exec(text) ?? /^([\d.]+%)\s+(.*)$/.exec(text);
  if (m === null) return { color: parse(text), share: undefined };
  const [colorText, share] = (m[2] ?? "").endsWith("%") ? [m[1] ?? "", m[2] ?? ""] : [m[2] ?? "", m[1] ?? ""];
  return { color: parse(colorText), share: amount(share, 1) };
}

const SPACES = ["oklab", "oklch", "srgb"] as const;

/** The mix of two colours in `space` at `t` of the way to `b`, alpha premultiplied as CSS mixes. */
function mixIn(space: (typeof SPACES)[number], at: { a: Rgba; b: Rgba; t: number }): Rgba {
  const { a, b, t } = at;
  const alpha = a[3] + (b[3] - a[3]) * t;
  const lerp = (x: number, y: number): number => (alpha === 0 ? x + (y - x) * t : (x * a[3] + (y * b[3] - x * a[3]) * t) / alpha);
  if (space === "srgb") return [lerp(a[0], b[0]), lerp(a[1], b[1]), lerp(a[2], b[2]), alpha];
  const la = rgbToLab(a);
  const lb = rgbToLab(b);
  if (space === "oklab") return fit([lerp(la[0], lb[0]), lerp(la[1], lb[1]), lerp(la[2], lb[2])], alpha);
  // OKLCH: the shorter way round the hue circle; a grey takes the other colour's hue.
  const polar = (l: Lab): [number, number, number] => [l[0], Math.hypot(l[1], l[2]), (Math.atan2(l[2], l[1]) * 180) / Math.PI];
  const [pa, pb] = [polar(la), polar(lb)];
  const ha = pa[1] < 1e-4 ? pb[2] : pa[2];
  const hb = pb[1] < 1e-4 ? ha : pb[2];
  const dh = ((((hb - ha) % 360) + 540) % 360) - 180;
  return fit(lchToLab([lerp(pa[0], pb[0]), lerp(pa[1], pb[1]), ha + dh * t]), alpha);
}

/** `color-mix(in <space>, a [p%], b [q%])`, with CSS's percentage rules; undefined when malformed. */
function parseMix(body: string, parse: (css: string) => Rgba): Rgba | undefined {
  const [head, first, second, extra] = topLevel(body);
  const space = /^in\s+(\w+)$/i.exec(head ?? "")?.[1]?.toLowerCase();
  const known = SPACES.find((s) => s === space);
  if (known === undefined || first === undefined || second === undefined || extra !== undefined) return undefined;
  const a = operand(first, parse);
  const b = operand(second, parse);
  const p = a.share ?? (b.share === undefined ? 0.5 : 1 - b.share);
  const q = b.share ?? 1 - p;
  const sum = p + q;
  if (!(sum > 0) || p < 0 || q < 0) return undefined;
  const mixed = mixIn(known, { a: a.color, b: b.color, t: q / sum });
  return sum < 1 ? [mixed[0], mixed[1], mixed[2], mixed[3] * sum] : mixed;
}

/**
 * A colour in the syntax canvas-loop parses itself, or undefined when `css`
 * is not one (the 2D context parses the rest). Throws `bad` for a malformed
 * one, so a typo is named rather than handed on.
 */
export function parsePerceptual(css: string, a: { parse: (css: string) => Rgba; bad: () => Error }): Rgba | undefined {
  const m = /^\s*(oklch|oklab|color-mix)\(\s*(.*)\)\s*$/is.exec(css);
  if (m === null) return undefined;
  const fn = (m[1] ?? "").toLowerCase();
  const body = m[2] ?? "";
  if (fn === "color-mix") {
    const mixed = parseMix(body, a.parse);
    if (mixed === undefined) throw a.bad();
    return mixed;
  }
  const ok = parseOk(fn, body);
  if (ok === undefined) throw a.bad();
  return fit(ok.lab, ok.alpha);
}

// ── The runtime's 2D context ──

// Two sentinels: a colour the context rejects leaves `fillStyle` at whichever was set before.
const SENTINELS = ["#010203", "#040506"] as const;

function parseWith(ctx: Ctx2D, css: string): Rgba {
  const own = parsePerceptual(css, { parse: (inner) => parseWith(ctx, inner), bad: () => new SketchUsageError({ detail: `"${css}" is not a CSS colour` }) });
  if (own !== undefined) return own;
  const seen = SENTINELS.map((s) => {
    ctx.fillStyle = s;
    ctx.fillStyle = css;
    return ctx.fillStyle;
  });
  const text = typeof seen[0] === "string" && seen[0] === seen[1] ? seen[0] : "";
  const hex = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(text);
  if (hex !== null) return [parseInt(hex[1] ?? "0", 16) / 255, parseInt(hex[2] ?? "0", 16) / 255, parseInt(hex[3] ?? "0", 16) / 255, 1];
  const rgba = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?\s*\)$/.exec(text);
  if (rgba !== null) return [Number(rgba[1]) / 255, Number(rgba[2]) / 255, Number(rgba[3]) / 255, rgba[4] === undefined ? 1 : Number(rgba[4])];
  throw new SketchUsageError({ detail: `"${css}" is not a CSS colour` });
}

/** A parser over `ctx` that remembers each answer: sketches repeat a few colours many times. */
export function colorsFrom(ctx: Ctx2D): ColorParser {
  const seen = new Map<string, Rgba>();
  return (css) => {
    const hit = seen.get(css);
    if (hit !== undefined) return hit;
    const c = parseWith(ctx, css);
    seen.set(css, c);
    return c;
  };
}
