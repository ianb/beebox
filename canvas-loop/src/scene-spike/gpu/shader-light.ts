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
//   Shadows: every caster stands `casterHeight` above the page; a pixel on a
//   caster sits on top of it, so a caster never shadows itself, and samples
//   in the caster that holds the light are skipped. Within one caster the
//   strongest block counts (not the product), so a caster at half alpha
//   blocks half.
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
  size: vec4f,    // the target texture's size
  region: vec4f,  // the colour layer's valid texels
  aO: vec4f,      // material layer 0: where its texel 0 sits in this layer, and its size
  bO: vec4f,      // material layer 1
  ambient: vec4f, // rgb; shadows (0 none, 1 hard, 2 soft)
  misc: vec4f,    // light count, caster height (device px), pixel ratio
};
// pos: x, y (texels), height (device px), kind (0 point, 1 spot, 2 directional)
// col: rgb, energy; p: reach (device px), direction (radians), cone half-angle, directional slope
struct Lt { pos: vec4f, col: vec4f, p: vec4f };
@group(0) @binding(0) var<uniform> U: LU;
@group(0) @binding(1) var<storage, read> lights: array<Lt>;
@group(0) @binding(2) var colT: texture_2d<f32>;
@group(0) @binding(3) var matA: texture_2d<f32>;
@group(0) @binding(4) var matB: texture_2d<f32>;
${QUAD}
fn pcg(v: u32) -> u32 { let s = v * 747796405u + 2891336453u; let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u; return (w >> 22u) ^ w; }
fn jitter(p: vec2i) -> f32 { return f32(pcg(bitcast<u32>(p.x) ^ pcg(bitcast<u32>(p.y) ^ 77u)) >> 8u) / 16777216.0; }
fn s2l(c: vec3f) -> vec3f { return select(pow((c + 0.055) / 1.055, vec3f(2.4)), c / 12.92, c <= vec3f(0.04045)); }
fn l2s(c: vec3f) -> vec3f { return select(1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055, c * 12.92, c <= vec3f(0.0031308)); }
fn casts(p: vec2i) -> f32 { return inO(matB, p, U.bO).g; }

// How much of the light at L reaches P: 1 unblocked, 0 in full shadow.
fn shadow(P: vec3f, L: vec3f, recvIn: bool) -> f32 {
  let D = L.xy - P.xy; let len = length(D);
  let ratio = U.misc.z; let H = U.misc.y;
  let n = clamp(i32(len / (2.0 * ratio)), 2, 64);
  let j = jitter(vec2i(floor(P.xy)));
  let lightIn = casts(vec2i(floor(L.xy))) > 0.02;
  var vis = 1.0; var run = 1.0; var inSelf = recvIn;
  for (var i = 0; i < n; i++) {
    let t = (f32(i) + j) / f32(n);
    let c = casts(vec2i(floor(P.xy + D * t)));
    if (c <= 0.02) { inSelf = false; vis *= run; run = 1.0; continue; }
    if (inSelf) { continue; }
    let soft = select(1.0, 1.0 + 0.03 * len * t / ratio, U.ambient.w > 1.5) * ratio;
    run = min(run, 1.0 - c * smoothstep(0.0, soft, H - mix(P.z, L.z, t)));
  }
  if (!lightIn) { vis *= run; }
  return vis;
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
  let P = vec3f(vec2f(p) + 0.5, select(0.0, U.misc.y, recvIn));
  let albedo = s2l(C.rgb / C.a);
  var sum = U.ambient.rgb; var spec = vec3f(0);
  for (var k = 0u; k < u32(U.misc.x); k++) {
    let li = lights[k]; let kind = u32(li.pos.w);
    var Ld: vec3f; var Lp: vec3f; var att = li.col.w;
    if (kind == 2u) {
      Ld = normalize(vec3f(-cos(li.p.y), -sin(li.p.y), li.p.w));
      let far = clamp(U.misc.y / max(li.p.w, 0.02) + 4.0 * U.misc.z, 4.0, 4000.0);
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
    var vis = 1.0;
    if (U.ambient.w > 0.5) { vis = shadow(P, Lp, recvIn); }
    sum += li.col.rgb * att * ndl * vis;
    let Hv = normalize(Ld + vec3f(0, 0, 1));
    spec += li.col.rgb * att * vis * shine * pow(max(dot(N, Hv), 0.0), 6.0 + 70.0 * shine);
  }
  let lin = albedo * ((1.0 - e) * sum + e) + spec * 0.6 * (1.0 - e);
  return vec4f(l2s(clamp(lin, vec3f(0), vec3f(1))) * C.a, C.a);
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
