// Smudge and wet paint as one compute dispatch (Stage 3 brushes probe): the
// region the stroke reaches is copied out of the target layer, one workgroup
// runs the dabs in order (pick up, then lay down through the tip, barriers
// between), and the result is copied back, kept only inside the clip. The
// arithmetic is core/brush/render/mark/smear.ts's, in float. Coordinates are
// texels of the target layer; pick-up near its edge reads the nearest patch
// inside it, as today. The clip is read from its box on its clip page. The
// dabs come from the brush pass's `smears` entry (`smearDabsWgsl`, below),
// which writes them in this layout from the stroke's GPU samples.
import { PAPER_WGSL } from "./shader-paper.js";

/**
 * The `smears` entry of shader-brush.ts's instances module (chunk 8): sample i
 * of a smudge or wet stroke as dab i of the layout `Dab` below (x, y, radius,
 * alpha, first of its contour, then zeros; `floats` each), in the target
 * layer's texels (the contour's offset holds the layer's corner): expand.ts's
 * CPU dab, placed as marks.ts placed it. It uses that module's prelude,
 * samples, output and `placed`.
 */
export function smearDabsWgsl(a: { floats: number; workgroup: number }): string {
  return /* wgsl */ `
@compute @workgroup_size(${a.workgroup}) fn smears(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= u.count) { return; }
  let i = u.first + gid.x;
  let s = smp[i - u.base];
  let c = s.contour - u.cbase;
  let st = cw(c, 13u);
  let at = placed(st, s);
  let o = (i - u.base) * ${a.floats}u;
  dab[o] = at.x; dab[o + 1u] = at.y;
  dab[o + 2u] = (sf(st, 10u) / 2.0) * (1.0 - sf(st, 12u) * (1.0 - s.p)) * sf(st, 11u);
  dab[o + 3u] = sf(st, 13u) * (1.0 - sf(st, 14u) * (1.0 - s.p));
  dab[o + 4u] = select(0.0, 1.0, i == cw(c, 2u));
  for (var w = 5u; w < ${a.floats}u; w++) { dab[o + w] = 0.0; }
}
`;
}

export const SMEAR_WGSL = /* wgsl */ `
${PAPER_WGSL}
struct U {
  region: vec4i, ext: vec2i, rowPx: u32, dabCount: u32,
  size: i32, soft: u32, wet: u32, clip: u32,
  keep: f32, color: f32, opacity: f32, grain: f32,
  paint: vec4f,
  pap0: vec4f, pap1: vec4f,
  paper: vec4f,
  seed: u32, pwidth: i32, origin: vec2f,
  clipBox: vec4i, clipSlot: vec2i, pad: vec2i,
};
struct Dab { x: f32, y: f32, r: f32, a: f32, first: f32, p0: f32, p1: f32, p2: f32, p3: f32, p4: f32, p5: f32, p6: f32 };
@group(0) @binding(0) var<storage, read_write> pix: array<u32>;
@group(0) @binding(1) var<storage, read_write> fb: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> before: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> load: array<vec4f>;
@group(0) @binding(4) var<storage, read> dabs: array<Dab>;
@group(0) @binding(5) var<uniform> u: U;
@group(0) @binding(6) var clipT: texture_2d<f32>;
fn ridx(x: i32, y: i32) -> u32 { return u32((y - u.region.y) * u.region.z + (x - u.region.x)); }
fn paperOf(x: i32, y: i32) -> f32 {
  let p = vec2f(f32(x), f32(y)) + u.origin + 0.5;
  let q = vec2i(floor(vec2f(u.pap0.x * p.x + u.pap0.z * p.y + u.pap1.x, u.pap0.y * p.x + u.pap0.w * p.y + u.pap1.y)));
  return paperAt(u.paper.xyz, u.seed, u.pwidth, q);
}
@compute @workgroup_size(256) fn smear(@builtin(local_invocation_index) lid: u32) {
  let n = u32(u.region.z * u.region.w);
  for (var i = lid; i < n; i += 256u) {
    let c = unpack4x8unorm(pix[(i / u32(u.region.z)) * u.rowPx + i % u32(u.region.z)]);
    fb[i] = c;
    if (u.wet == 1u) { before[i] = c; }
  }
  storageBarrier(); workgroupBarrier();
  let size = u.size; let half = f32(size) / 2.0; let m = u32(size * size);
  let paintP = vec4f(u.paint.rgb * u.paint.a, u.paint.a);
  for (var k = 0u; k < u.dabCount; k++) {
    let d = dabs[k];
    let keep = select(u.keep, 0.0, d.first > 0.5);
    let left = clamp(i32(round(d.x - half)), 0, max(0, u.ext.x - size));
    let top = clamp(i32(round(d.y - half)), 0, max(0, u.ext.y - size));
    for (var i = lid; i < m; i += 256u) {
      let px = left + i32(i % u32(size)); let py = top + i32(i / u32(size));
      var src: vec4f;
      if (px >= u.ext.x || py >= u.ext.y) { src = vec4f(0); }
      else if (u.wet == 1u) { src = before[ridx(px, py)]; } else { src = fb[ridx(px, py)]; }
      var l = select(load[i], vec4f(0.0), d.first > 0.5) * keep + src * (1.0 - keep);
      if (u.color > 0.0) { l = l * (1.0 - u.color) + paintP * u.color; }
      load[i] = l;
    }
    storageBarrier(); workgroupBarrier();
    if (d.r > 0.05 && d.a > 0.0) {
      let l2 = i32(round(d.x - half)); let t2 = i32(round(d.y - half));
      let cx = d.x - f32(l2); let cy = d.y - f32(t2);
      for (var i = lid; i < m; i += 256u) {
        let lx = i32(i % u32(size)); let ly = i32(i / u32(size));
        let px = l2 + lx; let py = t2 + ly;
        if (px < u.region.x || py < u.region.y || px >= u.region.x + u.region.z || py >= u.region.y + u.region.w) { continue; }
        let dist = distance(vec2f(f32(lx) + 0.5, f32(ly) + 0.5), vec2f(cx, cy));
        var mask: f32;
        if (u.soft == 1u) { mask = clamp(1.0 - dist / d.r, 0.0, 1.0); }
        else { let t0 = max(0.0, (d.r - 1.0) / d.r); mask = clamp((1.0 - dist / d.r) / max(1e-6, 1.0 - t0), 0.0, 1.0); }
        if (u.grain > 0.0) { mask = mask * (1.0 - u.grain * paperOf(px, py)); }
        let kk = mask * d.a * u.opacity;
        let j = ridx(px, py);
        fb[j] = fb[j] * (1.0 - kk) + load[i] * kk;
      }
    }
    storageBarrier(); workgroupBarrier();
  }
  for (var i = lid; i < n; i += 256u) {
    let x = i % u32(u.region.z); let y = i / u32(u.region.z);
    let at = y * u.rowPx + x;
    var c = 1.0;
    if (u.clip == 1u) {
      let q = vec2i(i32(x) + u.region.x, i32(y) + u.region.y) - u.clipBox.xy;
      c = select(textureLoad(clipT, q + u.clipSlot, 0).r, 0.0, any(q < vec2i(0)) || any(q >= u.clipBox.zw));
    }
    pix[at] = pack4x8unorm(clamp(mix(unpack4x8unorm(pix[at]), fb[i], c), vec4f(0.0), vec4f(1.0)));
  }
}
`;
