// WGSL for group and shape effects, ported from the Stage 3 compositing probe.
// Each pass draws one quad over a layer's valid region (v[0], in a texture of
// size v[9]); reads stay inside that region.
// - fxMatrix: colour adjustments one by one, clamped after each (CSS filter definitions).
// - fxBlur: one direction of a separable blur with Skia's kernel (three boxes).
// - fxCombine: the effected layer over its shadow over its glow (R5).

export const FX_WGSL = /* wgsl */ `
struct Fx { v: array<vec4f, 10> };
@group(0) @binding(0) var<storage, read> fx: array<Fx>;
@group(0) @binding(1) var<storage, read> kern: array<f32>;
@group(1) @binding(0) var t0: texture_2d<f32>;
@group(1) @binding(1) var t1: texture_2d<f32>;
@group(1) @binding(2) var t2: texture_2d<f32>;
struct FOut { @builtin(position) pos: vec4f, @location(0) @interpolate(flat) id: u32 };
@vertex fn fxVs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> FOut {
  let f = fx[ii];
  var c = array(vec2f(0,0), vec2f(1,0), vec2f(0,1), vec2f(0,1), vec2f(1,0), vec2f(1,1));
  let p = (f.v[0].xy + c[vi] * f.v[0].zw) / f.v[9].xy;
  var o: FOut; o.pos = vec4f(p.x * 2 - 1, 1 - p.y * 2, 0, 1); o.id = ii; return o;
}
fn tl(t: texture_2d<f32>, p: vec2i, slot: vec4f) -> vec4f {
  let q = vec2f(p);
  if (q.x < slot.x || q.y < slot.y || q.x >= slot.x + slot.z || q.y >= slot.y + slot.w) { return vec4f(0); }
  return textureLoad(t, p, 0);
}
@fragment fn fxBlur(i: FOut) -> @location(0) vec4f {
  let f = fx[i.id]; let p = vec2i(floor(i.pos.xy)); let dir = vec2i(f.v[1].xy);
  let k0 = u32(f.v[1].z); let r = i32(f.v[1].w);
  var acc = vec4f(0);
  for (var j = -r; j <= r; j++) { acc += kern[k0 + u32(abs(j))] * tl(t0, p + dir * j, f.v[0]); }
  return acc;
}
fn adjust(kind: u32, v: f32, c: vec3f) -> vec3f {
  switch kind {
    case 0u: {
      let a = radians(v); let co = cos(a); let si = sin(a);
      let m = mat3x3f(
        vec3f(0.213 + co * 0.787 - si * 0.213, 0.213 - co * 0.213 + si * 0.143, 0.213 - co * 0.213 - si * 0.787),
        vec3f(0.715 - co * 0.715 - si * 0.715, 0.715 + co * 0.285 + si * 0.140, 0.715 - co * 0.715 + si * 0.715),
        vec3f(0.072 - co * 0.072 + si * 0.928, 0.072 - co * 0.072 - si * 0.283, 0.072 + co * 0.928 + si * 0.072));
      return m * c;
    }
    case 1u: {
      let s = v;
      let m = mat3x3f(vec3f(0.213 + 0.787 * s, 0.213 - 0.213 * s, 0.213 - 0.213 * s), vec3f(0.715 - 0.715 * s, 0.715 + 0.285 * s, 0.715 - 0.715 * s), vec3f(0.072 - 0.072 * s, 0.072 - 0.072 * s, 0.072 + 0.928 * s));
      return m * c;
    }
    case 2u: { return c * v; }
    case 3u: { return c * v + (0.5 - 0.5 * v); }
    case 4u: {
      let g = 1 - v;
      let m = mat3x3f(vec3f(0.2126 + 0.7874 * g, 0.2126 - 0.2126 * g, 0.2126 - 0.2126 * g), vec3f(0.7152 - 0.7152 * g, 0.7152 + 0.2848 * g, 0.7152 - 0.7152 * g), vec3f(0.0722 - 0.0722 * g, 0.0722 - 0.0722 * g, 0.0722 + 0.9278 * g));
      return m * c;
    }
    case 5u: {
      let g = 1 - v;
      let m = mat3x3f(vec3f(0.393 + 0.607 * g, 0.349 - 0.349 * g, 0.272 - 0.272 * g), vec3f(0.769 - 0.769 * g, 0.686 + 0.314 * g, 0.534 - 0.534 * g), vec3f(0.189 - 0.189 * g, 0.168 - 0.168 * g, 0.131 + 0.869 * g));
      return m * c;
    }
    default: { return v + c * (1 - 2 * v); }
  }
}
@fragment fn fxMatrix(i: FOut) -> @location(0) vec4f {
  let f = fx[i.id]; let s = textureLoad(t0, vec2i(floor(i.pos.xy)), 0);
  if (s.a <= 0) { return vec4f(0); }
  var c = s.rgb / s.a;
  let n = u32(f.v[1].x);
  for (var j = 0u; j < n; j++) { c = clamp(adjust(u32(f.v[2 + j].x), f.v[2 + j].y, c), vec3f(0), vec3f(1)); }
  return vec4f(c * s.a, s.a);
}
// t0 = the effected layer, t1 = the blurred shadow source, t2 = the blurred glow source.
// v[1] = (has shadow, has glow, shadow dx, shadow dy), v[2] = shadow colour, v[3] = glow colour, v[4].x = glow passes.
@fragment fn fxCombine(i: FOut) -> @location(0) vec4f {
  let f = fx[i.id]; let p = vec2i(floor(i.pos.xy));
  let E = textureLoad(t0, p, 0);
  var below = vec4f(0);
  if (f.v[1].y > 0) { let ga = textureLoad(t2, p, 0).a; below = f.v[3] * (1 - pow(1 - ga, f.v[4].x)); }
  if (f.v[1].x > 0) { let sa = tl(t1, p - vec2i(f.v[1].zw), f.v[0]).a; let sh = f.v[2] * sa; below = sh + below * (1 - sh.a); }
  return E + below * (1 - E.a);
}
`;
