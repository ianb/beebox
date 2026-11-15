// WGSL for lit groups (R8), ported from the Stage 3 light-and-paint probe.
// - LIGHT_WGSL: one quad over the colour layer. Per pixel: the normal and shine
//   from material layer 0, emissive and shadow-casting amount from layer 1
//   (premultiplied by coverage; shading divides by it, so a translucent
//   shape keeps its own emissive and shine, and a missing material is flat matte);
//   per light, Lambert diffuse, Blinn-Phong shine, a windowed falloff to
//   `reach`, a spot's cone; a 2D shadow by marching toward the light through
//   the casting amount. Lighting is in linear light and clips at 1. The
//   result is colour × ((1 − e)(ambient + lights) + e) for emissive e, so an
//   emissive pixel keeps its colour: a nested lit group is not lit twice.
//   Shadows: each caster stands at its own height (material layer 1); a
//   sample blocks where its caster's top is above the ray from the pixel to
//   the light, so taller casters and lower lights cast longer shadows. A
//   pixel on a caster sits on top of it, so a caster never shadows itself
//   and only taller casters shadow it; samples in the caster that holds the
//   light are skipped. Within one caster the strongest block counts (not the
//   product), so a caster at half alpha blocks half.
//   Then exposure (2^stops) and the tone curve: `tone` blends from a clip at
//   white toward an S-curve in linear light, x^p / (x^p + m^p) scaled so 4
//   maps to white (p 1.4, m 0.6): deeper shadows, highlights that roll off,
//   middle tones about where they were. Both parts rise with x, so the curve
//   is monotonic at every strength.
// - BEVEL_WGSL: a bevelled shape's normals from its coverage blurred by half
//   the bevel, shaped into a round rim (the probe used a jump-flood distance;
//   see the stage 4 notes).
const QUAD = /* wgsl */ `
struct VOut { @builtin(position) pos: vec4f };
@vertex fn vs(@builtin(vertex_index) vi: u32) -> VOut {
  var c = array(vec2f(0,0), vec2f(1,0), vec2f(0,1), vec2f(0,1), vec2f(1,0), vec2f(1,1));
  let p = (U.region.xy + c[vi] * U.region.zw) / U.size.xy;
  var o: VOut; o.pos = vec4f(p.x * 2 - 1, 1 - p.y * 2, 0, 1); return o;
}
// Texel p of a layer whose texel 0 sits at o.xy in this layer's texels, o.zw in size; outside, transparent.
fn inO(t: texture_2d<f32>, p: vec2i, o: vec4f) -> vec4f {
  let q = vec2f(p) - o.xy;
  if (q.x < 0 || q.y < 0 || q.x >= o.z || q.y >= o.w) { return vec4f(0); }
  return textureLoad(t, vec2i(q), 0);
}
`;

export const LIGHT_WGSL = /* wgsl */ `
struct LU {
  size: vec4f,    // the target texture's size; this layer's origin in canvas device px (shading works in canvas px)
  region: vec4f,  // the colour layer's valid texels
  aO: vec4f,      // material layer 0: where its texel 0 sits in this layer, and its size
  bO: vec4f,      // material layer 1
  ambient: vec4f, // rgb; shadows (0 none, 1 hard, 2 soft)
  misc: vec4f,    // light count, height scale (device px per squared encoded height), pixel ratio, tallest caster (device px)
  tone: vec4f,    // 2^exposure, tone curve strength
};
// pos: x, y (texels), height (device px), kind (0 point, 1 spot, 2 directional)
// col: rgb, energy; p: reach (device px), direction (radians), cone half-angle, directional slope
struct Lt { pos: vec4f, col: vec4f, p: vec4f };
@group(0) @binding(0) var<uniform> U: LU;
@group(0) @binding(1) var<storage, read> lights: array<Lt>;
@group(0) @binding(2) var colT: texture_2d<f32>;
@group(0) @binding(3) var matA: texture_2d<f32>;
@group(0) @binding(4) var matB: texture_2d<f32>;
@group(0) @binding(5) var matBs: texture_2d<f32>;
${QUAD}
// Interleaved gradient noise (Jimenez 2014): a deterministic per-pixel offset in 0..1 whose neighbours differ evenly.
fn ign(p: vec2i) -> f32 { return fract(52.9829189 * fract(0.06711056 * f32(p.x) + 0.00583715 * f32(p.y))); }
fn s2l(c: vec3f) -> vec3f { return select(pow((c + 0.055) / 1.055, vec3f(2.4)), c / 12.92, c <= vec3f(0.04045)); }
fn l2s(c: vec3f) -> vec3f { return select(1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055, c * 12.92, c <= vec3f(0.0031308)); }
// Shading works in canvas device px (positions stay the same whatever the layer's bounds);
// a canvas position's texel in this layer is its floor less the layer's whole-pixel origin.
fn texel(c: vec2f) -> vec2i { return vec2i(floor(c)) - vec2i(U.size.zw); }
fn casts(c: vec2f) -> f32 { return inO(matB, texel(c), U.bO).g; }
// A caster's height in device px from its material texel (per unit of casting amount).
fn topOf(B: vec4f) -> f32 { let e = select(0.0, B.b / B.g, B.g > 1e-4); return e * e * U.misc.y; }
fn tone(x: f32) -> f32 {
  let p = 1.4; let m = pow(0.6, p); let w = pow(4.0, p);
  let film = min(1.0, pow(max(x, 0.0), p) / (pow(max(x, 0.0), p) + m) * (w + m) / w);
  return mix(min(x, 1.0), film, U.tone.y);
}

// The part [t0, t1] of the ray P + D·t (0 ≤ t ≤ tmax) inside the caster layer; empty when t0 > t1.
fn inCasters(P: vec2f, D: vec2f, tmax: f32) -> vec2f {
  let lo = U.bO.xy + U.size.zw; let hi = lo + U.bO.zw;
  var t0 = 0.0; var t1 = tmax;
  for (var k = 0; k < 2; k++) {
    if (abs(D[k]) < 1e-6) {
      if (P[k] < lo[k] || P[k] > hi[k]) { return vec2f(1, 0); }
    } else {
      let a = (lo[k] - P[k]) / D[k]; let b = (hi[k] - P[k]) / D[k];
      t0 = max(t0, min(a, b)); t1 = min(t1, max(a, b));
    }
  }
  return vec2f(t0, t1);
}

// How much of the light at L reaches P: 1 unblocked, 0 in full shadow.
// The march covers only where a caster could block: inside the caster layer, and (for a light
// above every caster) only until the ray has risen past the tallest caster, unless the light
// sits in a caster, whose own run must be seen to its end. Samples are 2 device px per pixel
// ratio apart, at most 8 px; past 256 samples (a march over 2048 px at the widest spacing)
// the spacing grows instead, and casters thinner than it can be missed.
// The march's caster layer read bilinearly at canvas position c (texel centres at half-integers), so a
// sample between texels does not snap to one: the penumbra varies smoothly with the pixel.
fn castersAt(c: vec2f) -> vec4f {
  // Weights from the canvas position alone (the layer's origin is whole pixels, taken off as integers), so the
  // result does not depend on the layer's bounds.
  let g = c - 0.5; let i = floor(g); let f = g - i; let q = vec2i(i) - vec2i(U.size.zw);
  return mix(mix(inO(matBs, q, U.bO), inO(matBs, q + vec2i(1, 0), U.bO), f.x), mix(inO(matBs, q + vec2i(0, 1), U.bO), inO(matBs, q + vec2i(1, 1), U.bO), f.x), f.y);
}
// How much a caster sample at ray parameter t blocks the light (0..1).
fn blockAt(P: vec3f, L: vec3f, t: f32) -> f32 {
  let S = castersAt(P.xy + (L.xy - P.xy) * t);
  if (S.g <= 0.02) { return 0.0; }
  let ratio = U.misc.z;
  let soft = select(1.0, 1.0 + 0.03 * length(L.xy - P.xy) * t / ratio, U.ambient.w > 1.5) * ratio;
  return S.g * smoothstep(0.0, soft, topOf(S) - mix(P.z, L.z, t));
}
// How much of the light at L reaches P: 1 unblocked, 0 in full shadow.
// The march covers only where a caster could block: inside the caster layer, and (for a light
// above every caster) only until the ray has risen past the tallest caster, unless the light
// sits in a caster, whose own run must be seen to its end. Samples are 2 device px per pixel
// ratio apart, at most 8 px; past 256 samples (a march over 2048 px at the widest spacing)
// the spacing grows instead, and casters thinner than it can be missed. Within each run of
// samples on casters, the strongest block is refined around its sample by a halving search, so neighbouring pixels find nearly the same maximum: the penumbra is smooth, not
// speckled by where each pixel's samples happen to fall. The start offset is interleaved
// gradient noise by canvas pixel (deterministic, low-discrepancy), against banding.
fn shadow(P: vec3f, L: vec3f, recvIn: bool) -> f32 {
  let D = L.xy - P.xy; let len = length(D);
  let ratio = U.misc.z; let H = U.misc.w;
  if (H <= 0.0) { return 1.0; }
  let lightIn = casts(L.xy) > 0.02;
  var tmax = 1.0;
  if (!lightIn && L.z > H) { tmax = clamp((H + ratio - P.z) / (L.z - P.z), 0.0, 1.0); }
  let span = inCasters(P.xy, D, tmax);
  if (span.x > span.y) { return 1.0; }
  let n = clamp(i32(ceil((span.y - span.x) * len / min(2.0 * ratio, 8.0))), 2, 256);
  let dt = (span.y - span.x) / f32(n);
  let j = ign(vec2i(floor(P.xy)));
  var vis = 1.0; var best = 0.0; var bestT = -1.0; var inSelf = recvIn;
  for (var i = 0; i < n; i++) {
    let t = mix(span.x, span.y, (f32(i) + j) / f32(n));
    let S = inO(matBs, texel(P.xy + D * t), U.bO);
    let c = S.g;
    if (c <= 0.02) {
      inSelf = false;
      if (bestT >= 0.0) { vis *= 1.0 - refine(P, L, vec2f(bestT, best), dt); }
      best = 0.0; bestT = -1.0;
      continue;
    }
    let top = topOf(S);
    // Still on the receiving caster: its own surface never shadows it, but a taller caster
    // touching it does, gap or not. Heights are read as blue ÷ green of 8-bit texels, so near an
    // outline (little coverage) they are rough: only a clearly taller, well-covered sample counts.
    if (inSelf && (c < 0.25 || top <= P.z + max(2.0 * ratio, 0.05 * P.z))) { continue; }
    inSelf = false;
    let b = blockAt(P, L, t);
    if (b > best || bestT < 0.0) { best = b; bestT = t; }
  }
  if ((!lightIn || span.y < 1.0) && bestT >= 0.0) { vis *= 1.0 - refine(P, L, vec2f(bestT, best), dt); }
  return vis;
}
// The strongest block near a run's best sample (t, block): a search that halves its step four times,
// from half a step either side, so the maximum is found to a sixteenth of a step.
fn refine(P: vec3f, L: vec3f, tb: vec2f, dt: f32) -> f32 {
  var t = tb.x; var m = tb.y; var h = 0.5 * dt;
  for (var k = 0; k < 4; k++) {
    let a = clamp(t - h, 0.0, 1.0); let b = clamp(t + h, 0.0, 1.0);
    let ma = blockAt(P, L, a); let mb = blockAt(P, L, b);
    if (ma > m) { m = ma; t = a; }
    if (mb > m) { m = mb; t = b; }
    h *= 0.5;
  }
  return m;
}
@fragment fn light(i: VOut) -> @location(0) vec4f {
  let p = vec2i(floor(i.pos.xy));
  let C = textureLoad(colT, p, 0);
  if (C.a <= 0) { return vec4f(0); }
  let A = inO(matA, p, U.aO); let B = inO(matB, p, U.bO);
  // Normal, shine and emissive per unit of material coverage; the casting amount stays coverage-weighted.
  let nxy = select(vec2f(0), (A.rg * 2.0 - A.a) / A.a, A.a > 1e-4);
  let N = vec3f(nxy, sqrt(max(1.0 - dot(nxy, nxy), 0.0)));
  let shine = select(0.0, A.b / A.a, A.a > 1e-4);
  let e = select(0.0, clamp(B.r / B.a, 0.0, 1.0), B.a > 1e-4);
  let recvIn = B.g > 0.02;
  // How much of this pixel's material is the caster (its casting amount per unit of material coverage).
  let onCaster = select(1.0, clamp(B.g / B.a, 0.0, 1.0), B.a > 1e-4);
  let P = vec3f(vec2f(p) + 0.5 + U.size.zw, select(0.0, topOf(B), recvIn));
  let albedo = s2l(C.rgb / C.a);
  // A caster's outline pixel is partly the caster and partly what lies below it, which the caster can
  // shadow. Each light's visibility is taken at both heights and mixed by each part's share of the
  // pixel's colour (per channel), with the two colours read from the most and least covered of the
  // eight neighbours. Shading the whole pixel at the caster's height lit the part below where its
  // neighbours are in shadow: bright flecks along a figure's shadowed side.
  let edge = recvIn && onCaster < 0.98;
  var share = vec3f(1);
  if (edge) {
    var hi = B.g; var lo = B.g; var cHi = albedo; var cLo = albedo;
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        let q = p + vec2i(dx, dy);
        let g = inO(matB, q, U.bO).g; let Cq = textureLoad(colT, q, 0);
        if (Cq.a <= 0) { continue; }
        if (g > hi) { hi = g; cHi = s2l(Cq.rgb / Cq.a); }
        if (g < lo) { lo = g; cLo = s2l(Cq.rgb / Cq.a); }
      }
    }
    let a = onCaster * cHi; let b = (1.0 - onCaster) * cLo;
    share = select(vec3f(onCaster), a / (a + b), a + b > vec3f(1e-4));
  }
  var sum = U.ambient.rgb; var spec = vec3f(0);
  for (var k = 0u; k < u32(U.misc.x); k++) {
    let li = lights[k]; let kind = u32(li.pos.w);
    var Ld: vec3f; var Lp: vec3f; var att = li.col.w;
    if (kind == 2u) {
      Ld = normalize(vec3f(-cos(li.p.y), -sin(li.p.y), li.p.w));
      let far = clamp(U.misc.w / max(li.p.w, 0.02) + 4.0 * U.misc.z, 4.0, 4000.0);
      Lp = P + Ld * (far / max(length(Ld.xy), 1e-3));
    } else {
      Lp = li.pos.xyz; let Lv = Lp - P; let d = length(Lv);
      Ld = Lv / max(d, 1e-4); let x = d / li.p.x;
      let win = clamp(1.0 - x * x * x * x, 0.0, 1.0); att *= win * win / (1.0 + 6.0 * x * x);
      // A spot's cone fades from 0.75 to 1.25 of its half-angle; a cone of π or more lights every way.
      if (kind == 1u && li.p.z < 3.14159265) {
        let ca = dot(normalize(P.xy - Lp.xy), vec2f(cos(li.p.y), sin(li.p.y)));
        att *= smoothstep(cos(min(li.p.z * 1.25, 3.14159265)), cos(li.p.z * 0.75), ca);
      }
    }
    let ndl = max(dot(N, Ld), 0.0);
    if (att * ndl < 1e-4) { continue; }
    var vis = vec3f(1);
    if (U.ambient.w > 0.5) {
      let top = shadow(P, Lp, recvIn);
      vis = vec3f(top);
      if (edge) { vis = mix(vec3f(shadow(vec3f(P.xy, 0.0), Lp, false)), vis, share); }
    }
    sum += li.col.rgb * att * ndl * vis;
    let Hv = normalize(Ld + vec3f(0, 0, 1));
    spec += li.col.rgb * att * vis * shine * pow(max(dot(N, Hv), 0.0), 6.0 + 70.0 * shine);
  }
  // Emissive light passes as it is; only the lit part takes exposure and the tone curve.
  let lit = (albedo * sum + spec * 0.6) * U.tone.x;
  let shaded = (1.0 - e) * vec3f(tone(lit.r), tone(lit.g), tone(lit.b)) + e * albedo;
  return vec4f(l2s(clamp(shaded, vec3f(0), vec3f(1))) * C.a, C.a);
}
`;

export const BEVEL_WGSL = /* wgsl */ `
struct BU { size: vec4f, region: vec4f, p: vec4f };
@group(0) @binding(0) var<uniform> U: BU;
@group(0) @binding(1) var covT: texture_2d<f32>;
@group(0) @binding(2) var blurT: texture_2d<f32>;
${QUAD}
fn h(p: vec2i) -> f32 {
  let t = clamp(2.0 * inO(blurT, p, vec4f(0, 0, U.region.zw)).a - 1.0, 0.0, 1.0);
  return U.p.x * sqrt(1.0 - (1.0 - t) * (1.0 - t));
}
@fragment fn bevel(i: VOut) -> @location(0) vec4f {
  let p = vec2i(floor(i.pos.xy));
  let a = inO(covT, p, vec4f(0, 0, U.region.zw)).a;
  if (a <= 0) { return vec4f(0); }
  let dx = 0.5 * (h(p + vec2i(1, 0)) - h(p - vec2i(1, 0)));
  let dy = 0.5 * (h(p + vec2i(0, 1)) - h(p - vec2i(0, 1)));
  let n = normalize(vec3f(-dx, -dy, 1.0));
  return vec4f((n.xy * 0.5 + 0.5) * a, U.p.y * a, a);
}
`;
