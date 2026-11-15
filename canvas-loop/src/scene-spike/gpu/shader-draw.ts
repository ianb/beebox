// WGSL for coverage and drawing. Ported from the Stage 3 probes:
// - EDGE_WGSL: the geometry probe's exact-area coverage atlas. Each polygon
//   edge draws a quad from the edge to its slot's right side and adds, per
//   pixel, the signed area of the pixel right of the edge (closed form). The
//   sum is the exact covered area with nonzero winding.
// - DRAW_WGSL: the compositing probe's draw shader, reading coverage from the
//   atlas instead of looping over edges. A draw is one quad over its box in the
//   target layer; layers are premultiplied rgba8unorm.

export const EDGE_WGSL = /* wgsl */ `
struct U { size: vec4f };
@group(0) @binding(0) var<uniform> u: U;
struct SegOut { @builtin(position) pos: vec4f, @location(0) @interpolate(flat) seg: vec4f };
@vertex fn segVs(@builtin(vertex_index) vi: u32, @location(0) seg: vec4f, @location(1) right: f32) -> SegOut {
  let x0 = floor(min(seg.x, seg.z)); let y0 = floor(min(seg.y, seg.w)); let y1 = ceil(max(seg.y, seg.w));
  var c = array(vec2f(0,0), vec2f(1,0), vec2f(0,1), vec2f(0,1), vec2f(1,0), vec2f(1,1));
  let k = c[vi];
  let p = vec2f(mix(x0, right, k.x), mix(y0, y1, k.y));
  var o: SegOut; o.pos = vec4f(p.x / u.size.x * 2 - 1, 1 - p.y / u.size.y * 2, 0, 1); o.seg = seg; return o;
}
fn G(f: f32) -> f32 { if (f <= 0) { return 0.0; } if (f >= 1) { return f - 0.5; } return 0.5 * f * f; }
@fragment fn segFs(i: SegOut) -> @location(0) vec4f {
  let px = floor(i.pos.x); let py = floor(i.pos.y);
  var a = i.seg.xy; var b = i.seg.zw; var sgn = 1.0;
  if (a.y > b.y) { let t = a; a = b; b = t; sgn = -1.0; }
  let ya = max(py, a.y); let yb = min(py + 1, b.y);
  if (yb <= ya) { return vec4f(0); }
  let dxdy = (b.x - a.x) / (b.y - a.y);
  let fa = px + 1 - (a.x + (ya - a.y) * dxdy);
  let fb = px + 1 - (a.x + (yb - a.y) * dxdy);
  var area: f32;
  if (min(fa, fb) >= 1) { area = yb - ya; }
  else if (max(fa, fb) <= 0) { area = 0.0; }
  else if (abs(fb - fa) < 1e-3) { area = clamp(0.5 * (fa + fb), 0, 1) * (yb - ya); }
  else { area = (G(fb) - G(fa)) / (fb - fa) * (yb - ya); }
  return vec4f(sgn * area, 0, 0, 0);
}
`;

export const DRAW_WGSL = /* wgsl */ `
struct Draw {
  box: vec4f, tgt: vec4f, color: vec4f, inv0: vec4f, inv1: vec4f, grad: vec4f,
  covO: vec4f, covA: vec4f, srcO: vec4f, maskO: vec4f, clipO: vec4f, bdO: vec4f,
  kind: u32, mode: u32, stopStart: u32, stopCount: u32,
  opacity: f32, pad0: f32, pad1: f32, pad2: f32,
};
@group(0) @binding(0) var<storage, read> draws: array<Draw>;
@group(0) @binding(1) var<storage, read> stops: array<vec4f>;
@group(0) @binding(2) var<storage, read> clipEdges: array<vec4f>;
@group(1) @binding(0) var srcT: texture_2d<f32>;
@group(1) @binding(1) var maskT: texture_2d<f32>;
@group(1) @binding(2) var clipT: texture_2d<f32>;
@group(1) @binding(3) var bdT: texture_2d<f32>;
@group(1) @binding(4) var atlasT: texture_2d<f32>;

struct VOut { @builtin(position) pos: vec4f, @location(0) @interpolate(flat) id: u32 };
@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  let d = draws[ii];
  var c = array(vec2f(0,0), vec2f(1,0), vec2f(0,1), vec2f(0,1), vec2f(1,0), vec2f(1,1));
  let p = mix(d.box.xy, d.box.zw, c[vi]);
  let t = (p - d.tgt.xy) / d.tgt.zw;
  var o: VOut; o.pos = vec4f(t.x * 2 - 1, 1 - t.y * 2, 0, 1); o.id = ii; return o;
}
// A texel of a layer whose texel (0,0) sits at target pixel o.xy; outside its o.zw size, transparent.
fn ld(t: texture_2d<f32>, p: vec2f, o: vec4f) -> vec4f {
  let q = p - o.xy;
  if (q.x < 0 || q.y < 0 || q.x >= o.z || q.y >= o.w) { return vec4f(0); }
  return textureLoad(t, vec2i(q), 0);
}
fn cover(d: Draw, pix: vec2f) -> f32 {
  let q = pix - d.covO.xy;
  if (q.x < 0 || q.y < 0 || q.x >= d.covO.z || q.y >= d.covO.w) { return 0.0; }
  return min(abs(textureLoad(atlasT, vec2i(q + d.covA.xy), 0).r), 1.0);
}
fn paint(d: Draw, pix: vec2f) -> vec4f {
  if (d.kind == 0u) { return d.color; }
  let p = pix + 0.5;
  var l = vec2f(d.inv0.x * p.x + d.inv0.z * p.y + d.inv1.x, d.inv0.y * p.x + d.inv0.w * p.y + d.inv1.y);
  var t: f32;
  if (d.kind == 1u) {
    let v = d.grad.zw - d.grad.xy; let vv = dot(v, v);
    t = select(0.0, dot(l - d.grad.xy, v) / vv, vv > 0);
  } else {
    l.y = d.grad.y + (l.y - d.grad.y) / d.inv1.z;
    t = (length(l - d.grad.xy) - d.grad.z) / max(d.grad.w - d.grad.z, 1e-6);
  }
  t = clamp(t, 0.0, 1.0);
  var c = stops[d.stopStart + 1u];
  for (var i = 1u; i < d.stopCount; i++) {
    let o0 = stops[d.stopStart + 2u * (i - 1u)].x; let o1 = stops[d.stopStart + 2u * i].x;
    if (t >= o0) {
      let c0 = stops[d.stopStart + 2u * (i - 1u) + 1u]; let c1 = stops[d.stopStart + 2u * i + 1u];
      c = select(c1, mix(c0, c1, (t - o0) / max(o1 - o0, 1e-6)), t <= o1);
    }
  }
  return vec4f(c.rgb * c.a, c.a);
}
fn source(d: Draw, pix: vec2f, cov: ptr<function, f32>) -> vec4f {
  var s: vec4f;
  if (d.kind <= 2u) { *cov = cover(d, pix); s = paint(d, pix); }
  else {
    *cov = 1.0;
    s = ld(srcT, pix, d.srcO) * d.opacity;
    if (d.kind == 4u) { s = s * ld(maskT, pix, d.maskO).a; }
  }
  if (d.clipO.z > 0) { *cov = *cov * ld(clipT, pix, d.clipO).r; }
  return s;
}
fn pixOf(d: Draw, pos: vec4f) -> vec2f { return floor(pos.xy) + d.tgt.xy; }
@fragment fn fsFixed(i: VOut) -> @location(0) vec4f {
  let d = draws[i.id]; var cov: f32; let s = source(d, pixOf(d, i.pos), &cov);
  return s * cov;
}
// A clip's coverage: the share of the pixel where the summed winding of all its
// shapes is not zero, so a shape repeated, or two shapes sharing an edge, give
// the same coverage as their geometric union. Exact across x; sampled in 16
// bands down the pixel (at most 1/32 off on a nearly horizontal edge).
const BANDS = 16u;
const SLOTS = 16u;
fn unionCover(pix: vec2f, start: u32, count: u32) -> f32 {
  var total = 0.0;
  for (var b = 0u; b < BANDS; b++) {
    let y = pix.y + (f32(b) + 0.5) / f32(BANDS);
    var w = 0;
    var xs: array<f32, 16>; var ds: array<i32, 16>; var m = 0u;
    for (var k = 0u; k < count; k++) {
      let e = clipEdges[start + k];
      let lo = min(e.y, e.w); let hi = max(e.y, e.w);
      if (y < lo || y >= hi) { continue; }
      let x = e.x + (y - e.y) * (e.z - e.x) / (e.w - e.y);
      let dir = select(-1, 1, e.w > e.y);
      if (x < pix.x) { w += dir; continue; }
      if (x >= pix.x + 1 || m >= SLOTS) { continue; }
      var j = m;
      while (j > 0u && xs[j - 1u] > x) { xs[j] = xs[j - 1u]; ds[j] = ds[j - 1u]; j--; }
      xs[j] = x; ds[j] = dir; m++;
    }
    var cur = pix.x;
    for (var k = 0u; k < m; k++) {
      if (w != 0) { total += xs[k] - cur; }
      cur = xs[k]; w += ds[k];
    }
    if (w != 0) { total += pix.x + 1 - cur; }
  }
  return total / f32(BANDS);
}
@fragment fn fsClipCov(i: VOut) -> @location(0) vec4f {
  let d = draws[i.id];
  return vec4f(unionCover(pixOf(d, i.pos), u32(d.covA.z), u32(d.covA.w)), 0, 0, 1);
}
@fragment fn fsClipMul(i: VOut) -> @location(0) vec4f {
  let d = draws[i.id];
  return vec4f(ld(clipT, pixOf(d, i.pos), d.clipO).r, 0, 0, 1);
}
// W3C compositing formulas on unpremultiplied colours; modes numbered as BLEND_MODES.
fn sep(m: u32, s: f32, b: f32) -> f32 {
  switch m {
    case 1u: { return s * b; }
    case 2u: { return s + b - s * b; }
    case 3u: { if (b <= 0.5) { return s * 2 * b; } let b2 = 2 * b - 1; return s + b2 - s * b2; }
    case 4u: { return min(s, b); }
    case 5u: { return max(s, b); }
    case 6u: {
      if (s <= 0.5) { return b - (1 - 2 * s) * b * (1 - b); }
      let dd = select(sqrt(b), ((16 * b - 12) * b + 4) * b, b <= 0.25);
      return b + (2 * s - 1) * (dd - b);
    }
    case 7u: { if (s <= 0.5) { return b * 2 * s; } let s2 = 2 * s - 1; return b + s2 - b * s2; }
    case 8u: { if (b == 0) { return 0.0; } if (s >= 1) { return 1.0; } return min(1.0, b / (1 - s)); }
    case 9u: { if (b >= 1) { return 1.0; } if (s <= 0) { return 0.0; } return 1 - min(1.0, (1 - b) / s); }
    case 11u: { return abs(s - b); }
    case 12u: { return s + b - 2 * s * b; }
    default: { return s; }
  }
}
fn lum(c: vec3f) -> f32 { return dot(c, vec3f(0.3, 0.59, 0.11)); }
fn clipColor(c: vec3f) -> vec3f {
  let l = lum(c); let n = min(min(c.r, c.g), c.b); let x = max(max(c.r, c.g), c.b);
  var r = c;
  if (n < 0) { r = l + (r - l) * l / (l - n); }
  if (x > 1) { r = l + (r - l) * (1 - l) / (x - l); }
  return r;
}
fn setLum(c: vec3f, l: f32) -> vec3f { return clipColor(c + (l - lum(c))); }
fn sat(c: vec3f) -> f32 { return max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b); }
fn setSat(c: vec3f, s: f32) -> vec3f {
  let n = min(min(c.r, c.g), c.b); let x = max(max(c.r, c.g), c.b);
  if (x > n) { return (c - n) * s / (x - n); }
  return vec3f(0);
}
fn blend(m: u32, S: vec4f, D: vec4f) -> vec4f {
  let as_ = S.a; let ab = D.a;
  let Cs = select(vec3f(0), S.rgb / as_, as_ > 0); let Cb = select(vec3f(0), D.rgb / ab, ab > 0);
  var B: vec3f;
  if (m == 13u) { B = setLum(setSat(Cs, sat(Cb)), lum(Cb)); }
  else if (m == 14u) { B = setLum(setSat(Cb, sat(Cs)), lum(Cb)); }
  else if (m == 15u) { B = setLum(Cs, lum(Cb)); }
  else if (m == 16u) { B = setLum(Cb, lum(Cs)); }
  else { B = vec3f(sep(m, Cs.r, Cb.r), sep(m, Cs.g, Cb.g), sep(m, Cs.b, Cb.b)); }
  return vec4f(S.rgb * (1 - ab) + D.rgb * (1 - as_) + as_ * ab * B, as_ + ab - as_ * ab);
}
@fragment fn fsBackdrop(i: VOut) -> @location(0) vec4f {
  let d = draws[i.id]; let pix = pixOf(d, i.pos);
  var cov: f32; let s = source(d, pix, &cov);
  let D = ld(bdT, pix, d.bdO);
  return mix(D, blend(d.mode, s, D), cov);
}
`;
