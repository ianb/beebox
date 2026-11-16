// Pieces shared by the Yellow Room, Solitude Cubes, Waiting Room, Static Garden,
// Ill-Fitting Lounge and Feedback Booth: moulded chairs, placards, speech bubbles.
import type { Vec2, View } from "@ianbicking/canvas-loop";
import { at, blob, ellipsePts, mixHex, roundRectPts, stroke } from "./kit-tea.js";
import { m } from "./sizes-tea.js";

/** A moulded 70s plastic chair seen from the side, on splayed tube legs. `seat` is the
 * seat height and `size` scales the shell (the Ill-Fitting Lounge shrinks both). */
export function mouldedChair(v: View, x: number, depth: number, a: { colour?: string; facing?: 1 | -1; seat?: number; size?: number; seed?: number; tilt?: number } = {}): void {
  const c = a.colour ?? "#e8783a", f = a.facing ?? 1, seed = a.seed ?? Math.round(x * 31);
  const s = a.size ?? 1, seatH = m(a.seat ?? 0.45);
  const [px, py] = at(x, 0, depth);
  const half = m(0.23) * s;
  // Legs: two visible tubes, splayed.
  for (const dx of [-1, 1]) stroke(v, [[px + dx * half * 0.7, py - seatH + 4], [px + dx * half * 1.05, py - 2]], { seed: seed + dx, weight: 3, colour: "#a8a8b0", amp: 0.3 });
  v.at({ translate: [px, py - seatH], rotate: a.tilt ?? 0 }, () => {
    const backH = m(0.42) * s;
    const shell: Vec2[] = [[f * half, 0], [f * half + f * 4, -m(0.05) * s], [-f * half * 0.7, -m(0.06) * s], [-f * half * 1.05, -backH], [-f * half * 1.35, -backH + 4], [-f * half * 1.1, -m(0.02)], [-f * half * 0.8, 6]];
    blob(v, shell, { fill: c, light: mixHex(c, "#ffffff", 0.35), dark: mixHex(c, "#000000", 0.35), seed: seed + 3, line: 2.2, shadeSide: "bottom" });
  });
  blob(v, ellipsePts(px - half * 1.05, py - 2, 5, 2), { fill: "#2a2a2e", seed: seed + 5, line: 1 });
  blob(v, ellipsePts(px + half * 1.05, py - 2, 5, 2), { fill: "#2a2a2e", seed: seed + 6, line: 1 });
}

/** A small signboard or label: a hand-inked rounded plate with lines of text. */
export function placard(v: View, cx: number, cy: number, lines: readonly string[], a: { w: number; size?: number; bg?: string; ink?: string; seed: number; rot?: number; line?: number }): void {
  const size = a.size ?? 10, h = lines.length * size * 1.3 + 10;
  v.at({ translate: [cx, cy], rotate: a.rot ?? 0 }, () => {
    blob(v, roundRectPts(-a.w / 2, -h / 2, a.w, h, 4), { fill: a.bg ?? "#e8dcc0", seed: a.seed, line: a.line ?? 1.6, amp: 0.5 });
    for (const [i, s] of lines.entries()) v.text(s, { x: 0, y: -h / 2 + 5 + size * 0.65 + i * size * 1.3 }, { size, fill: a.ink ?? "#3a2a20", align: "center", valign: "middle", style: "bold" });
  });
}

/** A speech bubble, fading by `alpha`, its tail pointing down-left or down-right at (x, y). */
export function speech(v: View, x: number, y: number, text: string, alpha: number, a: { size?: number; side?: 1 | -1; bg?: string } = {}): void {
  if (alpha <= 0.02) return;
  const size = a.size ?? 10, side = a.side ?? 1;
  const w = v.textWidth(text, { size, style: "italic" }) + 14, h = size + 10;
  const bx = x + side * 8 - (side < 0 ? w : 0), by = y - h - 10;
  const bg = a.bg ?? "248,244,232";
  v.roundRect(bx, by, w, h, 8, { fill: `rgba(${bg},${(alpha * 0.85).toFixed(3)})`, stroke: `rgba(36,28,23,${alpha.toFixed(3)})`, weight: 1.2 });
  v.polygon([[x, y], [x + side * 10, by + h - 1], [x + side * 20, by + h - 1]], { fill: `rgba(${bg},${(alpha * 0.85).toFixed(3)})` });
  v.text(text, { x: bx + w / 2, y: by + h / 2 }, { size, fill: `rgba(36,28,23,${alpha.toFixed(3)})`, align: "center", valign: "middle", style: "italic" });
}

/** The 0..1 envelope of something that comes and goes every `period` frames,
 * showing for `on` of them, offset by `phase`. */
export function pulse(t: number, period: number, on: number, phase = 0): number {
  const u = (t + phase) % period;
  if (u > on) return 0;
  return Math.min(1, u / 8, (on - u) / 8);
}
