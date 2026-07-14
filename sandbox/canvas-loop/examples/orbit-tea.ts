// Orbit toy, TEA edition — a port of experiments/orbits.ts to The Elm
// Architecture. A sun with three orbiting planets:
//
//   - declared params drive a control panel: `speed-scale` (slider) multiplies
//     every planet's angular speed, `show-orbits` toggles the orbit rings,
//     `focus` (select) picks which planet the HUD details, `reset` (trigger)
//     restores the initial world.
//   - direct manipulation stays the sketch's own: click a planet to select it,
//     ArrowUp/ArrowDown nudge the *selected* planet's base speed.
//
// All state lives in Model; the only way it changes is `update` returning a new
// Model; selection is a discriminated-union `mode`; the switch on `msg.type` is
// exhaustive. `draw` only paints. See TEA.md.
import type { DeepReadonly, Msg, ParamsDecl, ParamValues, Util, View } from "../src/tea.js";

export const params = {
  "speed-scale": { type: "number", min: 0, max: 3, default: 1, step: 0.1 },
  "show-orbits": { type: "boolean", default: true },
  focus: { type: "select", options: ["Mercury", "Venus", "Earth"], default: "Mercury" },
  reset: { type: "trigger" },
} as const satisfies ParamsDecl;

export const canvas = { width: 500, height: 400 };

type Params = ParamValues<typeof params>;

interface Planet {
  name: string;
  orbitRadius: number;
  angle0: number;
  speed: number;
  size: number;
  color: string;
}

type Mode = { type: "idle" } | { type: "selected"; index: number };

export interface Model {
  planets: readonly Planet[];
  frame: number;
  mode: Mode;
}

const CENTER_X = 250;
const CENTER_Y = 200;
const SUN_RADIUS = 20;
const SPEED_STEP = 0.01;
const HIT_PADDING = 4;

function initialPlanets(): readonly Planet[] {
  return [
    { name: "Mercury", orbitRadius: 60, angle0: 0, speed: 0.06, size: 10, color: "#f59e0b" },
    { name: "Venus", orbitRadius: 100, angle0: 2.1, speed: -0.035, size: 14, color: "#38bdf8" },
    { name: "Earth", orbitRadius: 150, angle0: 4.2, speed: 0.02, size: 16, color: "#22c55e" },
  ];
}

function planetPos(params_: { planet: Planet; frame: number; scale: number }): { x: number; y: number } {
  const { planet, frame, scale } = params_;
  const angle = planet.angle0 + planet.speed * scale * frame;
  return { x: CENTER_X + planet.orbitRadius * Math.cos(angle), y: CENTER_Y + planet.orbitRadius * Math.sin(angle) };
}

function hitTest(params_: { model: DeepReadonly<Model>; x: number; y: number; scale: number }): number {
  const { model, x, y, scale } = params_;
  for (let i = 0; i < model.planets.length; i++) {
    const planet = model.planets[i];
    if (planet === undefined) continue;
    const pos = planetPos({ planet, frame: model.frame, scale });
    const dx = x - pos.x;
    const dy = y - pos.y;
    const hitRadius = planet.size / 2 + HIT_PADDING;
    if (dx * dx + dy * dy <= hitRadius * hitRadius) return i;
  }
  return -1;
}

function withSpeed(params_: { planets: readonly Planet[]; index: number; delta: number }): readonly Planet[] {
  const { planets, index, delta } = params_;
  return planets.map((planet, i) => (i === index ? { ...planet, speed: planet.speed + delta } : planet));
}

function selectAt(params_: { model: DeepReadonly<Model>; x: number; y: number; u: Util<typeof params> }): Model {
  const { model, x, y, u } = params_;
  const hit = hitTest({ model, x, y, scale: u.params["speed-scale"] });
  if (hit < 0) {
    u.log("deselected (empty space)");
    return { ...model, mode: { type: "idle" } };
  }
  u.log(`selected ${model.planets[hit]?.name ?? "?"}`);
  return { ...model, mode: { type: "selected", index: hit } };
}

function nudgeSelected(params_: { model: DeepReadonly<Model>; key: string; u: Util<typeof params> }): Model {
  const { model, key, u } = params_;
  if (model.mode.type !== "selected") return model;
  const index = model.mode.index;
  const planet = model.planets[index];
  if (planet === undefined) return model;
  const step = planet.speed >= 0 ? SPEED_STEP : -SPEED_STEP;
  if (key === "ArrowUp") {
    u.log(`${planet.name} speed -> ${(planet.speed + step).toFixed(3)}`);
    return { ...model, planets: withSpeed({ planets: model.planets, index, delta: step }) };
  }
  if (key === "ArrowDown") {
    u.log(`${planet.name} speed -> ${(planet.speed - step).toFixed(3)}`);
    return { ...model, planets: withSpeed({ planets: model.planets, index, delta: -step }) };
  }
  return model;
}

export function init(): Model {
  return { planets: initialPlanets(), frame: 0, mode: { type: "idle" } };
}

// eslint-disable-next-line max-params -- TEA contract: update(model, msg, util) is the framework-defined reducer signature
export function update(model: DeepReadonly<Model>, msg: Msg, u: Util<typeof params>): Model {
  switch (msg.type) {
    case "tick":
      return { ...model, frame: msg.frame };
    case "mousedown":
      return selectAt({ model, x: msg.x, y: msg.y, u });
    case "mouseup":
    case "mousemove":
      return model;
    case "keydown":
      return nudgeSelected({ model, key: msg.key, u });
    case "keyup":
      return model;
    case "param":
      return model;
    case "trigger":
      return msg.name === "reset" ? init() : model;
  }
}

function drawHud(params_: { v: View; model: DeepReadonly<Model>; p: Params }): void {
  const { v, model, p } = params_;
  v.noStroke();
  v.fill("#e2e8f0");
  v.textSize(14);
  v.textAlign("left", "top");
  v.text(`frame ${model.frame}   speed x${p["speed-scale"].toFixed(1)}`, 8, 8);
  const focused = model.planets.find((planet) => planet.name === p.focus);
  const selectedName = model.mode.type === "selected" ? (model.planets[model.mode.index]?.name ?? "?") : "none";
  v.text(`selected: ${selectedName}`, 8, 26);
  if (focused !== undefined) {
    v.text(`focus ${focused.name}: base speed ${focused.speed.toFixed(3)}`, 8, 44);
  }
}

// eslint-disable-next-line max-params -- TEA contract: draw(view, model, params) is the framework-defined render signature
export function draw(v: View, model: DeepReadonly<Model>, p: Params): void {
  v.background("#0b1020");
  const scale = p["speed-scale"];

  if (p["show-orbits"]) {
    v.noFill();
    v.stroke("#1e293b");
    v.strokeWeight(1);
    for (const planet of model.planets) v.circle(CENTER_X, CENTER_Y, planet.orbitRadius * 2);
  }

  v.noStroke();
  v.fill("#facc15");
  v.circle(CENTER_X, CENTER_Y, SUN_RADIUS * 2);

  for (let i = 0; i < model.planets.length; i++) {
    const planet = model.planets[i];
    if (planet === undefined) continue;
    const pos = planetPos({ planet, frame: model.frame, scale });
    v.noStroke();
    v.fill(planet.color);
    v.circle(pos.x, pos.y, planet.size);
    if (model.mode.type === "selected" && model.mode.index === i) {
      v.noFill();
      v.stroke("#f8fafc");
      v.strokeWeight(2);
      v.circle(pos.x, pos.y, planet.size + HIT_PADDING * 2 + 4);
    }
  }

  drawHud({ v, model, p });
}
