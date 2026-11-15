// Brush expansion on the GPU (canvas-loop-gpu-brushes.subplan.md). The
// `samples` entry places one sample per thread by the contour contract: the
// CPU fixed every contour's sample count and offsets (brush-pass.ts), so a
// thread finds its contour by a binary search over the offsets, places sample
// k at k × step (the last at the contour's end point; a one-sample contour at
// its start), finds its segment by a binary search over the integer index of
// each segment's first sample (fixed on the CPU by resample's loop, so a sample
// at a corner takes the CPU's segment and normal),
// and adds pressure and wobble as core/brush/render/mark/render.ts's
// `shapeSamples` does. Hashes are core/brush/random.ts's, bit for bit; a random
// value keeps the hash's 24 high bits, which f32 holds exactly. Positions are
// brush space, as the CPU expansion's. The `dabs` entry (its own module, below)
// turns each sample of a stamp stroke into one dab instance in device pixels.
import { POINT_WORDS } from "../scene/brush/expand.js";
import { MIX_WGSL } from "./shader-paper.js";

/** Words in the records buffer's header, and per contour record (u32; floats bitcast). */
export const RECORD_HEAD = 4;
export const CONTOUR_WORDS = 16;
/** Floats per sample: x, y, nx, ny, s, t, p, and its contour's index (u32). */
export const SAMPLE_FLOATS = 8;
export const SAMPLES_WORKGROUP = 64;

/** Pressure envelope kinds in a contour record; keyframes are pairs of (t, value) in the records buffer. */
export const ENVELOPE_KINDS = { constant: 0, even: 1, taper: 2, "taper-in": 3, "taper-out": 4, swell: 5, press: 6, keyframes: 7 } as const;

/** Words per stamp stroke record (the `dabs` entry's parameters), and floats per dab instance (mark-atlas.ts's layout). */
export const STROKE_WORDS = 24;
export const DAB_FLOATS = 12;

// What both entries share: the uniform, the sample, the records and the hash.
const PRELUDE = /* wgsl */ `
${MIX_WGSL}
struct U { first: u32, count: u32, contours: u32, pad: u32 };
struct Sample { x: f32, y: f32, nx: f32, ny: f32, s: f32, t: f32, p: f32, contour: u32 };
@group(0) @binding(0) var<storage, read> rec: array<u32>;
@group(0) @binding(4) var<uniform> u: U;
fn cw(c: u32, w: u32) -> u32 { return rec[${RECORD_HEAD}u + c * ${CONTOUR_WORDS}u + w]; }
fn cf(c: u32, w: u32) -> f32 { return bitcast<f32>(cw(c, w)); }
// random.ts \`rand\`: the same hash; its 24 high bits, converted exactly.
fn rand1(seed: u32, ch: u32, idx: u32) -> f32 {
  return f32(mix32(seed ^ mix32(ch * 0x9e3779b1u + mix32(idx))) >> 8u) / 16777216.0;
}
`;

export const SAMPLES_WGSL = /* wgsl */ `
${PRELUDE}
@group(0) @binding(1) var<storage, read> geo: array<u32>;
@group(0) @binding(2) var<storage, read_write> out: array<Sample>;
const PW = ${POINT_WORDS}u;
fn pt(i: u32) -> vec2f { return vec2f(bitcast<f32>(geo[PW * i]), bitcast<f32>(geo[PW * i + 1u])); }
fn arc(i: u32) -> f32 { return bitcast<f32>(geo[PW * i + 2u]); }
fn firstOn(i: u32) -> u32 { return geo[PW * i + 3u]; }

// random.ts \`noiseOf(1, period)\` at x ≥ 0; period 0 does not wrap.
fn noise1(seed: u32, x: f32, period: u32) -> f32 {
  let i = floor(x);
  let f = x - i;
  var k0 = u32(i);
  var k1 = k0 + 1u;
  if (period > 0u) { k0 = k0 % period; k1 = k1 % period; }
  let a = rand1(seed, 1u, k0);
  let b = rand1(seed, 1u, k1);
  let s = f * f * (3.0 - 2.0 * f);
  return (a + (b - a) * s) * 2.0 - 1.0;
}

// envelope.ts: the presets, and keyframes with smoothstep between them.
fn ease(x: f32) -> f32 {
  let c = clamp(x, 0.0, 1.0);
  return 0.06 + 0.94 * (1.0 - (1.0 - c) * (1.0 - c));
}
fn keyframes(at: u32, n: u32, t: f32) -> f32 {
  var bt = 0.0;
  var bv = 1.0;
  for (var i = 0u; i < n; i++) {
    let ft = bitcast<f32>(rec[at + 2u * i]);
    let fv = bitcast<f32>(rec[at + 2u * i + 1u]);
    if (ft > t) {
      if (i == 0u) { return fv; }
      let span = ft - bt;
      let f = select((t - bt) / span, 1.0, span <= 0.0);
      return bv + (fv - bv) * (f * f * (3.0 - 2.0 * f));
    }
    bt = ft;
    bv = fv;
  }
  return bv;
}
fn pressure(c: u32, t: f32) -> f32 {
  var v = 1.0;
  switch cw(c, 10u) {
    case 0u: { v = cf(c, 11u); }
    case 2u: { v = min(ease(t / 0.25), ease((1.0 - t) / 0.3)); }
    case 3u: { v = ease(t / 0.3); }
    case 4u: { v = ease((1.0 - t) / 0.35); }
    case 5u: { v = 0.35 + 0.65 * sin(3.141592653589793 * t); }
    case 6u: { v = 1.0 - 0.55 * t; }
    case 7u: { v = keyframes(cw(c, 11u), cw(c, 12u), t); }
    default: {}
  }
  return clamp(v, 0.0, 1.0);
}

// Contour record words: 0 first point, 1 points, 2 first sample, 3 samples,
// 4 seed, 5 step, 6 arc length, 7 wobble cell, 8 wobble period (0: open),
// 9 wobble, 10 envelope kind, 11 its value or keyframe word, 12 keyframes,
// 13 the stroke's record word (stamp strokes; read by \`dabs\`).
@compute @workgroup_size(${SAMPLES_WORKGROUP}) fn samples(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= u.count) { return; }
  let i = u.first + gid.x;
  var lo = 0u;
  var hi = u.contours - 1u;
  while (lo < hi) {
    let mid = (lo + hi + 1u) / 2u;
    if (cw(mid, 2u) <= i) { lo = mid; } else { hi = mid - 1u; }
  }
  let c = lo;
  let k = i - cw(c, 2u);
  let n = cw(c, 3u);
  let p0 = cw(c, 0u);
  let np = cw(c, 1u);
  var pos = pt(p0);
  var nrm = vec2f(0.0, -1.0);
  var s = 0.0;
  var t = 0.0;
  if (n > 1u) {
    let total = cf(c, 6u);
    let last = k + 1u == n;
    s = select(f32(k) * cf(c, 5u), total, last);
    // The last segment whose first sample is at or before k.
    var seg = 0u;
    var hi = np - 2u;
    while (seg < hi) {
      let m = (seg + hi + 1u) / 2u;
      if (firstOn(p0 + m) <= k) { seg = m; } else { hi = m - 1u; }
    }
    let pa = pt(p0 + seg);
    let d = pt(p0 + seg + 1u) - pa;
    let len = length(d);
    let f = select(0.0, clamp((s - arc(p0 + seg)) / len, 0.0, 1.0), len > 0.0);
    pos = select(pa + d * f, pt(p0 + np - 1u), last);
    let dir = select(vec2f(1.0, 0.0), d / len, len > 0.0);
    nrm = vec2f(dir.y, -dir.x);
    t = s / total;
  }
  let p = pressure(c, t);
  let wobble = cf(c, 9u);
  if (wobble > 0.0) {
    pos += nrm * (wobble * noise1(cw(c, 4u), s / cf(c, 7u), cw(c, 8u)));
  }
  out[i] = Sample(pos.x, pos.y, nrm.x, nrm.y, s, t, p, c);
}
`;

// colour.ts `shiftColour`: hue and HSL lightness shifted, channels rounded to 0..255.
const COLOUR_WGSL = /* wgsl */ `
fn toHsl(c: vec3f) -> vec3f {
  let mx = max(c.r, max(c.g, c.b));
  let mn = min(c.r, min(c.g, c.b));
  let l = (mx + mn) / 2.0;
  let d = mx - mn;
  if (d == 0.0) { return vec3f(0.0, 0.0, l); }
  let s = d / (1.0 - abs(2.0 * l - 1.0));
  var h: f32;
  if (mx == c.r) { h = ((c.g - c.b) / d) % 6.0; } else if (mx == c.g) { h = (c.b - c.r) / d + 2.0; } else { h = (c.r - c.g) / d + 4.0; }
  return vec3f((h * 60.0 + 360.0) % 360.0, s, l);
}
fn fromHsl(hsl: vec3f) -> vec3f {
  let h = hsl.x;
  let c = (1.0 - abs(2.0 * hsl.z - 1.0)) * hsl.y;
  let x = c * (1.0 - abs((h / 60.0) % 2.0 - 1.0));
  let m = hsl.z - c / 2.0;
  var v = vec3f(0.0);
  switch (u32(floor(h / 60.0)) % 6u) {
    case 0u: { v = vec3f(c, x, 0.0); }
    case 1u: { v = vec3f(x, c, 0.0); }
    case 2u: { v = vec3f(0.0, c, x); }
    case 3u: { v = vec3f(0.0, x, c); }
    case 4u: { v = vec3f(x, 0.0, c); }
    default: { v = vec3f(c, 0.0, x); }
  }
  return floor((v + m) * 255.0 + 0.5);
}
fn shiftColour(base: vec3f, hue: f32, light: f32) -> vec3f {
  let hsl = toHsl(base / 255.0);
  return fromHsl(vec3f((((hsl.x + hue) % 360.0) + 360.0) % 360.0, hsl.y, clamp(hsl.z + light, 0.0, 1.0)));
}
`;

// The `dabs` entry: kinds.ts `paintStamp` for sample i, written as dab instance i
// (mark-atlas.ts's layout: x, y, radius, alpha; soft, r, g, b; the slot) in the
// mark's own device pixels. A dab paintStamp skips is written with alpha 0.
// Stroke record words: 0-3 brush space → device (linear), 4-5 the offset to
// the mark's own pixels, 6-9 the slot, 10 width (brush space), 11 pixel ratio,
// 12 sizeJitter, 13 sizeByPressure, 14 flow, 15 opacityByPressure, 16 scatter,
// 17 soft, 18 hueJitter, 19 lightJitter, 20-22 the base colour (0..255), 23 jittered.
export const DABS_WGSL = /* wgsl */ `
${PRELUDE}
${COLOUR_WGSL}
@group(0) @binding(2) var<storage, read> smp: array<Sample>;
@group(0) @binding(3) var<storage, read_write> dab: array<f32>;
fn sf(st: u32, w: u32) -> f32 { return bitcast<f32>(rec[st + w]); }
fn sv(st: u32, w: u32) -> vec4f { return vec4f(sf(st, w), sf(st, w + 1u), sf(st, w + 2u), sf(st, w + 3u)); }

@compute @workgroup_size(${SAMPLES_WORKGROUP}) fn dabs(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= u.count) { return; }
  let i = u.first + gid.x;
  let s = smp[i];
  let c = s.contour;
  let st = cw(c, 13u);
  let k = i - cw(c, 2u);
  let seed = cw(c, 4u);
  let width = sf(st, 10u);
  let jitter = 1.0 + sf(st, 12u) * (rand1(seed, 11u, k) - 0.5);
  let radius = (width / 2.0) * (1.0 - sf(st, 13u) * (1.0 - s.p)) * jitter;
  let alpha = sf(st, 14u) * (1.0 - sf(st, 15u) * (1.0 - s.p));
  let off = sf(st, 16u) * width * (rand1(seed, 12u, k) - 0.5);
  let q = vec2f(s.x + s.nx * off, s.y + s.ny * off);
  let e = sv(st, 0u);
  let at = vec2f(e.x * q.x + e.z * q.y, e.y * q.x + e.w * q.y) + vec2f(sf(st, 4u), sf(st, 5u));
  var rgb = vec3f(0.0);
  if (sf(st, 23u) > 0.5) {
    let hue = sf(st, 18u) * (2.0 * rand1(seed, 13u, k) - 1.0);
    let light = sf(st, 19u) * (2.0 * rand1(seed, 14u, k) - 1.0);
    rgb = shiftColour(vec3f(sf(st, 20u), sf(st, 21u), sf(st, 22u)), hue, light) / 255.0;
  }
  let shown = radius > 0.05 && alpha > 0.0;
  let o = i * ${DAB_FLOATS}u;
  let slot = sv(st, 6u);
  dab[o] = at.x; dab[o + 1u] = at.y;
  dab[o + 2u] = select(0.0, radius * sf(st, 11u), shown);
  dab[o + 3u] = select(0.0, alpha, shown);
  dab[o + 4u] = sf(st, 17u);
  dab[o + 5u] = rgb.r; dab[o + 6u] = rgb.g; dab[o + 7u] = rgb.b;
  dab[o + 8u] = slot.x; dab[o + 9u] = slot.y; dab[o + 10u] = slot.z; dab[o + 11u] = slot.w;
}
`;
