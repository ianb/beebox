// Pieces shared by the Quiet Plaza, Nursery, Reflection Chamber, Utility Closet,
// Archive Lounge and the quarters: boxes in metres, metal shelving, picture frames,
// stencilled lettering, a bare bulb, frayed wire and its sparks.
import type { Drawing, Vec2, View } from "@ianbicking/canvas-loop";
import { INK, at, blob, ellipsePts, glow, hash, mixHex, rivet, roundRectPts, stroke } from "./kit-tea.js";
import { PLANES, m } from "./sizes-tea.js";

/** A rectangle in metres: x0..x1 along the room, h0..h1 above the floor, at a depth. */
export function box(x0: number, x1: number, h0: number, h1: number, depth: number): Vec2[] {
  const [a, b] = at(x0, h0, depth), [c, d] = at(x1, h1, depth);
  return [[a, b], [c, b], [c, d], [a, d]];
}

/** A plain filled box with light and shade. */
export function slab(v: View, r: { x0: number; x1: number; h0: number; h1: number; depth: number }, a: { fill: string; seed: number; line?: number; shade?: boolean }): Drawing {
  return blob(v, box(r.x0, r.x1, r.h0, r.h1, r.depth), { fill: a.fill, light: mixHex(a.fill, "#ffffff", 0.25), dark: mixHex(a.fill, "#000000", 0.35), seed: a.seed, line: a.line ?? 2, ...(a.shade === true ? { shadeSide: "right" as const } : {}) });
}

/** Lettering in the room's hand: bold, a little rotated. */
export function stencil(v: View, text: string, p: { x: number; y: number }, a: { size?: number; colour?: string; rotate?: number; font?: string } = {}): Drawing {
  return v.at({ translate: [p.x, p.y], rotate: a.rotate ?? 0 }, v.text(text, { x: 0, y: 0 }, { size: a.size ?? 9, fill: a.colour ?? "#2a2018", align: "center", valign: "middle", style: "bold", ...(a.font === undefined ? {} : { font: a.font }) }));
}

/** Metal shelving against the wall: uprights, shelves at the given heights (metres),
 * rust if it is old. `fill(shelfIndex, x0, x1, y)` puts things on each shelf (px). */
export function shelfUnit(v: View, s: { x: number; w: number; h: number; depth?: number; shelves: readonly number[]; colour?: string; rust?: boolean; lean?: number; seed: number }, fill?: (i: number, x0: number, x1: number, y: number) => Drawing): Drawing {
  const depth = s.depth ?? PLANES.wall;
  const [fx, fy] = at(s.x, 0, depth);
  const c = s.colour ?? "#7a7e82";
  return v.at({ translate: [fx, fy], rotate: s.lean ?? 0 }, v.at({ translate: [-fx, -fy] }, ((): Drawing => {
    const drawn: Drawing[] = [];
    const x0 = m(s.x - s.w / 2), x1 = m(s.x + s.w / 2), top = fy - m(s.h);
    for (const ux of [x0, x1 - 8]) drawn.push(blob(v, [[ux, fy], [ux + 8, fy], [ux + 8, top], [ux, top]], { fill: c, dark: mixHex(c, "#000000", 0.4), seed: s.seed + ux, line: 1.8, amp: 0.6 }));
    for (const [i, sh] of s.shelves.entries()) {
      const y = fy - m(sh);
      drawn.push(fill?.(i, x0 + 10, x1 - 10, y));
      drawn.push(blob(v, [[x0 - 3, y], [x1 + 3, y], [x1 + 3, y + 7], [x0 - 3, y + 7]], { fill: mixHex(c, "#ffffff", 0.1), dark: mixHex(c, "#000000", 0.3), seed: s.seed + 40 + i, line: 1.6, amp: 0.5 }));
      drawn.push(rivet(v, x0 + 4, y + 3.5));
      drawn.push(rivet(v, x1 - 4, y + 3.5));
      if (s.rust === true) for (let k = 0; k < 3; k++) {
        const rx = x0 + hash(i, k, s.seed) * (x1 - x0);
        drawn.push(stroke(v, [[rx, y + 6], [rx + 1, y + 14 + hash(k, i, s.seed + 1) * 16]], { seed: s.seed + 60 + i * 3 + k, weight: 3, colour: "rgba(140,60,24,0.6)", amp: 0.5 }));
      }
    }
    return drawn;
  })()));
}

/** A picture frame on the wall, its middle at height h; `tilt` radians. Draws `body`
 * inside it, in a frame-centred coordinate system (0,0 the middle). */
export function frame(v: View, f: { x: number; h: number; w: number; hh: number; tilt?: number; colour?: string; seed: number }, body?: (w: number, h: number) => Drawing): Drawing {
  const [cx, cy] = at(f.x, f.h, 0);
  const w = m(f.w), h = m(f.hh);
  return v.at({ translate: [cx, cy], rotate: f.tilt ?? 0 }, [
    stroke(v, [[-w * 0.3, -h / 2], [0, -h / 2 - 16], [w * 0.3, -h / 2]], { seed: f.seed, weight: 1 }),
    blob(v, roundRectPts(-w / 2 - 6, -h / 2 - 6, w + 12, h + 12, 3), { fill: f.colour ?? "#8a6a42", seed: f.seed + 1, line: 2 }),
    blob(v, [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]], { fill: "#e8e0cc", seed: f.seed + 2, line: 1.4, amp: 0.4 }),
    body?.(w, h),
  ]);
}

/** A bare bulb on a cord from the ceiling, its glass at height h (at the sofa plane). */
export function bareBulb(v: View, x: number, h: number, ceilingH: number, swing = 0): Drawing {
  const [cx, cy] = at(x, h, PLANES.sofa);
  const [, top] = at(x, ceilingH, 0);
  const bx = cx + Math.sin(swing) * (cy - top);
  return [
    stroke(v, [[cx, top], [bx, cy - 16]], { seed: 1500 + x, weight: 1.4, amp: 0.4 }),
    blob(v, roundRectPts(bx - 5, cy - 18, 10, 9, 2), { fill: "#3a302a", seed: 1501 + x, line: 1.2, amp: 0.3 }),
    blob(v, ellipsePts(bx, cy, 8, 10), { fill: "#e8e0b8", light: "#fff8d8", seed: 1502 + x, line: 1.4, amp: 0.4 }),
  ];
}
export function bulbPoint(x: number, h: number, ceilingH: number, swing = 0): Vec2 {
  const [cx, cy] = at(x, h, PLANES.sofa);
  const [, top] = at(x, ceilingH, 0);
  return [cx + Math.sin(swing) * (cy - top), cy];
}

/** A run of old cable (px points), with a taped splice and a frayed end if asked. */
export function cable(v: View, pts: readonly Vec2[], a: { seed: number; colour?: string; weight?: number; frayAt?: number }): Drawing {
  const out: Drawing[] = [];
  out.push(stroke(v, pts, { seed: a.seed, weight: a.weight ?? 4, colour: a.colour ?? "#1c1814", amp: 1.4 }));
  const mid = pts[Math.floor(pts.length / 2)] ?? [0, 0];
  out.push(v.at({ translate: mid, rotate: 0.3 }, v.rect(-8, -5, 16, 10, { fill: "#c8a838" })));
  out.push(v.at({ translate: mid, rotate: 0.3 }, v.rect(-8, -5, 16, 10, { stroke: INK, weight: 1 })));
  if (a.frayAt !== undefined) {
    const p = pts[a.frayAt] ?? mid;
    for (let k = 0; k < 5; k++) {
      const ang = -1.2 + k * 0.5;
      out.push(stroke(v, [p, [p[0] + Math.cos(ang) * 10, p[1] + Math.sin(ang) * 10]], { seed: a.seed + 10 + k, weight: 1.2, colour: k % 2 === 0 ? "#c87a3a" : "#d8c8a8", amp: 0.4 }));
    }
  }
  return out;
}

/** Sparks jumping from a point (px): a few short bright strokes, when `on`. */
export function sparks(v: View, p: Vec2, t: number, on: boolean): Drawing {
  const out: Drawing[] = [];
  if (!on) return out;
  out.push(glow(v, p[0], p[1], { rx: 40, colour: "#bfe0ff", alpha: 0.55 }));
  for (let k = 0; k < 6; k++) {
    const ang = hash(k, t, 1501) * Math.PI * 2, len = 6 + hash(k, t, 1502) * 16;
    out.push(v.line(p[0], p[1], p[0] + Math.cos(ang) * len, p[1] + Math.sin(ang) * len * 0.7 + len * 0.3, { stroke: k % 2 === 0 ? "#fff8d0" : "#9ad0ff", weight: 1.4 }));
  }
  return out;
}

/** The thumbs-up mascot's face, at (px) with radius r: round head, grin, a thumb. */
export function mascot(v: View, p: Vec2, r: number, seed: number): Drawing {
  return [
    blob(v, ellipsePts(p[0], p[1], r, r), { fill: "#f8e0b8", seed, line: 1.2, amp: 0.3 }),
    v.circle(p[0] - r * 0.35, p[1] - r * 0.2, r * 0.1, { fill: INK }),
    v.circle(p[0] + r * 0.35, p[1] - r * 0.2, r * 0.1, { fill: INK }),
    v.arc(p[0], p[1] + r * 0.1, r * 0.5, 0.2, Math.PI - 0.2, { stroke: INK, weight: 1.2 }),
    blob(v, roundRectPts(p[0] + r * 0.9, p[1] - r * 0.3, r * 0.55, r * 0.9, r * 0.2), { fill: "#f8e0b8", seed: seed + 1, line: 1, amp: 0.2 }),
  ];
}
