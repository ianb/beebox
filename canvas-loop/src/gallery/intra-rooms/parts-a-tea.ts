// Pieces shared by Intake, the Foyer, the Activity Hub, the Joyous Cafe, the
// Tranquil Pool and the Archive Console: equipment cabinets, tape reels, little
// screens and their pictures, blinking lamps, lit signs, music notes.
import type { Vec2, SceneView as View } from "@ianbicking/canvas-loop";
import { INK, at, blob, ellipsePts, glow, hash, mixHex, rivet, roundRectPts, stroke } from "./kit-tea.js";
import { m } from "./sizes-tea.js";

/** A hue (0..360) at saturation s and value l (0..1) as #rrggbb, for colours that
 * move with time and still work with `glow`. */
export function hueHex(h: number, s: number, l: number): string {
  const k = (n: number): number => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number): number => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return `#${[0, 8, 4].map((n) => Math.round(f(n) * 255).toString(16).padStart(2, "0")).join("")}`;
}

/** A box of equipment standing against the wall: moulded casing, a chrome strip, a
 * vent at the foot. x is its centre (m), w and h its size (m). Returns its screen rect. */
export function cabinet(v: View, x: number, w: number, h: number, a: { depth?: number; colour?: string; seed: number }): { x: number; y: number; w: number; h: number } {
  const [px, py] = at(x, 0, a.depth ?? 0.3);
  const pw = m(w), ph = m(h), c = a.colour ?? "#c8bca0";
  blob(v, [[px - pw / 2, py], [px + pw / 2, py], [px + pw / 2 + 2, py - ph + 10], [px + pw / 2 - 10, py - ph], [px - pw / 2 + 10, py - ph], [px - pw / 2 - 2, py - ph + 10]], { fill: c, light: mixHex(c, "#ffffff", 0.3), dark: mixHex(c, "#000000", 0.35), seed: a.seed, shadeSide: "right", line: 2.4 });
  stroke(v, [[px - pw / 2 + 6, py - ph + 14], [px + pw / 2 - 6, py - ph + 14]], { seed: a.seed + 1, weight: 3, colour: "#e8e8ec", amp: 0.3 });
  blob(v, roundRectPts(px - pw / 2 + 8, py - 30, pw - 16, 20, 4), { fill: mixHex(c, "#000000", 0.45), seed: a.seed + 2, line: 1.4, amp: 0.3 });
  for (let i = 0; i < 3; i++) v.line(px - pw / 2 + 14, py - 25 + i * 5, px + pw / 2 - 14, py - 25 + i * 5, { stroke: "#1a1614", weight: 1.4 });
  rivet(v, px - pw / 2 + 7, py - ph + 22);
  rivet(v, px + pw / 2 - 7, py - ph + 22);
  return { x: px - pw / 2, y: py - ph, w: pw, h: ph };
}

/** A screen's bezel and dark glass, at a screen rect (px). */
export function screenFrame(v: View, x: number, y: number, w: number, h: number, seed: number, bezel = "#4a4038"): void {
  blob(v, roundRectPts(x - 5, y - 5, w + 10, h + 10, 8), { fill: bezel, seed, line: 1.8, amp: 0.5 });
  blob(v, roundRectPts(x, y, w, h, Math.min(w, h) * 0.2), { fill: "#0e1412", seed: seed + 1, line: 1.6, amp: 0.4 });
}

/** A broken screen: a star of cracks and a strip of tape saying so. */
export function crackedScreen(v: View, x: number, y: number, w: number, h: number, seed: number, label = "OUT OF ORDER"): void {
  const cx = x + w * (0.3 + hash(seed, 0, 1) * 0.4), cy = y + h * (0.3 + hash(seed, 1, 1) * 0.4);
  for (let i = 0; i < 6; i++) {
    const ang = (i / 6) * Math.PI * 2 + hash(seed, i, 2);
    const r = Math.min(w, h) * (0.35 + hash(seed, i, 3) * 0.4);
    stroke(v, [[cx, cy], [cx + Math.cos(ang) * r * 0.5 + 3, cy + Math.sin(ang) * r * 0.5], [cx + Math.cos(ang) * r, cy + Math.sin(ang) * r]], { seed: seed + i, weight: 1, colour: "#8a9aa0", amp: 0.8 });
  }
  v.at({ translate: [x + w / 2, y + h / 2], rotate: -0.18 }, () => {
    v.rect(-w * 0.55, -7, w * 1.1, 14, { fill: "rgba(232,222,170,0.92)" });
    v.text(label, { x: 0, y: 0 }, { size: 8, fill: "#7a1a1a", align: "center", valign: "middle", style: "bold" });
  });
}

/** A tape reel, turned to angle `ang`. Cheap enough to draw every frame. */
export function reel(v: View, cx: number, cy: number, r: number, ang: number, fullness = 0.7): void {
  v.circle(cx, cy, r, { fill: "#d8d8dc", stroke: INK, weight: 1.8 });
  v.circle(cx, cy, r * (0.3 + fullness * 0.6), { fill: "#5a3a26" });
  v.circle(cx, cy, r * 0.28, { fill: "#d8d8dc", stroke: INK, weight: 1.2 });
  for (let i = 0; i < 3; i++) {
    const a = ang + (i / 3) * Math.PI * 2;
    v.circle(cx + Math.cos(a) * r * 0.16, cy + Math.sin(a) * r * 0.16, r * 0.07, { fill: INK });
  }
  v.circle(cx, cy, r * 0.05, { fill: INK });
}

/** A row of indicator lamps blinking in a pattern of their own. */
export function lamps(v: View, x: number, y: number, n: number, t: number, a: { seed: number; gap?: number; colours?: readonly string[]; rate?: number }): void {
  const colours = a.colours ?? ["#ff4a3a", "#f8c840", "#5ae07a"];
  const gap = a.gap ?? 9, rate = a.rate ?? 12;
  for (let i = 0; i < n; i++) {
    const on = hash(i, Math.floor((t + hash(i, 0, a.seed) * rate) / rate), a.seed) < 0.55;
    const c = colours[i % colours.length] ?? "#ff4a3a";
    v.circle(x + i * gap, y, 2.6, { fill: on ? c : mixHex(c, "#1a1414", 0.75) });
    if (on) glow(v, x + i * gap, y, { rx: 9, colour: c, alpha: 0.5 });
  }
}

/** An ECG-style trace scrolling across a screen rect. */
export function trace(v: View, x: number, y: number, w: number, h: number, t: number, colour: string, beat = 46): void {
  const pts: Vec2[] = [];
  const mid = y + h * 0.6;
  for (let i = 0; i <= 40; i++) {
    const u = i / 40, ph = ((u * w + t * 2) % beat) / beat;
    const k = ph < 0.08 ? -Math.sin((ph / 0.08) * Math.PI) * 0.9 : ph < 0.13 ? Math.sin(((ph - 0.08) / 0.05) * Math.PI) * 0.35 : ph > 0.3 && ph < 0.42 ? -Math.sin(((ph - 0.3) / 0.12) * Math.PI) * 0.18 : 0;
    pts.push([x + 3 + u * (w - 6), mid + k * h * 0.5]);
  }
  v.curve(pts, false, { stroke: colour, weight: 1.6 });
  glow(v, x + w / 2, mid, { rx: w * 0.6, ry: h * 0.6, colour, alpha: 0.18 });
}

/** A lit sign box (frame and face); its light is `signGlow`. */
export function signBox(v: View, cx: number, cy: number, w: number, h: number, text: string, a: { seed: number; face?: string; ink?: string; size?: number }): void {
  blob(v, roundRectPts(cx - w / 2 - 6, cy - h / 2 - 6, w + 12, h + 12, 6), { fill: "#3a3836", light: "#6a6866", seed: a.seed, line: 2.2, amp: 0.6 });
  blob(v, roundRectPts(cx - w / 2, cy - h / 2, w, h, 3), { fill: a.face ?? "#f0e8c8", seed: a.seed + 1, line: 1.4, amp: 0.4 });
  v.text(text, { x: cx, y: cy + 1 }, { size: a.size ?? 14, fill: a.ink ?? "#2a2018", align: "center", valign: "middle", style: "bold", font: "Helvetica, Arial, sans-serif" });
  for (const dx of [-w / 2 + 10, w / 2 - 10]) stroke(v, [[cx + dx, cy - h / 2 - 6], [cx + dx, cy - h / 2 - 22]], { seed: a.seed + 2 + dx, weight: 1.6 });
}

/** Music notes rising from (x, y) and drifting, fading as they go. */
export function notes(v: View, x: number, y: number, t: number, a: { colour: string; seed: number; n?: number; rise?: number }): void {
  const n = a.n ?? 4, rise = a.rise ?? 110;
  for (let i = 0; i < n; i++) {
    const u = ((t * 0.012 + i / n + hash(i, 0, a.seed) * 0.2) % 1);
    const nx = x + Math.sin(u * 6 + i * 2) * 18 + (hash(i, 1, a.seed) - 0.5) * 30, ny = y - u * rise;
    const alpha = Math.sin(u * Math.PI);
    const c = `rgba(${[1, 3, 5].map((s) => Number.parseInt(a.colour.slice(s, s + 2), 16)).join(",")},${alpha.toFixed(3)})`;
    v.ellipse(nx, ny, 4.5, 3.4, { fill: c });
    v.line(nx + 4, ny, nx + 4, ny - 14, { stroke: c, weight: 1.6 });
    if (i % 2 === 0) v.line(nx + 4, ny - 14, nx + 11, ny - 10, { stroke: c, weight: 2 });
  }
}

/** A thick cable lying slack between two points (px). */
export function cable(v: View, a: Vec2, b: Vec2, sag: number, seed: number, colour = "#2a2a2e"): void {
  const pts: Vec2[] = Array.from({ length: 9 }, (_, i): Vec2 => {
    const u = i / 8;
    return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u + Math.sin(u * Math.PI) * sag];
  });
  stroke(v, pts, { seed, weight: 3.4, colour, amp: 1.5 });
}

/** A dial with a needle at `u` (0..1). */
export function dial(v: View, cx: number, cy: number, r: number, u: number, seed: number): void {
  blob(v, ellipsePts(cx, cy, r, r, 14), { fill: "#f0e8d0", seed, line: 1.4, amp: 0.3 });
  const ang = Math.PI * (1.15 + u * 0.7);
  v.line(cx, cy + r * 0.3, cx + Math.cos(ang) * r * 0.85, cy + r * 0.3 + Math.sin(ang) * r * 0.85, { stroke: "#a01a1a", weight: 1.4 });
}
