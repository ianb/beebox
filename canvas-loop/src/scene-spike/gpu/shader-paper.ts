// The paper texture computed per pixel in WGSL: a port of core/brush/paper.ts
// (`makePaper`) with the same 32-bit integer hash (core/brush/random.ts), so at
// whole paper pixels it equals today's paper layer. `q` is a paper pixel; the
// result is the valley alpha a grainy brush loses pigment to.
export const PAPER_WGSL = /* wgsl */ `
fn mix32(v0: u32) -> u32 {
  var x = v0;
  x ^= x >> 16u; x *= 0x7feb352du; x ^= x >> 15u; x *= 0x846ca68bu; x ^= x >> 16u;
  return x;
}
fn rnd(seed: u32, ch: u32, idx: u32) -> f32 {
  return f32(mix32(seed ^ mix32(ch * 0x9e3779b1u + mix32(idx)))) / 4294967296.0;
}
fn lattice(seed: u32, ch: u32, x: i32, y: i32) -> f32 {
  return rnd(seed, ch, (bitcast<u32>(x) * 73856093u) ^ (bitcast<u32>(y) * 19349663u));
}
fn noise2(seed: u32, ch: u32, p: vec2f) -> f32 {
  let i = floor(p); let f = p - i;
  let s = f * f * (3.0 - 2.0 * f);
  let ix = i32(i.x); let iy = i32(i.y);
  let a = lattice(seed, ch, ix, iy); let b = lattice(seed, ch, ix + 1, iy);
  let d = lattice(seed, ch, ix, iy + 1); let e = lattice(seed, ch, ix + 1, iy + 1);
  return a + (b - a) * s.x + (d - a) * s.y + (a - b - d + e) * s.x * s.y;
}
// paper: (scale, lo, hi) in paper pixels; seed; width = the row width of the per-pixel term.
fn paperAt(paper: vec3f, seed: u32, width: i32, q: vec2i) -> f32 {
  let p = vec2f(q);
  let tooth = 0.55 * noise2(seed, 1u, p / paper.x)
            + 0.3 * noise2(seed, 2u, p / (paper.x * 0.45))
            + 0.15 * rnd(seed, 3u, bitcast<u32>(q.y * width + q.x));
  let f = clamp((tooth - paper.y) / (paper.z - paper.y), 0.0, 1.0);
  return round(255.0 * f * f * (3.0 - 2.0 * f)) / 255.0;
}
`;
