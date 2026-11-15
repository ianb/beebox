// WGSL for the mark atlas (Stage 3 brushes probe): each brushed mark's dabs and
// bristle runs accumulate in its slot with premultiplied source-over, as the
// Skia scratch layer does, so overlaps inside one mark build tone. Dabs are
// instanced quads with an analytic hard or soft tip; bristle runs are mitred
// strips whose coverage across the run is the exact box-filtered width. A
// fragment outside its slot is discarded, so a mark cut to what can be seen
// never spills into a neighbour.
export const MARK_WGSL = /* wgsl */ `
struct U { size: vec4f };
@group(0) @binding(0) var<uniform> u: U;
fn ndc(p: vec2f) -> vec4f { return vec4f(p.x / u.size.x * 2.0 - 1.0, 1.0 - p.y / u.size.y * 2.0, 0.0, 1.0); }
fn inSlot(p: vec2f, s: vec4f) -> bool { return p.x >= s.x && p.y >= s.y && p.x < s.z && p.y < s.w; }

struct DabOut {
  @builtin(position) pos: vec4f,
  @location(0) @interpolate(flat) c: vec4f,
  @location(1) @interpolate(flat) k: vec4f,
  @location(2) @interpolate(flat) slot: vec4f,
};
// c: x, y, radius, alpha. k: soft, r, g, b.
@vertex fn dabVs(@builtin(vertex_index) vi: u32, @location(0) c: vec4f, @location(1) k: vec4f, @location(2) slot: vec4f) -> DabOut {
  var corners = array(vec2f(-1,-1), vec2f(1,-1), vec2f(-1,1), vec2f(-1,1), vec2f(1,-1), vec2f(1,1));
  var o: DabOut;
  o.pos = ndc(c.xy + corners[vi] * (c.z + 1.0)); o.c = c; o.k = k; o.slot = slot;
  return o;
}
@fragment fn dabFs(i: DabOut) -> @location(0) vec4f {
  if (!inSlot(i.pos.xy, i.slot)) { discard; }
  let d = distance(i.pos.xy, i.c.xy);
  let r = i.c.z;
  var cov: f32;
  if (i.k.x > 0.5) { cov = clamp(1.0 - d / r, 0.0, 1.0); }
  else { cov = clamp(r - d + 0.5, 0.0, 1.0) * min(1.0, 3.14159265 * r * r); }
  let a = i.c.w * cov;
  return vec4f(i.k.yzw * a, a);
}

struct RunOut {
  @builtin(position) pos: vec4f,
  @location(0) uh: vec2f,
  @location(1) @interpolate(flat) c: vec4f,
  @location(2) @interpolate(flat) slot: vec4f,
};
// uh: the signed distance across the run, and its half width. c: r, g, b, alpha.
@vertex fn runVs(@location(0) p: vec2f, @location(1) uh: vec2f, @location(2) c: vec4f, @location(3) slot: vec4f) -> RunOut {
  var o: RunOut; o.pos = ndc(p); o.uh = uh; o.c = c; o.slot = slot; return o;
}
@fragment fn runFs(i: RunOut) -> @location(0) vec4f {
  if (!inSlot(i.pos.xy, i.slot)) { discard; }
  let u = i.uh.x; let hw = i.uh.y;
  let cov = max(0.0, min(u + 0.5, hw) - max(u - 0.5, -hw));
  let a = i.c.w * cov;
  return vec4f(i.c.rgb * a, a);
}
`;
