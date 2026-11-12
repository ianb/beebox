// Orbit toy: a sun with three orbiting planets.
//
//   - click a planet to select it (highlight ring)
//   - click empty space to deselect
//   - ArrowUp/ArrowDown while a planet is selected speeds it up / slows it down
//   - HUD (top-left) shows frame count + selected planet name & angular speed
//
// Position is angle-based: angle(frame) = angle0 + speed * frame, recomputed
// fresh each frame (not accumulated), so a speed change takes effect
// immediately and hit-testing in `update` (which runs *before* that frame's
// draw) can predict the exact on-screen spot with the same formula.
import type {
  DeepReadonly,
  Msg,
  Style,
  Util,
  View,
} from "@ianbicking/canvas-loop";

interface Planet {
  name: string;
  orbitRadius: number;
  angle0: number;
  speed: number;
  size: number;
  color: string;
}

export interface Model {
  planets: readonly Planet[];
  /** The last frame ticked: -1 before the first tick, so the frame being drawn next is `frame + 1`. */
  frame: number;
  selected: number | null;
}

const CENTER_X = 250;
const CENTER_Y = 200;
const SUN_RADIUS = 20;
const SPEED_STEP = 0.01;
const HIT_PADDING = 4;

const ORBIT_RING: Style = { stroke: "#1e293b", weight: 1 };
const SELECTION_RING: Style = { stroke: "#f8fafc", weight: 2 };
const HUD_TEXT = {
  size: 14,
  fill: "#e2e8f0",
  align: "left",
  valign: "top",
} as const;

export const canvas = { width: 500, height: 400 };

function makePlanets(): Planet[] {
  return [
    {
      name: "Mercury",
      orbitRadius: 60,
      angle0: 0,
      speed: 0.06,
      size: 10,
      color: "#f59e0b",
    },
    {
      name: "Venus",
      orbitRadius: 100,
      angle0: 2.1,
      speed: -0.035,
      size: 14,
      color: "#38bdf8",
    },
    {
      name: "Earth",
      orbitRadius: 150,
      angle0: 4.2,
      speed: 0.02,
      size: 16,
      color: "#22c55e",
    },
  ];
}

function planetPos(
  p: DeepReadonly<Planet>,
  frame: number,
): { x: number; y: number } {
  const angle = p.angle0 + p.speed * frame;
  return {
    x: CENTER_X + p.orbitRadius * Math.cos(angle),
    y: CENTER_Y + p.orbitRadius * Math.sin(angle),
  };
}

function hitTest({
  planets,
  x,
  y,
  frame,
}: {
  planets: DeepReadonly<Planet[]>;
  x: number;
  y: number;
  frame: number;
}): number {
  for (const [i, p] of planets.entries()) {
    const { x: px, y: py } = planetPos(p, frame);
    const dx = x - px;
    const dy = y - py;
    const hitRadius = p.size / 2 + HIT_PADDING;
    if (dx * dx + dy * dy <= hitRadius * hitRadius) return i;
  }
  return -1;
}

export function init(): Model {
  return { planets: makePlanets(), frame: -1, selected: null };
}

function nudge({
  model,
  delta,
  u,
}: {
  model: DeepReadonly<Model>;
  delta: number;
  u: Util;
}): Model {
  const index = model.selected;
  if (index === null) return model;
  const p = model.planets[index];
  if (p === undefined) return model;
  const speed = p.speed + (p.speed >= 0 ? delta : -delta);
  u.log(`${p.name} speed -> ${speed.toFixed(3)}`);
  return {
    ...model,
    planets: model.planets.map((q, i) => (i === index ? { ...q, speed } : q)),
  };
}

export function update(model: DeepReadonly<Model>, msg: Msg, u: Util): Model {
  switch (msg.type) {
    case "tick":
      return { ...model, frame: msg.frame };
    case "mousedown": {
      // events for frame N arrive before its tick, so the frame about to be drawn is `frame + 1`
      const hit = hitTest({
        planets: model.planets,
        x: msg.x,
        y: msg.y,
        frame: model.frame + 1,
      });
      u.log(
        hit >= 0
          ? `selected ${model.planets[hit]?.name}`
          : "deselected (empty space)",
      );
      return { ...model, selected: hit >= 0 ? hit : null };
    }
    case "keydown":
      if (msg.key === "ArrowUp") return nudge({ model, delta: SPEED_STEP, u });
      if (msg.key === "ArrowDown")
        return nudge({ model, delta: -SPEED_STEP, u });
      return model;
    case "mouseup":
    case "mousemove":
    case "keyup":
    case "param":
    case "trigger":
      return model;
  }
}

export function draw(v: View, model: DeepReadonly<Model>): void {
  v.background("#0b1020");

  // orbit paths
  for (const p of model.planets) {
    v.circle(CENTER_X, CENTER_Y, p.orbitRadius * 2, ORBIT_RING);
  }

  // sun
  v.circle(CENTER_X, CENTER_Y, SUN_RADIUS * 2, { fill: "#facc15" });

  // planets
  for (let i = 0; i < model.planets.length; i++) {
    const p = model.planets[i];
    if (p === undefined) continue;
    const { x, y } = planetPos(p, model.frame);
    v.circle(x, y, p.size, { fill: p.color });
    if (i === model.selected) {
      v.circle(x, y, p.size + HIT_PADDING * 2 + 4, SELECTION_RING);
    }
  }

  // HUD
  v.text(`frame ${model.frame}`, { x: 8, y: 8 }, HUD_TEXT);
  const sel =
    model.selected === null ? undefined : model.planets[model.selected];
  if (sel !== undefined) {
    v.text(
      `selected: ${sel.name}  speed: ${sel.speed.toFixed(3)}`,
      { x: 8, y: 26 },
      HUD_TEXT,
    );
  } else {
    v.text("selected: none", { x: 8, y: 26 }, HUD_TEXT);
  }
}
