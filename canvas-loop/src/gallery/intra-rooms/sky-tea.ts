// The sky screens: each room's ceiling shows the sky its description names. One
// sky runs behind all the room's panels (so it reads as one picture behind the
// frames), animated, with scanlines; dead panels stay dark.
import type { View } from "@ianbicking/canvas-loop";
import { type RoomSpec, glow, hash, panelBand, panels, rgba } from "./kit-tea.js";
import { m } from "./sizes-tea.js";

type RGB = readonly [number, number, number];

/** The colour each sky throws down into the room. */
export const SKY_LIGHT: Record<RoomSpec["sky"], string> = {
  sunset: "#ff9040", "pixel-blue": "#5a8cff", "pink-sunset": "#ff70b0", clouds: "#a8c8ff", birds: "#90d8ff", "still-clouds": "#a0c0ff",
  balloons: "#ffb0d0", "night-stars": "#4050a0", beach: "#80d0e0", "paper-planes": "#b0d8ff", canopy: "#80c870", "shifting-stars": "#5060b0",
  overcast: "#707888", "calm-static": "#b0e0ff", "test-card": "#d0d0d0", dead: "#000000", cheerful: "#ff80c0",
};

function band(v: View, x0: number, x1: number, y0: number, y1: number, stops: [number, string][]): void {
  v.rect(x0, y0, x1 - x0, y1 - y0, { fill: v.linearGradient(0, y0, 0, y1, stops) });
}

function cloud(v: View, x: number, y: number, s: number, colour: string): void {
  for (const [dx, dy, r] of [[0, 0, 10], [10, 3, 7], [-10, 3, 7], [4, -6, 7]] as const) v.circle(x + dx * s, y + dy * s, r * s, { fill: colour });
}

type SkyKind = RoomSpec["sky"];
interface SkyArea {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  t: number;
  seed: number;
}

function skySunset(v: View, a: SkyArea, _kind: SkyKind): void {
  const { x0, x1, y0, y1 } = a;
  band(v, x0, x1, y0, y1, [[0, "#3b1d5a"], [0.5, "#d9480f"], [0.8, "#ff9b3d"], [1, "#ffd27a"]]);
  for (let x = x0 + 200; x < x1; x += 600) v.circle(x, y1 + 4, 26, { fill: "#fff1b8" });}

function skyPixelBlue(v: View, a: SkyArea, _kind: SkyKind): void {
  const { x0, x1, y0, y1, t } = a;
  const burst = t % 144 >= 84 && t % 144 < 92;
  for (let y = y0; y < y1; y += 8) for (let x = x0; x < x1; x += 8) {
    const gx = Math.floor(x / 8), gy = Math.floor((y - y0) / 8);
    let c: RGB = gy < 3 ? [58, 104, 220] : [86, 142, 240];
    if (hash(Math.floor((gx + Math.floor(t / 10)) / 3), Math.floor(gy / 2), 41) < 0.2) c = [228, 236, 250];
    if (burst) {
      const n = hash(gx, gy + t * 7, 43);
      c = n < 0.45 ? [230, 232, 240] : n < 0.8 ? [40, 44, 60] : [120, 130, 160];
    }
    v.rect(x, y, 8, 8, { fill: rgba(c, 1) });
  }
}

function skyPinkSunset(v: View, a: SkyArea, _kind: SkyKind): void {
  const { x0, x1, y0, y1, t } = a;
  const w = x1 - x0, h = y1 - y0;
  band(v, x0, x1, y0, y1, [[0, "#831843"], [0.5, "#ec4899"], [0.7, "#fb923c"], [1, "#fde68a"]]);
  v.rect(x0, y0 + h * 0.7 + (Math.sin(t * 0.7) > 0.6 ? 2 : 0), w, 1.5, { fill: "#fff7ed" });}

function skyClouds(v: View, a: SkyArea, kind: SkyKind): void {
  const { x0, x1, y0, y1, t } = a;
  const w = x1 - x0, h = y1 - y0;
  band(v, x0, x1, y0, y1, [[0, "#3c7ce0"], [1, "#a8cdf8"]]);
  // Drifting, sometimes halting mid-drift.
  const moving = kind === "clouds" && Math.floor(t / 60) % 3 !== 2;
  const drift = kind === "clouds" ? (moving ? t * 0.4 : Math.floor(t / 60) * 24) : 0;
  for (let i = 0; i < w / 140; i++) cloud(v, x0 + ((hash(i, 0, a.seed) * w + drift) % w), y0 + 16 + hash(i, 1, a.seed) * (h - 30), kind === "still-clouds" ? 2.2 : 1.3, "#ffffff");}

function skyBirds(v: View, a: SkyArea, _kind: SkyKind): void {
  const { x0, x1, y0, y1, t } = a;
  const w = x1 - x0, h = y1 - y0;
  band(v, x0, x1, y0, y1, [[0, "#38bdf8"], [1, "#e0f2fe"]]);
  for (let i = 0; i < w / 120; i++) {
    const back = i % 3 === 1, loop = i % 5 === 4;
    let bx = x0 + (((hash(i, 0, 7) * w + (back ? -t : t) * 1.1) % w) + w) % w, by = y0 + 12 + hash(i, 1, 7) * (h - 24);
    if (loop) {
      bx += Math.cos(t * 0.08 + i) * 16;
      by += Math.sin(t * 0.08 + i) * 10;
    }
    const flap = Math.sin(t * 0.4 + i) * 3;
    v.path([["move", bx - 6, by - flap], ["line", bx, by], ["line", bx + 6, by - flap]], { stroke: "#1e293b", weight: 1.4 });
  }
}

function skyBalloons(v: View, a: SkyArea, _kind: SkyKind): void {
  const { x0, x1, y0, y1, t } = a;
  const w = x1 - x0, h = y1 - y0;
  band(v, x0, x1, y0, y1, [[0, "#ffd6e8"], [1, "#fff4d6"]]);
  for (let i = 0; i < w / 40; i++) {
    const bx = x0 + hash(i, 0, 9) * w + Math.sin(t * 0.03 + i) * 6;
    const by = y1 + 10 - (((hash(i, 1, 9) * h * 2 + t * 0.6) % (h * 2)));
    const c = ["#ff5a7a", "#ffcf3a", "#4ac0ff", "#8a5aff", "#5ae08a"][i % 5] ?? "#ff5a7a";
    v.ellipse(bx, by, 7, 9, { fill: c });
    v.line(bx, by + 9, bx + 2, by + 22, { stroke: "rgba(80,60,60,0.6)", weight: 0.8 });
    v.rect(x0 + hash(i, 2, 9) * w, y0 + ((hash(i, 3, 9) * h + t * 0.9) % h), 3, 3, { fill: c });
  }
}

function skyNightStars(v: View, a: SkyArea, kind: SkyKind): void {
  const { x0, x1, y0, y1, t } = a;
  const w = x1 - x0, h = y1 - y0;
  band(v, x0, x1, y0, y1, [[0, "#020617"], [1, "#1e1b4b"]]);
  const pts: [number, number][] = [];
  for (let i = 0; i < w / 18; i++) {
    let sx = x0 + hash(i, 0, 11) * w, sy = y0 + hash(i, 1, 11) * h;
    if (kind === "shifting-stars") {
      // The constellations wander.
      sx += Math.sin(t * 0.01 + i) * 8;
      sy += Math.cos(t * 0.013 + i * 2) * 4;
    }
    pts.push([sx, sy]);
    v.circle(sx, sy, 0.8 + 0.7 * Math.abs(Math.sin(t * 0.05 + i)), { fill: "#f8fafc" });
  }
  if (kind === "shifting-stars") for (let i = 0; i + 1 < pts.length; i += 3) {
    const p = pts[i] ?? [0, 0], q = pts[i + 1] ?? p;
    if (Math.abs(p[0] - q[0]) < 120) v.line(p[0], p[1], q[0], q[1], { stroke: "rgba(160,170,255,0.35)", weight: 0.8 });
  }
  const s = (t % 160) / 160;
  if (kind === "night-stars" && s < 0.25) v.line(x0 + w * (0.2 + s), y0 + h * (0.2 + s), x0 + w * (0.2 + s) - 16, y0 + h * (0.2 + s) - 6, { stroke: "#fef9c3", weight: 1.4 });}

function skyBeach(v: View, a: SkyArea, _kind: SkyKind): void {
  const { x0, x1, y0, y1, t } = a;
  const w = x1 - x0, h = y1 - y0;
  band(v, x0, x1, y0, y1, [[0, "#7cc4f0"], [0.55, "#bfe6f8"], [0.56, "#2a8ab8"], [1, "#48b0d0"]]);
  // Waves, unnaturally slow.
  for (let k = 0; k < 3; k++) {
    const y = y0 + h * (0.66 + k * 0.1) + Math.sin(t * 0.01 + k) * 2;
    v.line(x0, y, x1, y, { stroke: "rgba(255,255,255,0.5)", weight: 1.2, dash: [18, 26] });
  }
  v.rect(x0, y1 - 6, w, 6, { fill: "#e8d8a8" });}

function skyPaperPlanes(v: View, a: SkyArea, _kind: SkyKind): void {
  const { x0, x1, y0, y1, t } = a;
  const w = x1 - x0, h = y1 - y0;
  band(v, x0, x1, y0, y1, [[0, "#5aaee8"], [1, "#d8f0ff"]]);
  for (let i = 0; i < w / 160; i++) {
    const dir = hash(i, 2, 13) * Math.PI * 2;
    const px = x0 + ((((hash(i, 0, 13) * w + Math.cos(dir) * t * 0.4) % w) + w) % w);
    const py = y0 + ((((hash(i, 1, 13) * h + Math.sin(dir) * t * 0.2) % h) + h) % h);
    v.at({ translate: [px, py], rotate: dir }, () => v.polygon([[8, 0], [-6, -4], [-3, 0], [-6, 4]], { fill: "#ffffff" }));
  }
}

function skyCanopy(v: View, a: SkyArea, _kind: SkyKind): void {
  const { x0, x1, y0, y1, t } = a;
  const w = x1 - x0, h = y1 - y0;
  band(v, x0, x1, y0, y1, [[0, "#1e3a1e"], [1, "#4a7a3a"]]);
  for (let i = 0; i < w / 14; i++) v.circle(x0 + hash(i, 0, 15) * w, y0 + hash(i, 1, 15) * h, 6 + hash(i, 2, 15) * 8, { fill: i % 2 === 0 ? "#2e5a2a" : "#5a8a40" });
  // Beams of light breaking through, flickering.
  for (let i = 0; i < w / 300; i++) {
    const on = hash(i, Math.floor(t / 6), 17) > 0.15;
    if (on) v.circle(x0 + hash(i, 3, 15) * w, y0 + h * 0.5, 8, { fill: "rgba(255,250,200,0.8)" });
  }
}

function skyOvercast(v: View, a: SkyArea, _kind: SkyKind): void {
  const { x0, x1, y0, y1, t } = a;
  const w = x1 - x0, h = y1 - y0;
  band(v, x0, x1, y0, y1, [[0, "#2e3440"], [1, "#5a6070"]]);
  for (let i = 0; i < w / 90; i++) cloud(v, x0 + ((hash(i, 0, 19) * w + t * 0.1) % w), y0 + 10 + hash(i, 1, 19) * (h - 20), 2, "#3e4450");}

function skyCalmStatic(v: View, a: SkyArea, _kind: SkyKind): void {
  const { x0, x1, y0, y1, t } = a;
  const w = x1 - x0, h = y1 - y0;
  band(v, x0, x1, y0, y1, [[0, "#7dd3fc"], [1, "#e0f2fe"]]);
  if (hash(Math.floor(t / 8), 0, 21) < 0.3) v.rect(x0, y0 + ((t * 3) % h), w, 4, { fill: "rgba(255,255,255,0.7)" });}

function skyTestCard(v: View, a: SkyArea, _kind: SkyKind): void {
  const { x0, x1, y0, y1, t } = a;
  const h = y1 - y0;
  const bars = ["#c0c0c0", "#c0c000", "#00c0c0", "#00c000", "#c000c0", "#c00000", "#0000c0"];
  const bw = 40;
  for (let x = x0; x < x1; x += bw) v.rect(x, y0, bw, h, { fill: bars[Math.floor((x - x0) / bw) % bars.length] ?? "#c0c0c0" });
  if (Math.floor(t / 30) % 2 === 0) for (let x = x0 + 120; x < x1; x += 520) {
    v.rect(x, y0 + h / 2 - 10, 150, 20, { fill: "#000000" });
    v.text("PLEASE STAND BY", { x: x + 75, y: y0 + h / 2 }, { size: 11, fill: "#ffffff", align: "center", valign: "middle", style: "bold" });
  }
}

function skyCheerful(v: View, a: SkyArea, _kind: SkyKind): void {
  const { x0, x1, y0, y1, t } = a;
  const w = x1 - x0, h = y1 - y0;
  band(v, x0, x1, y0, y1, [[0, "#ff7ac8"], [1, "#5ae8d8"]]);
  for (let i = 0; i < w / 80; i++) {
    const cx = x0 + hash(i, 0, 23) * w, cy = y0 + h / 2 + Math.sin(t * 0.15 + i) * (h * 0.3);
    v.circle(cx, cy, 8, { fill: "#fff36a" });
    v.circle(cx - 3, cy - 2, 1.2, { fill: "#2a2a2a" });
    v.circle(cx + 3, cy - 2, 1.2, { fill: "#2a2a2a" });
    v.arc(cx, cy + 1, 4, 0.3, Math.PI - 0.3, { stroke: "#2a2a2a", weight: 1.2 });
  }
}

function skyDead(): void {
  // A dead screen shows nothing.
}

/** One painter per sky. */
const SKIES: Record<SkyKind, (v: View, a: SkyArea, kind: SkyKind) => void> = {
  "sunset": skySunset,
  "pixel-blue": skyPixelBlue,
  "pink-sunset": skyPinkSunset,
  "clouds": skyClouds,
  "still-clouds": skyClouds,
  "birds": skyBirds,
  "balloons": skyBalloons,
  "night-stars": skyNightStars,
  "shifting-stars": skyNightStars,
  "beach": skyBeach,
  "paper-planes": skyPaperPlanes,
  "canopy": skyCanopy,
  "overcast": skyOvercast,
  "calm-static": skyCalmStatic,
  "test-card": skyTestCard,
  "cheerful": skyCheerful,
  "dead": skyDead,
};

/** The room's sky in its panels, and the light it throws down. */
export function paintSky(v: View, r: RoomSpec, t: number): void {
  const [y0, y1] = panelBand(r);
  for (const [i, [a, b]] of panels(r).entries()) {
    if (r.dead?.includes(i) === true) {
      if (hash(Math.floor(t / 3), i, 31) < 0.15) v.rect(a + 30 + hash(t, i, 32) * (b - a - 60), y0 + 10 + hash(t, i, 33) * 30, 8, 8, { fill: "#4a78e0" });
      continue;
    }
    v.mask(() => v.rect(a + 2, y0 + 2, b - a - 4, y1 - y0 - 2, { fill: "#000" }), () => {
      SKIES[r.sky](v, { x0: a, x1: b, y0, y1, t, seed: 5 }, r.sky);
      for (let y = y0; y < y1; y += 3) v.line(a, y, b, y, { stroke: "rgba(0,0,0,0.12)", weight: 1 });
    });
  }
  const light = SKY_LIGHT[r.sky];
  if (r.sky !== "dead") v.rect(-300, y1, m(r.width) + 600, 260, { fill: v.linearGradient(0, y1, 0, y1 + 260, [[0, `${light}38`], [1, `${light}00`]]), blend: "screen" });
  for (const [i, [a, b]] of panels(r).entries()) if (r.dead?.includes(i) !== true && r.sky !== "dead") glow(v, (a + b) / 2, y1 + 6, { rx: (b - a) * 0.6, ry: 40, colour: light, alpha: 0.18 });
}
