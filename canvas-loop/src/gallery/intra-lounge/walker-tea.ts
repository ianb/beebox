// A citizen walking through the lounge: along a loop on the floor, tinted by the
// light where they are, and hidden wherever the room is nearer to the camera
// (the sofa, the table), using the depth the room was rendered with.
import type { View } from "@ianbicking/canvas-loop";
import { SCALE, depthOf, lightAt, project, sceneDepth } from "./scene-tea.js";

type RGB = [number, number, number];

/** In through the Atrium door, round the right of the sofa, along behind the table in front of the screens, and back. */
const ROUTE: readonly (readonly [number, number])[] = [[-0.05, 0.35], [-0.05, 1.6], [1.5, 1.75], [1.55, 4.15], [-1.4, 4.15], [1.55, 4.15], [1.5, 1.75], [-0.05, 1.6]];
const SPEED = 0.02;

/** Where the walker is at frame t, and which way they face. */
export function walkerAt(t: number): { x: number; z: number; dx: number; dz: number } {
  const segs = ROUTE.map((p, i) => {
    const q = ROUTE[(i + 1) % ROUTE.length] ?? p;
    return { p, q, len: Math.hypot(q[0] - p[0], q[1] - p[1]) };
  });
  const total = segs.reduce((s, g) => s + g.len, 0);
  let d = (t * SPEED) % total;
  for (const g of segs) {
    if (d <= g.len) {
      const u = d / g.len;
      return { x: g.p[0] + (g.q[0] - g.p[0]) * u, z: g.p[1] + (g.q[1] - g.p[1]) * u, dx: (g.q[0] - g.p[0]) / g.len, dz: (g.q[1] - g.p[1]) / g.len };
    }
    d -= g.len;
  }
  return { x: ROUTE[0]?.[0] ?? 0, z: ROUTE[0]?.[1] ?? 0, dx: 0, dz: 1 };
}

function tint(hexColour: string, light: RGB): string {
  const n = Number.parseInt(hexColour.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((ch, i) => Math.round(255 * (1 - Math.exp(-(ch / 255) * (light[i] ?? 0) * 1.8))));
  return `rgb(${c.join(",")})`;
}

/** Paints the walker for frame t, with the room's lights and sky for that frame. */
export function paintWalker(v: View, a: { t: number; lights: readonly RGB[]; sky: RGB }): void {
  const w = walkerAt(a.t);
  const [fx, fy] = project(w.x, 0, w.z);
  const light = lightAt([w.x, 1, w.z], a);
  const h = 1.65 * SCALE * Math.cos(Math.PI / 6);
  const step = Math.sin(a.t * 0.32);
  // Walking toward the camera shows the face; away shows the back of the head.
  const away = w.dz > 0.3 || w.dx < -0.3;
  // The side toward the monitor wall catches their glow: a thin rim of light.
  const rim = `rgba(${Math.round(Math.min(255, light[0] * 160))},${Math.round(Math.min(255, light[1] * 180))},${Math.round(Math.min(255, light[2] * 200))},0.55)`;
  const body = (): void => {
    v.ellipse(fx, fy, h * 0.15, h * 0.055, { fill: "rgba(0,0,0,0.35)" });
    // Legs, swinging.
    for (const side of [-1, 1]) {
      const swing = side * step * h * 0.035;
      v.path([["move", fx + side * h * 0.035, fy - h * 0.47], ["quad", fx + side * h * 0.045 + swing * 0.5, fy - h * 0.25, fx + side * h * 0.035 + swing, fy - h * 0.01]], { stroke: tint("#23262f", light), weight: h * 0.055 });
    }
    // A long coat, narrow at the shoulders.
    v.path([["move", fx - h * 0.1, fy - h * 0.8], ["quad", fx - h * 0.125, fy - h * 0.6, fx - h * 0.115, fy - h * 0.42], ["line", fx + h * 0.115, fy - h * 0.42], ["quad", fx + h * 0.125, fy - h * 0.6, fx + h * 0.1, fy - h * 0.8], ["quad", fx, fy - h * 0.84, fx - h * 0.1, fy - h * 0.8], ["close"]], { fill: tint("#4a2f3a", light) });
    for (const side of [-1, 1]) {
      const swing = -side * step * h * 0.03;
      v.path([["move", fx + side * h * 0.1, fy - h * 0.78], ["quad", fx + side * h * 0.135, fy - h * 0.62, fx + side * h * 0.115 + swing, fy - h * 0.47]], { stroke: tint("#3e2731", light), weight: h * 0.045 });
    }
    v.path([["move", fx + h * 0.1, fy - h * 0.8], ["quad", fx + h * 0.125, fy - h * 0.6, fx + h * 0.115, fy - h * 0.42]], { stroke: rim, weight: 1.4 });
    // Head.
    v.ellipse(fx, fy - h * 0.9, h * 0.062, h * 0.072, { fill: tint(away ? "#2e1d15" : "#b9805c", light) });
    if (!away) v.path([["move", fx - h * 0.064, fy - h * 0.9], ["quad", fx, fy - h * 1.0, fx + h * 0.064, fy - h * 0.9], ["close"]], { fill: tint("#2e1d15", light) });
    v.arc(fx, fy - h * 0.9, h * 0.065, -Math.PI * 0.5, Math.PI * 0.2, { stroke: rim, weight: 1.2 });
  };
  // Visible only where the room is further away than the walker. The walker stands
  // upright, so each row of the figure is a different height, and so a different
  // depth: the feet are further along the view than the head.
  const x0 = Math.floor(fx - h * 0.3), y0 = Math.floor(fy - h * 1.1), bw = Math.ceil(h * 0.6), bh = Math.ceil(h * 1.2);
  v.mask(() => {
    const img = v.ctx.createImageData(bw, bh);
    for (let j = 0; j < bh; j++) {
      const height = Math.max(0, (fy - (y0 + j)) / (SCALE * Math.cos(Math.PI / 6)));
      const depth = depthOf(w.x, height, w.z) - 0.08;
      for (let i = 0; i < bw; i++) {
        if (sceneDepth(x0 + i, y0 + j) > depth) img.data[(j * bw + i) * 4 + 3] = 255;
      }
    }
    v.ctx.putImageData(img, x0, y0);
  }, body);
}
