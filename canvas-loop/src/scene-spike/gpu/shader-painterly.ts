// WGSL for the painterly effects (R5 step 2: wash, hatching, paper), each one
// quad over a layer's valid region. Patterns live in the coordinates where the
// group is called (`toLocal`), so pigment and lines move, turn and scale with
// the group (draft section 4). All noise is the paper's 32-bit integer hash.
// - wash (Bousseau et al. 2006): read through a bleed displacement, pull the
//   colour a little toward its blur, then the density model
//   C' = C − (C − C²)(d − 1), with d from blotches, paper granulation (the
//   scope's paper) and edge darkening (|layer − blur|).
// - hatching (after Praun et al. 2001, tonal art maps): tone is the blurred
//   layer's luminance, normalised by the group's own tone range (a histogram
//   pass). Lines come in three families; each line has its own tone threshold,
//   so lines appear one by one as tone darkens (light bare, mid single hatch,
//   dark cross-hatch). Lines are drawn in patches, like hand hatching: each
//   patch has its own small angle and spacing change and phase, and each line
//   in it is a stroke with tapered ends, wobble, breaks and pencil grain.
// - paper: colour darkened in the paper's valleys, alpha unchanged (decision 4).
import { PAPER_WGSL } from "./shader-paper.js";

export const PAINTERLY_WGSL = /* wgsl */ `
struct P {
  size: vec4f,     // the target texture's size
  region: vec4f,   // valid texels: x, y, w, h
  tl0: vec4f,      // texel position -> local: a, b, c, d
  tl1: vec4f,      // e, f, pixel ratio, local units per device pixel
  ld: vec4f,       // local -> texel, linear part: a, b, c, d
  wash: vec4f,     // granulate, edges, blotch, bleed (local units)
  hatch: vec4f,    // amount, angle, spacing (local units), has a colour
  ink: vec4f,      // hatching colour, straight alpha
  paper: vec4f,    // effects.paper amount; paper scale, lo, hi (paper pixels)
  ids: vec4u,      // paper seed, paper row width
};
@group(0) @binding(0) var<uniform> pu: P;
@group(0) @binding(1) var srcT: texture_2d<f32>;
@group(0) @binding(2) var auxT: texture_2d<f32>;
@group(0) @binding(3) var<storage, read> tone: array<u32, 66>;

struct VOut { @builtin(position) pos: vec4f };
@vertex fn vs(@builtin(vertex_index) vi: u32) -> VOut {
  var c = array(vec2f(0,0), vec2f(1,0), vec2f(0,1), vec2f(0,1), vec2f(1,0), vec2f(1,1));
  let p = (pu.region.xy + c[vi] * pu.region.zw) / pu.size.xy;
  var o: VOut; o.pos = vec4f(p.x * 2 - 1, 1 - p.y * 2, 0, 1); return o;
}
fn at(t: texture_2d<f32>, p: vec2i) -> vec4f {
  let q = vec2f(p) - pu.region.xy;
  if (q.x < 0 || q.y < 0 || q.x >= pu.region.z || q.y >= pu.region.w) { return vec4f(0); }
  return textureLoad(t, p, 0);
}
// Bilinear at texel position x (texel centres at half-integers); outside the region transparent.
fn smp(t: texture_2d<f32>, x: vec2f) -> vec4f {
  let g = x - 0.5; let i = floor(g); let f = g - i; let q = vec2i(i);
  return mix(mix(at(t, q), at(t, q + vec2i(1, 0)), f.x), mix(at(t, q + vec2i(0, 1)), at(t, q + vec2i(1, 1)), f.x), f.y);
}
fn toLocal(x: vec2f) -> vec2f { return vec2f(pu.tl0.x * x.x + pu.tl0.z * x.y + pu.tl1.x, pu.tl0.y * x.x + pu.tl0.w * x.y + pu.tl1.y); }
fn toTexel(d: vec2f) -> vec2f { return vec2f(pu.ld.x * d.x + pu.ld.z * d.y, pu.ld.y * d.x + pu.ld.w * d.y); }
fn paperPx(q: vec2f) -> vec2i { return vec2i(floor(q * pu.tl1.z)); }
fn lum(c: vec3f) -> f32 { return dot(c, vec3f(0.2126, 0.7152, 0.0722)); }
${PAPER_WGSL}

@fragment fn wash(i: VOut) -> @location(0) vec4f {
  let x = floor(i.pos.xy) + 0.5;
  let q = toLocal(x);
  let seed = pu.ids.x;
  var y = x;
  let bleed = pu.wash.w;
  if (bleed > 0) {
    let per = max(10.0, 5.0 * bleed);
    let d = vec2f(noise2(seed, 21u, q / per), noise2(seed, 22u, q / per)) * 2.0 - 1.0
          + 0.35 * (vec2f(noise2(seed, 23u, q / (0.4 * per)), noise2(seed, 24u, q / (0.4 * per))) * 2.0 - 1.0);
    y = x + toTexel(d * (bleed / 1.35));
  }
  let S = smp(srcT, y);
  if (S.a <= 0) { return vec4f(0); }
  let B = smp(auxT, y);
  var c = S.rgb / S.a;
  if (B.a > 0) { c = mix(c, B.rgb / B.a, 0.25); }
  let edge = clamp(length(S - B) * 2.5, 0.0, 1.0);
  let tooth = paperTooth(pu.paper.yzw, seed, i32(pu.ids.y), paperPx(q));
  let blot = 0.65 * noise2(seed, 25u, q / 70.0) + 0.35 * noise2(seed, 26u, q / 26.0);
  let d = 1.0 + pu.wash.z * 1.4 * (blot - 0.5) + pu.wash.x * 1.8 * (tooth - 0.5) + pu.wash.y * 1.6 * edge;
  c = clamp(c - (c - c * c) * (d - 1.0), vec3f(0), vec3f(1));
  return vec4f(c * S.a, S.a);
}

@fragment fn paperFx(i: VOut) -> @location(0) vec4f {
  let x = floor(i.pos.xy) + 0.5;
  let S = at(srcT, vec2i(floor(x)));
  if (S.a <= 0) { return vec4f(0); }
  let v = paperAt(pu.paper.yzw, pu.ids.x, i32(pu.ids.y), paperPx(toLocal(x)));
  return vec4f(S.rgb * (1.0 - pu.paper.x * 0.18 * v), S.a);
}

fn hh(seed: u32, k: u32, a: i32, b: i32) -> f32 { return rnd(seed, k, (bitcast<u32>(a) * 73856093u) ^ (bitcast<u32>(b) * 19349663u)); }

// A family of hatch lines: its angle, spacing (local units) and index.
struct Fam { th: f32, sp: f32, k: u32 };
// Thresholds by family and line parity: a line shows where the normalised tone is below its own threshold.
fn threshold(k: u32, even: bool) -> f32 {
  if (k == 0u) { return select(0.6, 0.8, even); }
  if (k == 1u) { return select(0.32, 0.46, even); }
  return select(0.11, 0.19, even);
}
// One patch (row r, column c) of family f: the ink of its nearest stroke at uv (the family's frame), up to 1.
fn rowShift(f: Fam, r: i32) -> f32 { return hh(pu.ids.x ^ 0x5bd1e995u, 40u + f.k, r, 7) * 16.0 * f.sp; }
// The blurred tone's luminance at local point q (the pixel's own where the layer is empty).
fn toneAt(q: vec2f, own: f32) -> f32 {
  let x = toTexel(q - pu.tl1.xy);
  let B = at(auxT, vec2i(floor(x)));
  return select(own, lum(B.rgb / B.a), B.a > 0.02);
}
// How far a patch centred at local point q turns its lines toward the form: along the tone's
// contours (perpendicular to its gradient), up to 0.45 rad, by how strong the gradient is.
fn formTurn(q: vec2f, a: vec2f) -> f32 {
  let r = a.y; let own = toneAt(q, 0.5);
  let g = vec2f(toneAt(q + vec2f(r, 0), own) - toneAt(q - vec2f(r, 0), own), toneAt(q + vec2f(0, r), own) - toneAt(q - vec2f(0, r), own));
  let m = length(g);
  if (m < 1e-3) { return 0.0; }
  var d = atan2(g.y, g.x) + 1.5707963 - a.x;
  d = d - 3.14159265 * round(d / 3.14159265);
  return clamp(d, -0.45, 0.45) * smoothstep(0.03, 0.2, m);
}
// One patch (row r, column c) of family f: the ink of its nearest stroke at uv (the family's frame), up to 1.
fn patchInk(f: Fam, uv: vec2f, rc: vec2i, t: f32) -> f32 {
  let seed = pu.ids.x ^ 0x5bd1e995u;
  let PL = 16.0 * f.sp; let PW = 6.0 * f.sp;
  let r = rc.x; let c = rc.y; let shift = rowShift(f, r);
  let ctr = vec2f((f32(c) + 0.5) * PL + shift, (f32(r) + 0.5) * PW);
  let dir = vec2f(cos(f.th), sin(f.th));
  let qc = ctr.x * dir + ctr.y * vec2f(-dir.y, dir.x);
  let da = (hh(seed, 50u + f.k, r, c) - 0.5) * 0.16 + formTurn(qc, vec2f(f.th, 0.5 * PW));
  let sp = f.sp * (0.92 + 0.16 * hh(seed, 60u + f.k, r, c));
  let d = uv - ctr; let cs = cos(da); let sn = sin(da);
  let w = vec2f(cs * d.x + sn * d.y, -sn * d.x + cs * d.y);
  if (abs(w.y) > 0.5 * PW + 0.5 * sp) { return 0.0; }
  let phase = hh(seed, 65u + f.k, r, c) * sp;
  let li = i32(round((w.y - phase) / sp));
  let id = r * 7919 + c;
  let h1 = hh(seed, 70u + f.k, li, id); let h2 = hh(seed, 80u + f.k, li, id); let h3 = hh(seed, 90u + f.k, li, id);
  let T = threshold(f.k, (li & 1) == 0) + (h1 - 0.5) * 0.08;
  let fade = 1.0 - smoothstep(T - 0.05, T + 0.05, t);
  if (fade <= 0) { return 0.0; }
  let s0 = -0.5 * PL * (0.85 + 0.3 * h2); let s1 = 0.5 * PL * (0.85 + 0.3 * h3);
  let s = (w.x - s0) / (s1 - s0);
  if (s <= 0 || s >= 1) { return 0.0; }
  let press = sqrt(sin(3.14159265 * s));
  let wob = (noise2(seed, 100u + f.k, vec2f(w.x / (4.0 * f.sp), f32(li) * 1.7 + h1 * 11.0)) - 0.5) * 0.3 * sp
          + (s - 0.5) * (s - 0.5) * (h2 - 0.5) * 0.8 * sp;
  let dist = abs(w.y - (phase + f32(li) * sp) - wob);
  let px = pu.tl1.w;
  let lw = max(0.13 * sp * (0.6 + 0.4 * press), 0.45 * px);
  let cov = 1.0 - smoothstep(lw - 0.6 * px, lw + 0.6 * px, dist);
  let gap = smoothstep(0.08, 0.2, noise2(seed, 110u + f.k, vec2f(w.x / (2.5 * f.sp), f32(li) * 3.1 + 5.0 * h2)));
  return cov * fade * gap * (0.45 + 0.55 * press);
}
fn familyInk(f: Fam, q: vec2f, t: f32) -> f32 {
  let dir = vec2f(cos(f.th), sin(f.th));
  let uv = vec2f(dot(q, dir), dot(q, vec2f(-dir.y, dir.x)));
  let PL = 16.0 * f.sp; let PW = 6.0 * f.sp;
  let rf = uv.y / PW; let r0 = i32(floor(rf));
  var rows = array(r0, select(r0 - 1, r0 + 1, rf - floor(rf) > 0.5));
  var ink = 0.0;
  for (var a = 0; a < 2; a++) {
    let r = rows[a];
    let cf = (uv.x - rowShift(f, r)) / PL; let c0 = i32(floor(cf));
    var cols = array(c0, select(c0 - 1, c0 + 1, cf - floor(cf) > 0.5));
    for (var b = 0; b < 2; b++) { ink = max(ink, patchInk(f, uv, vec2i(r, cols[b]), t)); }
  }
  return ink;
}
// The tone range from the histogram pass: (lo, hi) luminance.
fn toneRange() -> vec2f { return vec2f(bitcast<f32>(tone[64]), bitcast<f32>(tone[65])); }

@fragment fn hatch(i: VOut) -> @location(0) vec4f {
  let x = floor(i.pos.xy) + 0.5;
  let S = at(srcT, vec2i(floor(x)));
  if (S.a <= 0) { return vec4f(0); }
  let B = at(auxT, vec2i(floor(x)));
  let c = S.rgb / S.a;
  let l = select(lum(c), lum(B.rgb / B.a), B.a > 0.02);
  let lr = toneRange();
  // amount scales line density as well as ink: less amount, fewer lines show at a given tone.
  let t = 1.0 - (1.0 - clamp((l - 0.5 * (lr.x + lr.y)) / max(lr.y - lr.x, 0.3) + 0.5, 0.0, 1.0)) * (0.3 + 0.7 * pu.hatch.x);
  if (t >= 0.86) { return S; }
  let q = toLocal(x);
  let th = pu.hatch.y; let sp = pu.hatch.z;
  var ink = familyInk(Fam(th, sp, 0u), q, t);
  if (t < 0.52) { ink = max(ink, familyInk(Fam(th + 1.15, sp * 1.05, 1u), q, t)); }
  if (t < 0.25) { ink = max(ink, familyInk(Fam(th - 0.55, sp * 0.9, 2u), q, t)); }
  let grain = paperAt(pu.paper.yzw, pu.ids.x, i32(pu.ids.y), paperPx(q));
  ink = ink * (1.0 - 0.55 * grain) * (0.75 + 0.25 * (1.0 - t));
  // The default ink: the colour darkened toward graphite, never lighter than half the colour.
  let own = min(mix(c * 0.3, vec3f(0.13, 0.13, 0.16), 0.35), c * 0.5);
  let inkC = select(own, pu.ink.rgb, pu.hatch.w > 0);
  let k = clamp(ink * pu.hatch.x * select(1.0, pu.ink.a, pu.hatch.w > 0), 0.0, 1.0);
  return vec4f(mix(c, inkC, k) * S.a, S.a);
}
`;

// The group's tone range for hatching: a luminance histogram of the blurred
// layer (64 bins, weighted by alpha), then the 3rd and 97th percentiles.
// Integer atomic adds commute, so the result does not depend on order.
export const TONE_WGSL = /* wgsl */ `
struct R { region: vec4f };
@group(0) @binding(0) var<uniform> ru: R;
@group(0) @binding(1) var toneT: texture_2d<f32>;
@group(0) @binding(2) var<storage, read_write> hist: array<atomic<u32>, 66>;
@compute @workgroup_size(8, 8) fn histogram(@builtin(global_invocation_id) g: vec3u) {
  let p = vec2f(g.xy);
  if (p.x >= ru.region.z || p.y >= ru.region.w) { return; }
  let T = textureLoad(toneT, vec2i(g.xy) + vec2i(ru.region.xy), 0);
  if (T.a < 0.02) { return; }
  let l = dot(T.rgb / T.a, vec3f(0.2126, 0.7152, 0.0722));
  atomicAdd(&hist[min(u32(l * 64.0), 63u)], u32(round(T.a * 255.0)));
}
@compute @workgroup_size(1) fn range() {
  var total = 0u;
  for (var i = 0u; i < 64u; i++) { total += atomicLoad(&hist[i]); }
  var acc = 0u; var lo = -1.0; var hi = 1.0;
  for (var i = 0u; i < 64u; i++) {
    acc += atomicLoad(&hist[i]);
    if (lo < 0 && f32(acc) >= 0.03 * f32(total)) { lo = (f32(i) + 0.5) / 64.0; }
    if (f32(acc) >= 0.97 * f32(total)) { hi = (f32(i) + 0.5) / 64.0; break; }
  }
  if (total == 0u) { lo = 0.0; hi = 1.0; }
  atomicStore(&hist[64], bitcast<u32>(max(lo, 0.0)));
  atomicStore(&hist[65], bitcast<u32>(hi));
}
`;
