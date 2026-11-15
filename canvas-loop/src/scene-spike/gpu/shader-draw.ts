// WGSL for coverage and drawing. Ported from the Stage 3 probes:
// - EDGE_WGSL: the geometry probe's exact-area coverage atlas. Each polygon
//   edge draws a quad from the edge to its slot's right side and adds, per
//   pixel, the signed area of the pixel right of the edge (closed form). The
//   sum is the exact covered area with nonzero winding.
// - DRAW_WGSL: the compositing probe's draw shader, reading coverage from the
//   atlas instead of looping over edges. A draw is one quad over its box in the
//   target layer; layers are premultiplied rgba8unorm. A draw's source (`src`)
//   is a coverage piece (0), a layer (1, with a mask 2), a brushed mark in the
//   mark atlas painted (3) or carrying its own colours (4), or a glyph cell (5).
//   Brushed marks lose grain to the paper and take their opacity here, once.
import { COMPOSE_WGSL } from "./shader-compose.js";
import { PAPER_WGSL } from "./shader-paper.js";

/** 32-bit words per draw record (the WGSL `Draw` struct). */
export const WORDS = 68;

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
  pap0: vec4f, pap1: vec4f, pap2: vec4f,
  kind: u32, mode: u32, stopStart: u32, stopCount: u32,
  src: u32, seed: u32, pwidth: i32, opacity: f32,
};
@group(0) @binding(0) var<storage, read> draws: array<Draw>;
@group(0) @binding(1) var<storage, read> stops: array<vec4f>;
@group(0) @binding(2) var<storage, read> clipEdges: array<vec4f>;
@group(1) @binding(0) var srcT: texture_2d<f32>;
@group(1) @binding(1) var maskT: texture_2d<f32>;
@group(1) @binding(2) var clipT: texture_2d<f32>;
@group(1) @binding(3) var bdT: texture_2d<f32>;
@group(1) @binding(4) var atlasT: texture_2d<f32>;
@group(1) @binding(5) var auxT: texture_2d<f32>;
@group(1) @binding(6) var imgT: texture_2d<f32>;

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
// Texel q of the o.zw cell at o.xy in t: outside the cell transparent, or the nearest edge texel.
fn texel(t: texture_2d<f32>, q: vec2i, o: vec4f, edge: bool) -> vec4f {
  var k = q;
  if (edge) { k = clamp(q, vec2i(0), vec2i(o.zw) - 1); }
  else if (q.x < 0 || q.y < 0 || q.x >= i32(o.z) || q.y >= i32(o.w)) { return vec4f(0); }
  return textureLoad(t, k + vec2i(o.xy), 0);
}
// Bilinear sample of that cell at p (texel centres at half-integers).
fn bilinear(t: texture_2d<f32>, p: vec2f, o: vec4f, edge: bool) -> vec4f {
  let g = p - 0.5; let i = floor(g); let f = g - i; let q = vec2i(i);
  let a = texel(t, q, o, edge); let b = texel(t, q + vec2i(1, 0), o, edge);
  let c = texel(t, q + vec2i(0, 1), o, edge); let e = texel(t, q + vec2i(1, 1), o, edge);
  return mix(mix(a, b, f.x), mix(c, e, f.x), f.y);
}
fn cover(d: Draw, pix: vec2f) -> f32 {
  let q = pix - d.covO.xy;
  if (q.x < 0 || q.y < 0 || q.x >= d.covO.z || q.y >= d.covO.w) { return 0.0; }
  return min(abs(textureLoad(atlasT, vec2i(q + d.covA.xy), 0).r), 1.0);
}
fn markAt(d: Draw, pix: vec2f) -> vec4f {
  let q = pix - d.covO.xy;
  if (q.x < 0 || q.y < 0 || q.x >= d.covO.z || q.y >= d.covO.w) { return vec4f(0); }
  return textureLoad(auxT, vec2i(q + d.covA.xy), 0);
}
// pap0, pap1.xy: an affine map of the pixel centre (to the paper, or to a glyph cell's texels).
fn mapped(d: Draw, pix: vec2f) -> vec2f {
  let p = pix + 0.5;
  return vec2f(d.pap0.x * p.x + d.pap0.z * p.y + d.pap1.x, d.pap0.y * p.x + d.pap0.w * p.y + d.pap1.y);
}
fn paint(d: Draw, pix: vec2f) -> vec4f {
  if (d.kind == 0u) { return d.color; }
  let p = pix + 0.5;
  var l = vec2f(d.inv0.x * p.x + d.inv0.z * p.y + d.inv1.x, d.inv0.y * p.x + d.inv0.w * p.y + d.inv1.y);
  if (d.kind == 3u) { return bilinear(imgT, l, vec4f(vec2f(0), vec2f(textureDimensions(imgT))), true); }
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
  switch d.src {
    case 0u: { *cov = cover(d, pix); s = paint(d, pix); }
    case 1u, 2u: {
      *cov = 1.0;
      s = ld(srcT, pix, d.srcO) * d.opacity;
      if (d.src == 2u) { s = s * ld(maskT, pix, d.maskO).a; }
    }
    case 3u: { *cov = markAt(d, pix).a; s = paint(d, pix); }
    case 4u: { *cov = 1.0; s = markAt(d, pix); }
    default: { *cov = bilinear(auxT, mapped(d, pix), vec4f(d.covA.xy, d.covO.zw), false).r; s = paint(d, pix); }
  }
  if (d.pap1.w > 0) {
    let q = vec2i(floor(mapped(d, pix)));
    *cov = *cov * (1.0 - d.pap1.w * paperAt(vec3f(d.pap1.z, d.pap2.xy), d.seed, d.pwidth, q));
  }
  *cov = *cov * d.pap2.z;
  if (d.clipO.z > 0) { *cov = *cov * ld(clipT, pix, d.clipO).r; }
  return s;
}
fn pixOf(d: Draw, pos: vec4f) -> vec2f { return floor(pos.xy) + d.tgt.xy; }
@fragment fn fsFixed(i: VOut) -> @location(0) vec4f {
  let d = draws[i.id]; var cov: f32; let s = source(d, pixOf(d, i.pos), &cov);
  return s * cov;
}
${COMPOSE_WGSL}
${PAPER_WGSL}
@fragment fn fsBackdrop(i: VOut) -> @location(0) vec4f {
  let d = draws[i.id]; let pix = pixOf(d, i.pos);
  var cov: f32; let s = source(d, pix, &cov);
  let D = ld(bdT, pix, d.bdO);
  return mix(D, blend(d.mode, s, D), cov);
}
`;
