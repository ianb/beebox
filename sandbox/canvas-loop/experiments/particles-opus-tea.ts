// Particle fountain, TEA edition. A moving emitter near the top spews particles
// that fall under gravity, drift, age, and die. Declared params drive a control
// panel; direct pointer manipulation drops a gravity well the particles bend
// toward:
//
//   - `rate` (number)   particles spawned per frame (fractional → probabilistic)
//   - `gravity` (number) downward acceleration added to every particle each tick
//   - `trails` (boolean) motion trails (translucent overlay) vs a clean redraw
//   - `palette` (select) "warm" | "cool" | "mono" — recolors *live* particles
//   - `burst` (trigger)  instantly spawn a large radial burst at the emitter
//
// Direct manipulation stays the sketch's own: mousedown drops an attractor that
// pulls nearby particles toward it, dragging moves it, mouseup removes it — a
// discriminated-union `mode` field. All state lives in Model; the only way it
// changes is `update` returning a new Model; the switch on `msg.type` is
// exhaustive; `draw` only paints. See TEA.md.
import type { DeepReadonly, Msg, ParamsDecl, ParamValues, Util, View } from "../src/tea.js";

export const params = {
  rate: { type: "number", min: 0, max: 12, default: 3, step: 0.5 },
  gravity: { type: "number", min: -0.4, max: 1, default: 0.15, step: 0.05 },
  trails: { type: "boolean", default: false },
  palette: { type: "select", options: ["warm", "cool", "mono"], default: "warm" },
  burst: { type: "trigger" },
} as const satisfies ParamsDecl;

export const canvas = { width: 600, height: 420 };

type Params = ParamValues<typeof params>;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  tint: number; // 0..1, stable per particle; palette maps it to a color
}

type Mode = { type: "idle" } | { type: "attract"; x: number; y: number };

export interface Model {
  particles: readonly Particle[];
  frame: number;
  mode: Mode;
}

const CANVAS_W = 600;
const CANVAS_H = 420;
const EMIT_Y = 55;
const EMIT_AMP = 210;
const EMIT_SPEED = 0.05;
const ATTRACT_STRENGTH = 65;
const BURST_COUNT = 140;

// ── Emitter path — a pure function of frame, so spawn position is a calculation.
function emitterX(frame: number): number {
  return CANVAS_W / 2 + EMIT_AMP * Math.sin(frame * EMIT_SPEED);
}

// ── Spawning ─────────────────────────────────────────────────────────
function makeParticle(a: { ex: number; u: Util<typeof params> }): Particle {
  const { ex, u } = a;
  return {
    x: ex + u.random(-6, 6),
    y: EMIT_Y + u.random(-4, 4),
    vx: u.random(-1.4, 1.4),
    vy: u.random(0, 1),
    age: 0,
    life: u.random(70, 150),
    tint: u.random(),
  };
}

function burstParticle(a: { ex: number; u: Util<typeof params> }): Particle {
  const { ex, u } = a;
  const angle = u.random(0, Math.PI * 2);
  const speed = u.random(1.5, 5);
  return {
    x: ex,
    y: EMIT_Y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    age: 0,
    life: u.random(50, 120),
    tint: u.random(),
  };
}

// Fractional rate: floor plus a probabilistic extra for the remainder.
function spawnCount(a: { rate: number; u: Util<typeof params> }): number {
  const base = Math.floor(a.rate);
  const frac = a.rate - base;
  return base + (a.u.random() < frac ? 1 : 0);
}

// ── Physics ──────────────────────────────────────────────────────────
function attractorPull(a: { mode: Mode; x: number; y: number }): { ax: number; ay: number } {
  if (a.mode.type !== "attract") return { ax: 0, ay: 0 };
  const dx = a.mode.x - a.x;
  const dy = a.mode.y - a.y;
  const d = Math.hypot(dx, dy) + 0.001;
  const f = ATTRACT_STRENGTH / (d + 30);
  return { ax: (dx / d) * f, ay: (dy / d) * f };
}

function step(a: { p: Particle; gravity: number; mode: Mode }): Particle {
  const { p, gravity, mode } = a;
  const pull = attractorPull({ mode, x: p.x, y: p.y });
  const vx = p.vx + pull.ax;
  const vy = p.vy + gravity + pull.ay;
  return { ...p, x: p.x + vx, y: p.y + vy, vx, vy, age: p.age + 1 };
}

function alive(p: Particle): boolean {
  return p.age < p.life && p.y < CANVAS_H + 30 && p.x > -30 && p.x < CANVAS_W + 30;
}

function advance(a: { model: DeepReadonly<Model>; frame: number; u: Util<typeof params> }): Model {
  const { model, frame, u } = a;
  const ex = emitterX(frame);
  const count = spawnCount({ rate: u.params.rate, u });
  const born = Array.from({ length: count }, () => makeParticle({ ex, u }));
  const gravity = u.params.gravity;
  const stepped = [...model.particles, ...born]
    .map((p) => step({ p, gravity, mode: model.mode }))
    .filter(alive);
  return { ...model, frame, particles: stepped };
}

function spawnBurst(a: { model: DeepReadonly<Model>; u: Util<typeof params> }): Model {
  const { model, u } = a;
  const ex = emitterX(model.frame);
  const born = Array.from({ length: BURST_COUNT }, () => burstParticle({ ex, u }));
  u.log(`burst: +${BURST_COUNT} particles`);
  return { ...model, particles: [...model.particles, ...born] };
}

export function init(): Model {
  return { particles: [], frame: 0, mode: { type: "idle" } };
}

// eslint-disable-next-line max-params -- TEA contract signature
export function update(model: DeepReadonly<Model>, msg: Msg, u: Util<typeof params>): Model {
  switch (msg.type) {
    case "tick":
      return advance({ model, frame: msg.frame, u });
    case "mousedown":
      u.log(`attractor on @ ${msg.x.toFixed(0)},${msg.y.toFixed(0)}`);
      return { ...model, mode: { type: "attract", x: msg.x, y: msg.y } };
    case "mousemove":
      // Treat a move as a drag only while the attractor is held.
      return model.mode.type === "attract" ? { ...model, mode: { type: "attract", x: msg.x, y: msg.y } } : model;
    case "mouseup":
      if (model.mode.type === "attract") u.log("attractor off");
      return { ...model, mode: { type: "idle" } };
    case "keydown":
    case "keyup":
      return model;
    case "param":
      return model;
    case "trigger":
      return msg.name === "burst" ? spawnBurst({ model, u }) : model;
  }
}

// ── Rendering ────────────────────────────────────────────────────────
function particleColor(a: { tint: number; palette: Params["palette"]; alpha: number }): string {
  const { tint, palette, alpha } = a;
  const al = alpha.toFixed(2);
  switch (palette) {
    case "warm":
      return `hsla(${(10 + tint * 50).toFixed(0)}, 90%, 58%, ${al})`;
    case "cool":
      return `hsla(${(185 + tint * 80).toFixed(0)}, 85%, 62%, ${al})`;
    case "mono":
      return `hsla(0, 0%, ${(45 + tint * 45).toFixed(0)}%, ${al})`;
  }
}

function drawParticles(a: { v: View; model: DeepReadonly<Model>; palette: Params["palette"] }): void {
  const { v, model, palette } = a;
  v.noStroke();
  for (const p of model.particles) {
    const remaining = 1 - p.age / p.life;
    const alpha = Math.max(0, Math.min(1, remaining));
    v.fill(particleColor({ tint: p.tint, palette, alpha }));
    const size = 2.5 + remaining * 3.5;
    v.circle(p.x, p.y, size);
  }
}

function drawEmitter(v: View, frame: number): void {
  const ex = emitterX(frame);
  v.noStroke();
  v.fill("rgba(226, 232, 240, 0.85)");
  v.circle(ex, EMIT_Y, 10);
  v.fill("rgba(148, 163, 184, 0.35)");
  v.circle(ex, EMIT_Y, 20);
}

function drawAttractor(v: View, mode: Mode): void {
  if (mode.type !== "attract") return;
  v.noFill();
  v.stroke("#f472b6");
  v.strokeWeight(2);
  v.circle(mode.x, mode.y, 34);
  v.circle(mode.x, mode.y, 14);
  v.line(mode.x - 22, mode.y, mode.x + 22, mode.y);
  v.line(mode.x, mode.y - 22, mode.x, mode.y + 22);
}

function drawHud(a: { v: View; model: DeepReadonly<Model>; p: Params }): void {
  const { v, model, p } = a;
  // Opaque backing so the HUD stays crisp even under translucent trails.
  v.noStroke();
  v.fill("#090c18");
  v.rect(0, 0, 300, 46);
  v.fill("#e2e8f0");
  v.textSize(14);
  v.textAlign("left", "top");
  v.text(`frame ${model.frame}   particles ${model.particles.length}`, 10, 10);
  const attractor = model.mode.type === "attract" ? "on" : "off";
  v.text(`palette ${p.palette}   attractor ${attractor}`, 10, 28);
}

// eslint-disable-next-line max-params -- TEA contract signature
export function draw(v: View, model: DeepReadonly<Model>, p: Params): void {
  if (p.trails) {
    // Translucent overlay preserves prior frames → motion trails.
    v.noStroke();
    v.fill("rgba(9, 12, 24, 0.20)");
    v.rect(0, 0, v.width, v.height);
  } else {
    v.background("#090c18");
  }

  drawEmitter(v, model.frame);
  drawParticles({ v, model, palette: p.palette });
  drawAttractor(v, model.mode);
  drawHud({ v, model, p });
}
