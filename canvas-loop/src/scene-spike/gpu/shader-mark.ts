// WGSL for the mark atlas (Stage 3 brushes probe): each brushed mark's dabs and
// bristle runs accumulate in its slot with premultiplied source-over, as the
// Skia scratch layer does, so overlaps inside one mark build tone. Dabs are
// instanced quads with an analytic hard or soft tip; bristle runs are mitred
// strips whose coverage across the run is the exact box-filtered width. A
// fragment outside its slot is discarded, so a mark cut to what can be seen
// never spills into a neighbour. Tips and distances are computed in the mark's
// own pixels (the fragment's page pixel less the slot corner), so a mark looks
// the same wherever it is packed.
export const MARK_WGSL = /* wgsl */ `
struct U { size: vec4f };
@group(0) @binding(0) var<uniform> u: U;
fn ndc(p: vec2f) -> vec4f { return vec4f(p.x / u.size.x * 2.0 - 1.0, 1.0 - p.y / u.size.y * 2.0, 0.0, 1.0); }
fn inSlot(p: vec2f, s: vec4f) -> bool { return p.x >= s.x && p.y >= s.y && p.x < s.z && p.y < s.w; }
// The pixel centre in the mark's own pixels: page pixel less the slot corner, in integers,
// so no compiler reassociation can mix the slot into the arithmetic that follows.
fn local(pos: vec2f, s: vec4f) -> vec2f { return vec2f(vec2i(floor(pos)) - vec2i(s.xy)) + 0.5; }

struct DabOut {
  @builtin(position) pos: vec4f,
  @location(0) @interpolate(flat) c: vec4f,
  @location(1) @interpolate(flat) k: vec4f,
  @location(2) @interpolate(flat) slot: vec4f,
};
// c: x, y (in the mark's pixels), radius, alpha. k: soft, r, g, b. slot: its rectangle on the page.
@vertex fn dabVs(@builtin(vertex_index) vi: u32, @location(0) c: vec4f, @location(1) k: vec4f, @location(2) slot: vec4f) -> DabOut {
  var corners = array(vec2f(-1,-1), vec2f(1,-1), vec2f(-1,1), vec2f(-1,1), vec2f(1,-1), vec2f(1,1));
  var o: DabOut;
  o.pos = ndc(c.xy + slot.xy + corners[vi] * (c.z + 1.0)); o.c = c; o.k = k; o.slot = slot;
  return o;
}
@fragment fn dabFs(i: DabOut) -> @location(0) vec4f {
  if (!inSlot(i.pos.xy, i.slot)) { discard; }
  let d = distance(local(i.pos.xy, i.slot), i.c.xy);
  let r = i.c.z;
  var cov: f32;
  if (i.k.x > 0.5) { cov = clamp(1.0 - d / r, 0.0, 1.0); }
  else { cov = clamp(r - d + 0.5, 0.0, 1.0) * min(1.0, 3.14159265 * r * r); }
  let a = i.c.w * cov;
  return vec4f(i.k.yzw * a, a);
}

struct RunOut {
  @builtin(position) pos: vec4f,
  @location(0) @interpolate(flat) ph: vec4f,
  @location(1) @interpolate(flat) c: vec4f,
  @location(2) @interpolate(flat) slot: vec4f,
  @location(3) @interpolate(flat) ab: vec4f,
  @location(4) @interpolate(flat) cu: vec4f,
  @location(5) @interpolate(flat) uc: vec4f,
};
// ph: the vertex on the page, and the run's half width. c: r, g, b, alpha. ab, cu.xy: the
// triangle's corners in the mark's pixels; cu.zw, uc.x: their signed distances across.
@vertex fn runVs(@location(0) ph: vec4f, @location(1) c: vec4f, @location(2) slot: vec4f, @location(3) ab: vec4f, @location(4) cu: vec4f, @location(5) uc: vec4f) -> RunOut {
  var o: RunOut; o.pos = ndc(ph.xy); o.ph = ph; o.c = c; o.slot = slot; o.ab = ab; o.cu = cu; o.uc = uc; return o;
}
fn cross2(a: vec2f, b: vec2f) -> f32 { return a.x * b.y - a.y * b.x; }
@fragment fn runFs(i: RunOut) -> @location(0) vec4f {
  if (!inSlot(i.pos.xy, i.slot)) { discard; }
  // The signed distance across at this pixel: the triangle's affine u, from the mark's own pixels.
  let q = local(i.pos.xy, i.slot);
  let pa = i.ab.xy; let pb = i.ab.zw; let pc = i.cu.xy;
  let area = cross2(pb - pa, pc - pa);
  if (abs(area) < 1e-12) { discard; }
  let la = cross2(pb - q, pc - q) / area; let lb = cross2(pc - q, pa - q) / area;
  let u = la * i.cu.z + lb * i.cu.w + (1.0 - la - lb) * i.uc.x;
  let hw = i.ph.z;
  let cov = max(0.0, min(u + 0.5, hw) - max(u - 0.5, -hw));
  let a = i.c.w * cov;
  return vec4f(i.c.rgb * a, a);
}
`;
