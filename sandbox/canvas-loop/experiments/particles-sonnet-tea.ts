// Particle fountain, TEA edition. A moving emitter continuously spawns
// particles that fall under gravity and fade out over a finite lifetime.
//
//   - declared params: `rate` (particles spawned per frame), `gravity`
//     (downward acceleration), `trails` (motion-trail vs clean redraw),
//     `palette` (warm/cool/mono particle coloring), `burst` (trigger: spawn a
//     large batch instantly).
//   - direct manipulation stays the sketch's own: mousedown places an
//     attractor that pulls every live particle toward it; dragging (mousemove
//     while pressed) moves it; mouseup removes it. A crosshair marks it while
//     active.
//
// All state lives in Model; the only way it changes is `update` returning a
// new Model; the switch on `msg.type` is exhaustive. `draw` only paints. See
// TEA.md.
import type { DeepReadonly, Msg, ParamsDecl, ParamValues, Util, View } from "../src/tea.js";

export const params = {
  rate: { type: "number", min: 0, max: 12, default: 3, step: 0.5 },
  gravity: { type: "number", min: -0.3, max: 0.5, default: 0.08, step: 0.01 },
  trails: { type: "boolean", default: false },
  palette: { type: "select", options: ["warm", "cool", "mono"], default: "warm" },
  burst: { type: "trigger" },
} as const satisfies ParamsDecl;

export const canvas = { width: 480, height: 360 };

type Params = ParamValues<typeof params>;
type Palette = Params["palette"];

const CANVAS_WIDTH = canvas.width;
const CANVAS_HEIGHT = canvas.height;
const MAX_PARTICLES = 700;
const BURST_COUNT = 120;
const ATTRACT_STRENGTH = 0.5;
const MIN_ATTRACT_DIST = 8;
const MIN_LIFE = 50;
const MAX_LIFE = 110;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  maxAge: number;
  variant: number;
}

export interface Model {
  frame: number;
  particles: readonly Particle[];
  emitter: { x: number; y: number };
  attractor: { x: number; y: number } | null;
}

function emitterAt(frame: number): { x: number; y: number } {
  return {
    x: CANVAS_WIDTH / 2 + Math.sin(frame * 0.04) * (CANVAS_WIDTH / 2 - 60),
    y: 50 + Math.cos(frame * 0.025) * 20,
  };
}

function spawnParticle(params_: { emitter: { x: number; y: number }; u: Util<typeof params> }): Particle {
  const { emitter, u } = params_;
  return {
    x: emitter.x,
    y: emitter.y,
    vx: u.random(-1, 1),
    vy: u.random(-0.5, 0.5),
    age: 0,
    maxAge: Math.floor(u.random(MIN_LIFE, MAX_LIFE)),
    variant: u.random(),
  };
}

function spawnCount(params_: { rate: number; u: Util<typeof params> }): number {
  const { rate, u } = params_;
  const whole = Math.floor(rate);
  const frac = rate - whole;
  return whole + (u.random() < frac ? 1 : 0);
}

function advanceParticle(params_: {
  particle: Particle;
  gravity: number;
  attractor: { x: number; y: number } | null;
}): Particle {
  const { particle, gravity, attractor } = params_;
  let vx = particle.vx;
  let vy = particle.vy + gravity;
  if (attractor !== null) {
    const dx = attractor.x - particle.x;
    const dy = attractor.y - particle.y;
    const dist = Math.max(Math.hypot(dx, dy), MIN_ATTRACT_DIST);
    vx += (dx / dist) * ATTRACT_STRENGTH;
    vy += (dy / dist) * ATTRACT_STRENGTH;
  }
  return { ...particle, x: particle.x + vx, y: particle.y + vy, vx, vy, age: particle.age + 1 };
}

function stepParticles(params_: {
  particles: readonly Particle[];
  gravity: number;
  attractor: { x: number; y: number } | null;
}): readonly Particle[] {
  const { particles, gravity, attractor } = params_;
  return particles
    .map((particle) => advanceParticle({ particle, gravity, attractor }))
    .filter((particle) => particle.age < particle.maxAge);
}

function capParticles(particles: readonly Particle[]): readonly Particle[] {
  return particles.length > MAX_PARTICLES ? particles.slice(particles.length - MAX_PARTICLES) : particles;
}

function tick(params_: { model: DeepReadonly<Model>; frame: number; u: Util<typeof params> }): Model {
  const { model, frame, u } = params_;
  const emitter = emitterAt(frame);
  const advanced = stepParticles({ particles: model.particles, gravity: u.params.gravity, attractor: model.attractor });
  const count = spawnCount({ rate: u.params.rate, u });
  const spawned: Particle[] = [];
  for (let i = 0; i < count; i++) spawned.push(spawnParticle({ emitter, u }));
  return { frame, emitter, attractor: model.attractor, particles: capParticles([...advanced, ...spawned]) };
}

function burst(params_: { model: DeepReadonly<Model>; u: Util<typeof params> }): Model {
  const { model, u } = params_;
  const spawned: Particle[] = [];
  for (let i = 0; i < BURST_COUNT; i++) spawned.push(spawnParticle({ emitter: model.emitter, u }));
  return { ...model, particles: capParticles([...model.particles, ...spawned]) };
}

export function init(): Model {
  return { frame: 0, particles: [], emitter: emitterAt(0), attractor: null };
}

// eslint-disable-next-line max-params -- TEA contract: update(model, msg, util) is the framework-defined reducer signature
export function update(model: DeepReadonly<Model>, msg: Msg, u: Util<typeof params>): Model {
  switch (msg.type) {
    case "tick":
      return tick({ model, frame: msg.frame, u });
    case "mousedown":
      u.log(`attractor on at (${msg.x}, ${msg.y})`);
      return { ...model, attractor: { x: msg.x, y: msg.y } };
    case "mousemove":
      return model.attractor === null ? model : { ...model, attractor: { x: msg.x, y: msg.y } };
    case "mouseup":
      u.log("attractor off");
      return { ...model, attractor: null };
    case "keydown":
    case "keyup":
      return model;
    case "param":
      return model;
    case "trigger":
      if (msg.name === "burst") {
        u.log(`burst: +${BURST_COUNT} particles`);
        return burst({ model, u });
      }
      return model;
  }
}

function paletteColor(params_: { palette: Palette; variant: number; alpha: number }): string {
  const { palette, variant, alpha } = params_;
  if (palette === "warm") {
    const hue = 10 + variant * 45; // red -> amber
    return `hsla(${hue}, 90%, 55%, ${alpha})`;
  }
  if (palette === "cool") {
    const hue = 180 + variant * 80; // cyan -> violet
    return `hsla(${hue}, 85%, 60%, ${alpha})`;
  }
  const lightness = 45 + variant * 45; // dark gray -> white
  return `hsla(0, 0%, ${lightness}%, ${alpha})`;
}

function drawParticle(params_: { v: View; particle: Particle; palette: Palette }): void {
  const { v, particle, palette } = params_;
  const lifeFrac = 1 - particle.age / particle.maxAge;
  const size = 2 + particle.variant * 4;
  v.noStroke();
  v.fill(paletteColor({ palette, variant: particle.variant, alpha: Math.max(lifeFrac, 0) }));
  v.circle(particle.x, particle.y, size);
}

function drawEmitter(params_: { v: View; emitter: { x: number; y: number } }): void {
  const { v, emitter } = params_;
  v.noFill();
  v.stroke("#f8fafc");
  v.strokeWeight(1.5);
  v.circle(emitter.x, emitter.y, 10);
}

function drawAttractor(params_: { v: View; attractor: { x: number; y: number } }): void {
  const { v, attractor } = params_;
  const { x, y } = attractor;
  v.noFill();
  v.stroke("#fde047");
  v.strokeWeight(2);
  v.circle(x, y, 18);
  v.line(x - 12, y, x + 12, y);
  v.line(x, y - 12, x, y + 12);
}

function drawHud(params_: { v: View; model: DeepReadonly<Model>; p: Params }): void {
  const { v, model, p } = params_;
  v.noStroke();
  v.fill("#e2e8f0");
  v.textSize(14);
  v.textAlign("left", "top");
  v.text(`frame ${model.frame}   particles ${model.particles.length}`, 8, 8);
  v.text(`palette ${p.palette}   attractor ${model.attractor === null ? "off" : "on"}`, 8, 26);
}

// eslint-disable-next-line max-params -- TEA contract: draw(view, model, params) is the framework-defined render signature
export function draw(v: View, model: DeepReadonly<Model>, p: Params): void {
  if (p.trails) {
    v.fill("rgba(11, 16, 32, 0.18)");
    v.noStroke();
    v.rect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  } else {
    v.background("#0b1020");
  }

  for (const particle of model.particles) drawParticle({ v, particle, palette: p.palette });

  drawEmitter({ v, emitter: model.emitter });
  if (model.attractor !== null) drawAttractor({ v, attractor: model.attractor });

  drawHud({ v, model, p });
}
