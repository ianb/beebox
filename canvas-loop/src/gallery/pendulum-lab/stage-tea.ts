// The stage: a place to stand (Earth, Moon, Mars, Jupiter's cloud tops), a lab
// stand with a metre rule, and the pendulum itself.
import type { Drawing, Style, Vec2, View } from "@ianbicking/canvas-loop";

import { card, FONT, INK, say, sayWidth } from "./look-tea.js";
import type { Planet } from "./physics-tea.js";

export const STAGE = { x: 20, y: 60, w: 428, h: 380 };
export const PIVOT = { x: 254, y: 96 };
export const PX_PER_M = 150;
const GROUND_Y = 412;
const BOB_D = 26;

/** Fixed scatter from a small seeded generator (draw has no randomness). */
function scatter(n: number, seed: number): Vec2[] {
  const out: Vec2[] = [];
  let s = seed;
  const next = (): number => {
    s = (s * 1_103_515_245 + 12_345) % 2_147_483_648;
    return s / 2_147_483_648;
  };
  for (let i = 0; i < n; i += 1) out.push([next(), next()]);
  return out;
}

const STARS = scatter(70, 7);
const ROCKS = scatter(14, 21);

function sky(v: View, top: string, bottom: string): Drawing {
  return v.rect(STAGE.x, STAGE.y, STAGE.w, STAGE.h, { fill: v.linearGradient(0, STAGE.y, 0, GROUND_Y, [[0, top], [1, bottom]]) });
}

function ground(v: View, fill: string, rim: string): Drawing {
  return [
    v.rect(STAGE.x, GROUND_Y, STAGE.w, STAGE.y + STAGE.h - GROUND_Y, { fill }),
    v.line(STAGE.x, GROUND_Y, STAGE.x + STAGE.w, GROUND_Y, { stroke: rim, weight: 2 }),
  ];
}

function earth(v: View): Drawing {
  const out: Drawing[] = [];
  out.push(sky(v, "#bcdcf3", "#eef6fb"));
  out.push(v.curve([[20, 398], [90, 372], [170, 386], [260, 366], [360, 384], [448, 370], [448, 412], [20, 412]], true, { fill: "#b6d6a0" }));
  for (const [cx, cy] of [[120, 150], [360, 190]] as const) {
    out.push(v.group({ opacity: 0.9 }, [
      v.ellipse(cx, cy, 35, 11, { fill: "#ffffff" }),
      v.ellipse(cx - 14, cy - 8, 18, 12, { fill: "#ffffff" }),
      v.ellipse(cx + 12, cy - 6, 15, 10, { fill: "#ffffff" }),
    ]));
  }
  out.push(ground(v, "#7fb35f", "#5f9443"));
  for (let x = 30; x < 440; x += 13) {
    out.push(v.line(x, GROUND_Y + 2, x + 3, GROUND_Y - 5, { stroke: "#5f9443", weight: 1.5 }));
  }
  return out;
}

function moon(v: View): Drawing {
  const out: Drawing[] = [];
  out.push(sky(v, "#0d1222", "#2a3048"));
  for (const [sx, sy] of STARS) {
    const x = STAGE.x + 6 + sx * (STAGE.w - 12);
    const y = STAGE.y + 6 + sy * (GROUND_Y - STAGE.y - 30);
    out.push(v.circle(x, y, (sx > 0.8 ? 2.6 : 1.6) / 2, { fill: sy > 0.5 ? "#c9d3ff" : "#ffffff" }));
  }
  out.push(v.circle(88, 150, 17, { fill: "#3d7fd6" }));
  out.push(v.clip([[[71, 133], [105, 133], [105, 167], [71, 167]]], [
    v.ellipse(82, 146, 8, 6, { fill: "#6cbf6a" }),
    v.ellipse(96, 158, 5, 3.5, { fill: "#6cbf6a" }),
  ]));
  out.push(ground(v, "#a7a6ab", "#7d7c83"));
  for (const [rx, ry] of ROCKS.slice(0, 7)) {
    const x = STAGE.x + 20 + rx * (STAGE.w - 40);
    const y = GROUND_Y + 8 + ry * 14;
    out.push(v.ellipse(x, y, (22 + rx * 16) / 2, 3, { fill: "#8d8c93", stroke: "#77767d", weight: 1 }));
  }
  return out;
}

function mars(v: View): Drawing {
  const out: Drawing[] = [];
  out.push(sky(v, "#e7b48a", "#f7dfc6"));
  out.push(v.circle(380, 136, 10, { fill: "#fbf3e4" }));
  out.push(v.curve([[20, 396], [110, 360], [200, 392], [300, 374], [448, 392], [448, 412], [20, 412]], true, { fill: "#d58b62" }));
  out.push(ground(v, "#b9573a", "#94402a"));
  for (const [rx, ry] of ROCKS) {
    const x = STAGE.x + 14 + rx * (STAGE.w - 28);
    const y = GROUND_Y + 6 + ry * 18;
    out.push(v.ellipse(x, y, (6 + ry * 8) / 2, (4 + ry * 4) / 2, { fill: "#8f3c26" }));
  }
  return out;
}

function jupiter(v: View): Drawing {
  const out: Drawing[] = [];
  out.push(sky(v, "#2b2140", "#a07a6a"));
  for (const [sx, sy] of STARS.slice(0, 30)) {
    out.push(v.circle(STAGE.x + 6 + sx * (STAGE.w - 12), STAGE.y + 6 + sy * 120, 0.75, { fill: "#f4ead8" }));
  }
  const bands = ["#f0dcc0", "#d9a173", "#efe2cc", "#c97f4f", "#e9d2b0"];
  for (const [i, fill] of bands.entries()) {
    const y = GROUND_Y - 34 + i * 14;
    const pts: Vec2[] = [];
    for (let x = 20; x <= 448; x += 32) pts.push([x, y + Math.sin(x / 37 + i) * 4]);
    out.push(v.polygon([...pts, [448, 440], [20, 440]], { fill }));
  }
  out.push(v.ellipse(338, GROUND_Y + 4, 27, 9, { fill: "#b5523a" }));
  out.push(v.ellipse(338, GROUND_Y + 4, 17, 5, { fill: "#c9694c" }));
  return out;
}

const WOOD: Style = { fill: "#a8743f", stroke: "#6e4723", weight: 1.25 };

function stand(v: View): Drawing {
  const out: Drawing[] = [];
  // base, post and the arm the pivot hangs from
  out.push(v.roundRect(26, GROUND_Y - 6, 50, 10, 3, { fill: "#4b4f5a", stroke: "#2f323a", weight: 1 }));
  out.push(v.rect(30, PIVOT.y - 16, 12, GROUND_Y - PIVOT.y + 10, WOOD));
  out.push(v.rect(30, PIVOT.y - 16, PIVOT.x - 30 + 24, 12, WOOD));
  out.push(v.rect(PIVOT.x - 6, PIVOT.y - 6, 12, 8, { fill: "#4b4f5a" }));
  // a metre rule hung from the arm, zero at the pivot
  const left = 44;
  const right = left + 24;
  out.push(v.rect(left, PIVOT.y, 24, 2 * PX_PER_M + 4, { fill: "#f7e7a6", stroke: "#b49a45", weight: 1 }));
  for (let cm = 10; cm <= 200; cm += 10) {
    const y = PIVOT.y + (cm / 100) * PX_PER_M;
    const major = cm % 50 === 0;
    out.push(v.line(right - (major ? 9 : 5), y, right, y, { stroke: "#5c4b17", weight: major ? 1.4 : 0.8 }));
    if (major) {
      out.push(v.text((cm / 100).toFixed(1), { x: left + 2, y }, { size: 9, font: FONT, style: "bold", fill: "#5c4b17", align: "left", valign: "middle" }));
    }
  }
  return out;
}

export function drawBackdrop(v: View, planet: Planet): Drawing {
  return v.place(v.picture({ key: `stage-${planet}`, width: v.width, height: v.height }, () => {
    const drawn: Drawing[] = [];
    drawn.push(card(v, STAGE));
    const outline: Vec2[] = [
      [STAGE.x, STAGE.y],
      [STAGE.x + STAGE.w, STAGE.y],
      [STAGE.x + STAGE.w, STAGE.y + STAGE.h],
      [STAGE.x, STAGE.y + STAGE.h],
    ];
    drawn.push(v.clip(outline, ((): Drawing => {
      const parts: Drawing[] = [];
      switch (planet) {
        case "Earth":
          parts.push(earth(v));
          break;
        case "Moon":
          parts.push(moon(v));
          break;
        case "Mars":
          parts.push(mars(v));
          break;
        case "Jupiter":
          parts.push(jupiter(v));
          break;
      }
      parts.push(stand(v));
      return parts;
    })()));
    return drawn;
  }), 0, 0);
}

export function bobAt(a: { theta: number; length: number }): { x: number; y: number } {
  const r = a.length * PX_PER_M;
  return { x: PIVOT.x + r * Math.sin(a.theta), y: PIVOT.y + r * Math.cos(a.theta) };
}

function dashedLine(v: View, a: { from: Vec2; to: Vec2; dash: number; style: Style }): Drawing {
  const out: Drawing[] = [];
  const [x1, y1] = a.from;
  const [x2, y2] = a.to;
  const n = Math.max(1, Math.floor(Math.hypot(x2 - x1, y2 - y1) / a.dash));
  for (let i = 0; i < n; i += 2) {
    const t0 = i / n;
    const t1 = Math.min(1, (i + 1) / n);
    out.push(v.line(x1 + (x2 - x1) * t0, y1 + (y2 - y1) * t0, x1 + (x2 - x1) * t1, y1 + (y2 - y1) * t1, a.style));
  }
  return out;
}

function bob(v: View, at: { x: number; y: number; opacity: number }): Drawing {
  const out: Drawing[] = [];
  const { x, y } = at;
  const body = (): Drawing => {
    return v.circle(x, y, BOB_D / 2, {
      fill: v.radialGradient(x - 4, y - 5, BOB_D * 0.65, [[0, "#ffe9a8"], [0.45, "#d9a43a"], [1, "#8a5a14"]]),
      stroke: "#6b440f",
      weight: 1.25,
    });
  };
  if (at.opacity >= 1) out.push(body());
  else out.push(v.group({ opacity: at.opacity }, body()));
  return out;
}

export interface PendulumPose {
  theta: number;
  omega: number;
  length: number;
  /** Release angle in degrees (for the guide arc). */
  angle: number;
  held: boolean;
  /** Dark sky (Moon, Jupiter): guide marks are drawn light. */
  dark: boolean;
}

export function drawPendulum(v: View, pose: PendulumPose): Drawing {
  const out: Drawing[] = [];
  const { theta, length } = pose;
  const r = length * PX_PER_M;
  const restEnd: Vec2 = [PIVOT.x, PIVOT.y + r + 22];
  out.push(dashedLine(v, { from: [PIVOT.x, PIVOT.y], to: restEnd, dash: 5, style: { stroke: pose.dark ? "rgba(255, 255, 255, 0.4)" : "rgba(42, 40, 51, 0.35)", weight: 1 } }));
  const amp = (pose.angle * Math.PI) / 180;
  // the path the bob travels, faintly
  if (!pose.held) {
    out.push(v.arc(PIVOT.x, PIVOT.y, r, Math.PI / 2 - amp, Math.PI / 2 + amp, { stroke: "rgba(255, 255, 255, 0.55)", weight: 3 }));
  }
  // angle guide
  const guideR = Math.min(56, r * 0.6);
  if (pose.held) {
    const ink = pose.dark ? "#f4ead8" : INK;
    out.push(v.arc(PIVOT.x, PIVOT.y, guideR, Math.PI / 2 - amp, Math.PI / 2, { stroke: ink, weight: 1.5 }));
    const mid = Math.PI / 2 - amp - 0.1;
    out.push(say(v, `${pose.angle}°`, { x: PIVOT.x + (guideR + 14) * Math.cos(mid), y: PIVOT.y + (guideR + 14) * Math.sin(mid) }, { size: 13, bold: true, fill: ink, align: "left", valign: "middle" }));
  }
  // shadow on the ground
  const p = bobAt({ theta, length });
  const lift = Math.max(0, GROUND_Y - p.y);
  out.push(v.ellipse(p.x, GROUND_Y + 6, (34 + lift * 0.05) / 2, 3, { fill: `rgba(30, 20, 10, ${(0.28 - Math.min(0.2, lift / 1500)).toFixed(3)})` }));
  // motion ghosts trail behind the bob
  for (const k of [3, 2, 1]) {
    const g = bobAt({ theta: theta - pose.omega * k * 0.035, length });
    if (Math.abs(pose.omega) > 0.05) out.push(bob(v, { x: g.x, y: g.y, opacity: 0.12 * (4 - k) }));
  }
  out.push(v.line(PIVOT.x, PIVOT.y, p.x, p.y, { stroke: pose.dark ? "#d8d2e4" : "#3a3540", weight: 1.5 }));
  out.push(v.circle(PIVOT.x, PIVOT.y, 3, { fill: "#2f323a" }));
  out.push(bob(v, { x: p.x, y: p.y, opacity: 1 }));
  // the length, marked on the rule
  const markY = PIVOT.y + r;
  out.push(v.triangle(70, markY, 78, markY - 5, 78, markY + 5, { fill: "#c03a2b" }));
  out.push(say(v, `${length.toFixed(2)} m`, { x: 81, y: markY }, { size: 12, bold: true, fill: "#c03a2b", valign: "middle" }));
  if (pose.held) {
    const hint = "held: click the ball to let go";
    const hw = sayWidth(v, hint, { size: 11, italic: true }) + 14;
    const hy = Math.min(p.y + 18, GROUND_Y - 4);
    out.push(v.roundRect(p.x - hw / 2, hy, hw, 18, 9, { fill: "rgba(255, 255, 255, 0.85)" }));
    out.push(say(v, hint, { x: p.x, y: hy + 9 }, { size: 11, fill: INK, align: "center", valign: "middle", italic: true }));
  }
  return out;
}
