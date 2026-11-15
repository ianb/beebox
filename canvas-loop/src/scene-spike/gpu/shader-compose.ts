// WGSL shared by the draw shader: clip coverage (the union of a clip's shapes
// by summed winding) and the W3C blend formulas for blends that read the
// target. Ported from the Stage 3 compositing probe.
export const COMPOSE_WGSL = /* wgsl */ `
// A union clip's coverage: the share of the pixel where the summed winding of
// all its shapes is not zero, so two shapes sharing an edge, or overlapping,
// give the coverage of their geometric union. Exact across x; sampled in 64
// bands down the pixel (at most 1/128 off on a nearly horizontal edge, so
// within two levels of a one-shape clip's exact area from the atlas).
const BANDS = 64u;
const SLOTS = 16u;
const NEAR = 48u;
fn unionCover(pix: vec2f, start: u32, count: u32) -> f32 {
  // The edges that reach this pixel's row, in order (all of them if there are too many): only they can matter.
  var near: array<u32, 48>; var n = 0u; var all = false;
  for (var k = 0u; k < count; k++) {
    let e = clipEdges[start + k];
    if (max(e.y, e.w) <= pix.y || min(e.y, e.w) >= pix.y + 1) { continue; }
    if (n < NEAR) { near[n] = start + k; n++; } else { all = true; }
  }
  let m0 = select(n, count, all);
  var total = 0.0;
  for (var b = 0u; b < BANDS; b++) {
    let y = pix.y + (f32(b) + 0.5) / f32(BANDS);
    var w = 0;
    var xs: array<f32, 16>; var ds: array<i32, 16>; var m = 0u;
    for (var k = 0u; k < m0; k++) {
      let e = clipEdges[select(near[min(k, NEAR - 1u)], start + k, all)];
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
// One clip on a clip page: its box (clipO, device pixels) sits at clipA.xy. Coverage is
// one shape's from the coverage atlas (src 0) or a union's by summed winding (src 1,
// edges at covA.zw), times its parent's (box srcO, at maskO.xy on the page bound as clipT).
@fragment fn fsClipPage(i: VOut) -> @location(0) vec4f {
  let d = draws[i.id];
  let p = pixOf(d, i.pos) - d.clipA.xy + d.clipO.xy;
  var c: f32;
  if (d.src == 0u) { c = cover(d, p); } else { c = unionCover(p, u32(d.covA.z), u32(d.covA.w)); }
  if (d.srcO.z > 0) {
    let q = p - d.srcO.xy;
    if (q.x < 0 || q.y < 0 || q.x >= d.srcO.z || q.y >= d.srcO.w) { c = 0.0; }
    else { c = c * textureLoad(clipT, vec2i(q + d.maskO.xy), 0).r; }
  }
  return vec4f(c, 0, 0, 1);
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
`;
