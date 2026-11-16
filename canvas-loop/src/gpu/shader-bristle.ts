// The `bristles` entry of shader-brush.ts's instances module (canvas-loop-gpu-brushes.subplan.md,
// chunk 7): one thread per unit, a contour and one of its bristles, walking the
// contour's samples and writing each run as a mitred strip; a port of the CPU
// expansion's `paintBristle` and the mark atlas's `runStrip`, both deleted in
// chunk 9 (test/fixtures/brush-golden/ holds their numbers). It uses that module's prelude
// (the uniform, records, hash), its samples (binding 2) and output (binding 3),
// `placed`'s stroke-record readers and `shiftColour`; its units are binding 1.

/** Floats per bristle run vertex (mark-atlas.ts's run layout), and the vertices per sample segment of one bristle (two triangles). */
export const RUN_FLOATS = 24;
export const RUN_VERTICES = 6;
/** u32 words per bristle unit (one thread of `bristles`): its contour in the input, its bristle, its first vertex in the frame. */
export const UNIT_WORDS = 4;

/**
 * Threads per workgroup of `bristles`. A frame has few bristles (the Stage 3
 * stress frame 882), each a long sequential walk, so small workgroups
 * spread them over more of the GPU's cores: on this Mac the stress frame's
 * brush pass took 2.7 ms at 64 and 0.85 ms at 4. A batch holds at most
 * `limit / (6 × RUN_FLOATS × 4)` units (116,508 at 64 MiB), within 65,535
 * workgroups of 4.
 */
export const BRISTLES_WORKGROUP = 4;

/** The entry's WGSL. */
export const BRISTLES_WGSL = /* wgsl */ `
// The \`bristles\` entry: one thread per unit (a contour and one of its bristles): the bristle
// (offset, strength, thickness, where it runs dry), its points along the samples, runs broken
// where the level changes (the boundary point shared, with the earlier run's level), each run of
// two or more points and a level above 0 stroked at its average width, as a mitred strip.
// Segment j of the contour's samples is written as run vertices 6j to 6j + 5 of the unit's
// range; a segment in a run that is not drawn is all zeros.
@group(0) @binding(1) var<storage, read> units: array<vec4u>;
const LEVELS = 5.0;
const DRIFT = 0.12;
fn smooth01(e0: f32, e1: f32, x: f32) -> f32 {
  let f = min(1.0, max(0.0, (x - e0) / (e1 - e0)));
  return f * f * (3.0 - 2.0 * f);
}
// Smooth 1-D value noise in [-1, 1] at x ≥ 0 on \`ch\`, no wrap.
fn noiseCh(seed: u32, ch: u32, x: f32) -> f32 {
  let i = floor(x);
  let f = x - i;
  let a = rand1(seed, ch, u32(i));
  let b = rand1(seed, ch, u32(i) + 1u);
  let k = f * f * (3.0 - 2.0 * f);
  return (a + (b - a) * k) * 2.0 - 1.0;
}
struct Bristle { offset: f32, strength: f32, thickness: f32, dryAt: f32 };
// A bristle point: its position mapped by the stroke's linear part (relative to the contour's
// origin; the contour's offset is added when written), its level, and its width (brush space).
struct BPoint { p: vec2f, level: f32, width: f32 };
struct Walk { st: u32, s0: u32, seed: u32, b: u32, width: f32, br: Bristle };
// Where a unit writes: its first vertex in this batch's output, the contour's offset, the brush flow.
struct RunAt { vo: u32, off: vec2f, flow: f32 };
fn bpoint(w: Walk, j: u32) -> BPoint {
  let c = smp[w.s0 + j];
  let reach = abs(w.br.offset) * 0.7;
  let contact = smooth01(reach - 0.15, reach + 0.1, c.p);
  let dry = 1.0 - smooth01(w.br.dryAt * 0.7, w.br.dryAt, c.s);
  var gap = 1.0;
  if (dry < 1.0 && rand1(w.seed, 30u + w.b, u32(floor(c.s / 2.5))) > dry) { gap = 0.0; }
  let load = 0.7 + 0.3 * noiseCh(w.seed, 40u + w.b, c.s / 18.0);
  let alpha = contact * dry * gap * w.br.strength * load;
  let drift = DRIFT * noiseCh(w.seed, 60u + w.b, c.s / 45.0);
  let spread = ((w.br.offset + drift) * w.width * (0.35 + 0.65 * c.p)) / 2.0;
  let q = vec2f(c.x + c.nx * spread, c.y + c.ny * spread);
  let e = sv(w.st, 0u);
  return BPoint(vec2f(e.x * q.x + e.z * q.y, e.y * q.x + e.w * q.y), floor(alpha * LEVELS + 0.5), w.br.thickness * (0.5 + 0.5 * c.p));
}
fn lenOr1(v: vec2f) -> f32 {
  let l = length(v);
  return select(l, 1.0, l == 0.0);
}
// The strip's mitred side offset at point p, with the run's neighbours q (before) and r (after),
// \`first\` or \`last\` at a run end: the unit mitre direction times its length, \`e\` from the centre line.
fn mitre(p: vec2f, q: vec2f, r: vec2f, ends: vec2<bool>, e: f32) -> vec2f {
  var a = p - q;
  var b = r - p;
  if (ends.x) { a = b; }
  if (ends.y) { b = a; }
  let la = lenOr1(a);
  let lb = lenOr1(b);
  let n1 = vec2f(-a.y / la, a.x / la);
  let m0 = vec2f(n1.x - b.y / lb, n1.y + b.x / lb);
  let ml = lenOr1(m0);
  let m = m0 / ml;
  let k = min(2.0, 1.0 / max(0.05, m.x * n1.x + m.y * n1.y)) * e;
  return m * k;
}
fn putVertex(o: u32, v: array<f32, ${RUN_FLOATS}>) {
  var held = v;
  for (var w = 0u; w < ${RUN_FLOATS}u; w++) { dab[o + w] = held[w]; }
}
// Run [a, z] of the walk (z included), stroked at \`level\` and average width \`wavg\` (brush space),
// written at the unit's first output vertex \`vo\`.
fn emitRun(w: Walk, run: vec2u, level: f32, wavg: f32, at: RunAt) {
  let a = run.x;
  let z = run.y;
  if (z <= a) { return; }
  let vo = at.vo;
  let off = at.off;
  if (level == 0.0) {
    for (var v = vo + a * ${RUN_VERTICES}u; v < vo + z * ${RUN_VERTICES}u; v++) {
      for (var k = 0u; k < ${RUN_FLOATS}u; k++) { dab[v * ${RUN_FLOATS}u + k] = 0.0; }
    }
    return;
  }
  let hw = wavg * sf(w.st, 11u) / 2.0;
  let e = hw + 1.0;
  let slot = sv(w.st, 6u);
  let alpha = at.flow * level / LEVELS;
  let rgb = shiftedInk(w);
  var prev = bpoint(w, a).p;
  var cur = prev;
  var next = bpoint(w, a + 1u).p;
  var side = mitre(cur, prev, next, vec2<bool>(true, false), e);
  for (var i = a; i < z; i++) {
    var after = next;
    if (i + 2u <= z) { after = bpoint(w, i + 2u).p; }
    let side1 = mitre(next, cur, after, vec2<bool>(false, i + 1u == z), e);
    // The strip corners in the mark's own pixels: L_i, R_i, L_i+1, R_i+1.
    let l0 = cur + off + side;
    let r0 = cur + off - side;
    let l1 = next + off + side1;
    let r1 = next + off - side1;
    var tris = array(array(l0, r0, l1), array(l1, r0, r1));
    var us = array(vec3f(e, -e, e), vec3f(e, -e, -e));
    for (var t = 0u; t < 2u; t++) {
      var tri = tris[t];
      for (var k = 0u; k < 3u; k++) {
        let pv = tri[k];
        putVertex((vo + i * ${RUN_VERTICES}u + t * 3u + k) * ${RUN_FLOATS}u, array<f32, ${RUN_FLOATS}>(
          pv.x + slot.x, pv.y + slot.y, hw, 0.0, rgb.r, rgb.g, rgb.b, alpha, slot.x, slot.y, slot.z, slot.w,
          tri[0].x, tri[0].y, tri[1].x, tri[1].y, tri[2].x, tri[2].y, us[t].x, us[t].y, us[t].z, 0.0, 0.0, 0.0));
      }
    }
    prev = cur;
    cur = next;
    next = after;
    side = side1;
  }
}
// The bristle's colour: black coverage, or (jittered) its own colour: the paint shifted by bristle b's hue and light.
fn shiftedInk(w: Walk) -> vec3f {
  if (sf(w.st, 23u) <= 0.5) { return vec3f(0.0); }
  let hue = sf(w.st, 18u) * (2.0 * rand1(w.seed, 13u, w.b) - 1.0);
  let light = sf(w.st, 19u) * (2.0 * rand1(w.seed, 14u, w.b) - 1.0);
  return shiftColour(vec3f(sf(w.st, 20u), sf(w.st, 21u), sf(w.st, 22u)), hue, light) / 255.0;
}
@compute @workgroup_size(${BRISTLES_WORKGROUP}) fn bristles(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= u.count) { return; }
  let un = units[u.first + gid.x];
  let c = un.x;
  let b = un.y;
  let st = cw(c, 13u);
  let n = cw(c, 3u);
  let s0 = cw(c, 2u) - u.sbase;
  let seed = cw(c, 4u);
  let width = sf(st, 10u);
  let nb = sf(st, 12u);
  let spread = sf(st, 15u);
  let total = smp[s0 + n - 1u].s;
  let r1 = rand1(seed, 21u, b);
  let r2 = rand1(seed, 22u, b);
  let r3 = rand1(seed, 23u, b);
  let offset = -1.0 + (2.0 * (f32(b) + 0.5)) / nb + (spread * (r1 - 0.5) * 2.0) / nb;
  let dryAt = (sf(st, 14u) * total + width * 8.0) * (0.7 + 0.6 * r3) * (1.0 - 0.35 * abs(offset));
  let strength = 0.55 + 0.45 * rand1(seed, 24u, b);
  let br = Bristle(offset, strength, (width / nb) * 2.2 * (1.0 + spread * (r2 - 0.5)), dryAt);
  let w = Walk(st, s0, seed, b, width, br);
  let at = RunAt(un.z - u.base, vec2f(cf(c, 14u), cf(c, 15u)), sf(st, 13u));
  var a = 0u;
  var p = bpoint(w, 0u);
  var level = p.level;
  var sum = p.width;
  for (var j = 1u; j < n; j++) {
    p = bpoint(w, j);
    if (p.level != level) {
      emitRun(w, vec2u(a, j), level, (sum + p.width) / f32(j - a + 1u), at);
      a = j;
      level = p.level;
      sum = p.width;
    } else {
      sum += p.width;
    }
  }
  emitRun(w, vec2u(a, n - 1u), level, sum / f32(n - a), at);
}
`;
