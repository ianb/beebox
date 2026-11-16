// Painters for props and people, in map pixels. Each takes the centre of the
// prop's footprint on the floor (px, py); tall things rise above it.
import type { Drawing, Style, View } from "@ianbicking/canvas-loop";
import type { Prop } from "./plan-tea.js";
import { T } from "./plan-tea.js";

const SHADOW = "rgba(10, 12, 20, 0.32)";
const INK = "#1f2430";

function shadow(v: View, x: number, y: number, rx: number, ry = rx * 0.35): Drawing {
  return v.ellipse(x, y, rx, ry, { fill: SHADOW });
}

function statue(v: View, x: number, y: number, k: number): Drawing {
  // A citizen in sandstone, worn smooth: no face, rounded shoulders.
  const lean = ((k * 37) % 7) / 7 - 0.5;
  return [
    shadow(v, x + 2, y + 5, 10),
    v.rect(x - 8, y - 2, 16, 7, { fill: "#8f8577" }),
    v.rect(x - 8, y - 2, 16, 2, { fill: "#a89e90" }),
    v.roundRect(x - 5 + lean, y - 22, 10, 21, 4, { fill: "#c6a07a" }),
    v.roundRect(x - 5 + lean, y - 22, 4, 21, 2, { fill: "#d9b993" }),
    v.circle(x + lean * 1.5, y - 26, 4.6, { fill: "#c6a07a" }),
    v.circle(x - 1.5 + lean * 1.5, y - 27.5, 2, { fill: "#dcc0a0" }),
    // Dust on the shoulders.
    v.line(x - 4 + lean, y - 21, x + 4 + lean, y - 21, { stroke: "rgba(240,230,210,0.6)", weight: 1 }),
  ];
}

function bench(v: View, x: number, y: number, w: number): Drawing {
  const out: Drawing[] = [];
  out.push(shadow(v, x, y + 5, w / 2));
  out.push(v.rect(x - w / 2, y - 4, w, 6, { fill: "#8a5a34" }));
  out.push(v.rect(x - w / 2, y - 4, w, 2, { fill: "#a87348" }));
  for (const lx of [x - w / 2 + 3, x + w / 2 - 5]) out.push(v.rect(lx, y + 2, 2, 4, { fill: "#5e3d22" }));
  return out;
}

function vending(v: View, x: number, y: number, t: number): Drawing {
  const out: Drawing[] = [];
  out.push(shadow(v, x, y + 6, 12));
  out.push(v.rect(x - 11, y - 30, 22, 36, { fill: "#2a3550" }));
  out.push(v.rect(x - 9, y - 27, 13, 24, { fill: "#9fd3ff" }));
  for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) out.push(v.rect(x - 7 + j * 6, y - 25 + i * 6, 4, 4, { fill: ["#f87171", "#fde047", "#86efac", "#c4b5fd"][(i + j) % 4] ?? "#fff" }));
  out.push(v.rect(x + 6, y - 25, 3, 12, { fill: "#111827" }));
  // The hum: a glow that breathes.
  const glow = 0.25 + 0.1 * Math.sin(t * 0.1);
  out.push(v.rect(x - 9, y - 27, 13, 24, { fill: `rgba(190,230,255,${glow.toFixed(3)})` }));
  return out;
}

function sofa(v: View, x: number, y: number, w: number): Drawing {
  return [
    shadow(v, x, y + 7, w / 2),
    v.roundRect(x - w / 2, y - 12, w, 10, 3, { fill: "#2d4a7a" }),
    v.roundRect(x - w / 2, y - 4, w, 10, 3, { fill: "#3d63a3" }),
    v.roundRect(x - w / 2 - 3, y - 8, 6, 14, 2, { fill: "#2d4a7a" }),
    v.roundRect(x + w / 2 - 3, y - 8, 6, 14, 2, { fill: "#2d4a7a" }),
    v.line(x, y - 3, x, y + 5, { stroke: "#284270", weight: 1 }),
  ];
}

function plant(v: View, x: number, y: number, k: number): Drawing {
  const out: Drawing[] = [];
  // Plastic: colours too vivid, leaves too regular.
  const leaf = ["#ff2bd6", "#22e55a", "#ff7a00", "#00d5ff", "#c6ff00"][k % 5] ?? "#22e55a";
  out.push(shadow(v, x, y + 5, 8));
  out.push(v.rect(x - 6, y - 4, 12, 9, { fill: "#f4f4f5" }));
  out.push(v.rect(x - 6, y - 4, 12, 2, { fill: "#d4d4d8" }));
  for (let i = 0; i < 7; i++) {
    const a = -Math.PI / 2 + (i - 3) * 0.38;
    out.push(v.triangle(x - 1.5, y - 4, x + 1.5, y - 4, x + Math.cos(a) * 16, y - 4 + Math.sin(a) * 16, { fill: leaf }));
  }
  return out;
}

function treadmill(v: View, x: number, y: number): Drawing {
  return [
    shadow(v, x, y + 18, 12),
    v.roundRect(x - 9, y - 16, 18, 36, 3, { fill: "#374151" }),
    v.rect(x - 6, y - 10, 12, 28, { fill: "#111827" }),
    v.rect(x - 9, y - 26, 3, 12, { fill: "#6b7280" }),
    v.rect(x + 6, y - 26, 3, 12, { fill: "#6b7280" }),
    v.rect(x - 9, y - 28, 18, 5, { fill: "#9ca3af" }),
    v.rect(x - 4, y - 27, 8, 3, { fill: "#ef4444" }),
  ];
}

function bike(v: View, x: number, y: number): Drawing {
  return [
    shadow(v, x, y + 13, 9),
    v.ellipse(x, y + 8, 3, 6, { fill: "#4b5563" }),
    v.ellipse(x, y - 8, 3, 6, { fill: "#4b5563" }),
    v.line(x, y - 8, x, y + 8, { stroke: "#06b6d4", weight: 3 }),
    v.line(x - 6, y - 14, x + 6, y - 14, { stroke: "#9ca3af", weight: 2 }),
    v.ellipse(x, y + 2, 3, 4, { fill: INK }),
  ];
}

function weights(v: View, x: number, y: number): Drawing {
  const out: Drawing[] = [];
  out.push(shadow(v, x, y + 6, 16));
  out.push(v.rect(x - 15, y - 2, 30, 6, { fill: "#4b5563" }));
  for (const [i, wx] of [-11, -5, 2, 8].entries()) {
    out.push(v.circle(x + wx, y - 2, 3 + (i % 2), { fill: "#1f2937" }));
    out.push(v.circle(x + wx - 1, y - 3, 1.2, { fill: "#6b7280" }));
  }
  return out;
}

function restMat(v: View, x: number, y: number, k: number): Drawing {
  return [
    v.roundRect(x - 18, y - 7, 36, 14, 3, { fill: ["#a5f3fc", "#fbcfe8", "#ddd6fe"][k % 3] ?? "#a5f3fc" }),
    v.roundRect(x - 16, y - 5, 8, 10, 3, { fill: "#f8fafc" }),
  ];
}

function table(v: View, x: number, y: number): Drawing {
  const out: Drawing[] = [];
  for (const [cx, cy] of [[-13, 0], [13, 0], [0, -11]] as const) {
    out.push(v.rect(x + cx - 4, y + cy - 9, 8, 6, { fill: "#a16207" }));
    out.push(v.rect(x + cx - 4, y + cy - 3, 8, 4, { fill: "#854d0e" }));
  }
  out.push(shadow(v, x, y + 9, 15));
  out.push(v.ellipse(x, y - 4, 15, 9, { fill: "#92400e" }));
  out.push(v.ellipse(x, y - 6, 15, 9, { fill: "#c2771f" }));
  out.push(v.rect(x - 2, y - 2, 4, 9, { fill: "#78350f" }));
  out.push(v.circle(x - 4, y - 8, 2.2, { fill: "#fff7ed" }));
  out.push(v.circle(x + 5, y - 5, 2.2, { fill: "#fff7ed" }));
  out.push(v.rect(x + 13 - 4, y - 12, 8, 4, { fill: "#a16207" }));
  return out;
}

function counter(v: View, x: number, y: number, w: number): Drawing {
  const out: Drawing[] = [];
  out.push(shadow(v, x, y + 8, w / 2));
  out.push(v.rect(x - w / 2, y - 12, w, 18, { fill: "#a16207" }));
  out.push(v.rect(x - w / 2, y - 14, w, 6, { fill: "#fde68a" }));
  for (let i = 0; i < 5; i++) out.push(v.rect(x - w / 2 + 6 + i * 12, y - 18, 5, 5, { fill: i % 2 === 0 ? "#fff7ed" : "#f472b6" }));
  return out;
}

function chair(v: View, x: number, y: number, color: string): Drawing {
  const out: Drawing[] = [];
  // Facing east, toward nothing in particular.
  out.push(shadow(v, x, y + 6, 7));
  out.push(v.rect(x - 6, y - 6, 12, 10, { fill: color }));
  out.push(v.rect(x - 7, y - 16, 3, 20, { fill: color }));
  out.push(v.rect(x - 7, y - 16, 3, 20, { fill: "rgba(0,0,0,0.2)" }));
  for (const lx of [x - 6, x + 4]) out.push(v.rect(lx, y + 4, 2, 4, { fill: "#713f12" }));
  return out;
}

function cube(v: View, x: number, y: number): Drawing {
  const out: Drawing[] = [];
  // A cramped cubicle: three thin walls, open to the south, a desk and a lamp.
  const w = 30, h = 26, wall = 13;
  const wallTop = "#c7d2fe", wallFace = "#818cf8";
  out.push(v.rect(x - w / 2, y - h / 2 - wall, w, wall, { fill: wallFace }));
  out.push(v.rect(x - w / 2, y - h / 2 - wall - 3, w, 3, { fill: wallTop }));
  out.push(v.rect(x - 10, y - h / 2 + 1, 20, 6, { fill: "#e0e7ff" }));
  out.push(v.circle(x + 6, y - h / 2 + 3, 2, { fill: "#fde68a" }));
  for (const sx of [x - w / 2, x + w / 2 - 3]) {
    out.push(v.rect(sx, y - h / 2 - wall - 3, 3, h + 3, { fill: wallTop }));
    out.push(v.rect(sx, y + h / 2 - wall, 3, wall, { fill: wallFace }));
  }
  return out;
}

function chairRow(v: View, x: number, y: number, n: number): Drawing {
  const out: Drawing[] = [];
  out.push(shadow(v, x, y + 5, (n * 15) / 2, 4));
  for (let i = 0; i < n; i++) {
    const cx = x - ((n - 1) * 15) / 2 + i * 15;
    out.push(v.rect(cx - 6, y - 14, 12, 9, { fill: "#57534e" }));
    out.push(v.rect(cx - 6, y - 5, 12, 8, { fill: "#78716c" }));
    out.push(v.rect(cx - 6, y - 5, 12, 2, { fill: "#a8a29e" }));
  }
  return out;
}

function magazines(v: View, x: number, y: number): Drawing {
  const out: Drawing[] = [];
  for (let i = 0; i < 5; i++) out.push(v.rect(x - 7 + (i % 2) * 2, y - 2 - i * 2, 12, 3, { fill: ["#fca5a5", "#fcd34d", "#93c5fd", "#e5e7eb", "#a7f3d0"][i] ?? "#e5e7eb" }));
  return out;
}

/** On a wall face: things hung on the north wall. */
function clock(v: View, x: number, y: number, k: number): Drawing {
  const out: Drawing[] = [];
  out.push(v.circle(x, y, 6, { fill: "#f5f5f4" }));
  out.push(v.circle(x, y, 6, { stroke: INK, weight: 1.2 }));
  const h = k * 2.1 + 0.4, m = k * 4.7 + 1.1;
  out.push(v.line(x, y, x + Math.cos(h) * 3.2, y + Math.sin(h) * 3.2, { stroke: INK, weight: 1.4 }));
  out.push(v.line(x, y, x + Math.cos(m) * 4.8, y + Math.sin(m) * 4.8, { stroke: INK, weight: 0.8 }));
  return out;
}

function monitorBank(v: View, x: number, y: number, t: number): Drawing {
  const out: Drawing[] = [];
  for (let i = 0; i < 6; i++) {
    const mx = x - 52 + i * 18;
    out.push(v.rect(mx, y - 7, 16, 12, { fill: "#111827" }));
    out.push(v.rect(mx + 1.5, y - 5.5, 13, 9, { fill: "#0f3b2e" }));
    // Unreadable data scrolling, and a glitch band now and then.
    for (let r = 0; r < 3; r++) {
      const len = 4 + ((i * 7 + r * 3 + Math.floor(t / 8)) % 8);
      out.push(v.rect(mx + 3, y - 4 + r * 3, len, 1.2, { fill: "#4ade80" }));
    }
    if ((Math.floor(t / 5) + i * 3) % 11 === 0) out.push(v.rect(mx + 1.5, y - 2, 13, 3, { fill: "#f0abfc" }));
  }
  return out;
}

function signs(v: View, x: number, y: number): Drawing {
  const style = { fill: "#ecfdf5" };
  return [
    v.roundRect(x - 40, y - 5, 30, 10, 2, style),
    v.roundRect(x + 10, y - 5, 30, 10, 2, style),
    v.text("< Intake", { x: x - 25, y }, { size: 5, fill: INK, align: "center", valign: "middle" }),
    v.text("Atrium >", { x: x + 25, y }, { size: 5, fill: INK, align: "center", valign: "middle" }),
  ];
}

/** Draws one prop; (x, y) is its footprint centre in map px. */
export function paintProp(v: View, a: { prop: Prop; x: number; y: number; t: number }): Drawing {
  const out: Drawing[] = [];
  const { prop, x, y, t } = a;
  const k = prop.variant ?? 0;
  const w = (prop.size?.[0] ?? 1) * T;
  switch (prop.kind) {
    case "statue": out.push(statue(v, x, y, k)); return out;
    case "bench": out.push(bench(v, x, y, w)); return out;
    case "sign": out.push(signs(v, x, y)); return out;
    case "monitor-bank": out.push(monitorBank(v, x, y, t)); return out;
    case "vending": out.push(vending(v, x, y, t)); return out;
    case "sofa": out.push(sofa(v, x, y, w)); return out;
    case "plant": out.push(plant(v, x, y, k)); return out;
    case "treadmill": out.push(treadmill(v, x, y)); return out;
    case "bike": out.push(bike(v, x, y)); return out;
    case "weights": out.push(weights(v, x, y)); return out;
    case "rest-mat": out.push(restMat(v, x, y, k)); return out;
    case "table": out.push(table(v, x, y)); return out;
    case "counter": out.push(counter(v, x, y, w)); return out;
    case "chair": out.push(chair(v, x, y, "#a16207")); return out;
    case "cube": out.push(cube(v, x, y)); return out;
    case "chair-row": out.push(chairRow(v, x, y, 7)); return out;
    case "magazines": out.push(magazines(v, x, y)); return out;
    case "clock": out.push(clock(v, x, y, k)); return out;
    case "fountain": return out;
  }
  return out;
}

/** Props hung on a wall rather than standing on the floor. */
export function onWall(prop: Prop): boolean {
  return prop.kind === "clock" || prop.kind === "monitor-bank" || prop.kind === "sign";
}

const SKIN = ["#f1c7a5", "#c68a5e", "#8d5a3b", "#e8b48a", "#a8714a"];

/** A citizen, feet at (x, y). Walking swings the legs; lying down is along a mat. */
export function paintPerson(v: View, a: { x: number; y: number; shirt: string; t: number; pose: "walking" | "standing" | "lying" | "sitting"; k: number }): Drawing {
  const out: Drawing[] = [];
  const { x, y, shirt, t, pose, k } = a;
  const skin = SKIN[k % SKIN.length] ?? "#f1c7a5";
  const hair: Style = { fill: ["#3f2a1d", "#111827", "#9a3412", "#d6d3d1", "#713f12"][k % 5] ?? "#111827" };
  if (pose === "lying") {
    out.push(v.roundRect(x - 10, y - 5, 18, 9, 4, { fill: shirt }));
    out.push(v.circle(x - 13, y - 1, 4.2, { fill: skin }));
    out.push(v.circle(x - 14, y - 2, 3, hair));
    const z = (t / 40) % 1;
    out.push(v.text("z", { x: x - 10 + z * 6, y: y - 10 - z * 10 }, { size: 6, fill: `rgba(255,255,255,${(1 - z).toFixed(3)})`, style: "bold" }));
    return out;
  }
  const sit = pose === "sitting" ? 5 : 0;
  out.push(shadow(v, x, y + 1, 6));
  if (sit === 0) {
    const swing = pose === "walking" ? Math.sin(t * 0.35) * 2.5 : 0;
    out.push(v.rect(x - 3.5 + swing * 0.3, y - 8, 3, 8 + swing * 0.4, { fill: "#374151" }));
    out.push(v.rect(x + 0.5 - swing * 0.3, y - 8, 3, 8 - swing * 0.4, { fill: "#374151" }));
  }
  const bob = pose === "walking" ? Math.abs(Math.sin(t * 0.35)) * 0.8 : 0;
  out.push(v.roundRect(x - 5.5, y - 19 + sit - bob, 11, 12, 3, { fill: shirt }));
  out.push(v.circle(x, y - 23.5 + sit - bob, 4.6, { fill: skin }));
  out.push(v.path([["move", x - 4.8, y - 23.5 + sit - bob], ["quad", x, y - 31 + sit - bob, x + 4.8, y - 23.5 + sit - bob], ["close"]], hair));
  return out;
}
