// Every param kind, and where params end: `speed-scale` (number),
// `show-orbits` (boolean), `focus` (select) and `reset` (trigger). `reset`
// restores the model (the planets, the selection) and leaves the params as
// they are: params are the runtime's store, the model is the sketch's. Click a
// moving planet by its name to select it; ArrowUp and ArrowDown change its
// speed. Linked from TEA.md "Worked example" and "Params reference".
import type { DeepReadonly, Drawing, Msg, ParamValues, ParamsDecl, RootDrawing, TextOptions, Util, View } from "@ianbicking/canvas-loop";

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
  orbit: number;
  /** Where it is on its orbit, radians; each tick adds its speed times speed-scale. */
  angle: number;
  /** Radians per frame at speed-scale 1. */
  speed: number;
  size: number;
  colour: string;
}

type Mode = { type: "idle" } | { type: "selected"; name: string };

export interface Model {
  planets: readonly Planet[];
  mode: Mode;
}

const SUN = { x: 250, y: 200 } as const;
const STEP = 0.01;
const HUD: TextOptions = { size: 13, fill: "#cbd5e1" };

export function init(): Model {
  return {
    planets: [
      { name: "Mercury", orbit: 60, angle: 0, speed: 0.03, size: 6, colour: "#d6a46a" },
      { name: "Venus", orbit: 100, angle: 2.1, speed: -0.018, size: 9, colour: "#e8d6a8" },
      { name: "Earth", orbit: 150, angle: 4.2, speed: 0.01, size: 10, colour: "#4f8fd8" },
    ],
    mode: { type: "idle" },
  };
}

function position(planet: DeepReadonly<Planet>): [number, number] {
  return [SUN.x + planet.orbit * Math.cos(planet.angle), SUN.y + planet.orbit * Math.sin(planet.angle)];
}

/** The selected planet's speed one step further from zero, or one step nearer. */
function nudge(model: DeepReadonly<Model>, at: { name: string; dir: 1 | -1 }): Model {
  const planets = model.planets.map((p) => (p.name === at.name ? { ...p, speed: p.speed + at.dir * Math.sign(p.speed) * STEP } : p));
  return { ...model, planets };
}

export function update(model: DeepReadonly<Model>, msg: Msg, u: Util<typeof params>): Model {
  switch (msg.type) {
    case "tick": {
      // Advancing the angle (not computing it from the frame) keeps a planet in
      // place when speed-scale changes, and lets reset put it back.
      const scale = u.params["speed-scale"];
      return { ...model, planets: model.planets.map((p) => ({ ...p, angle: p.angle + p.speed * scale })) };
    }
    case "mousedown": {
      const hit = model.planets.find((p) => msg.targets.includes(`planet-${p.name}`));
      if (hit !== undefined) {
        u.handled(`select ${hit.name}`);
        return { ...model, mode: { type: "selected", name: hit.name } };
      }
      if (model.mode.type === "idle") return model;
      u.handled("deselect");
      return { ...model, mode: { type: "idle" } };
    }
    case "keydown": {
      const dir = msg.key === "ArrowUp" ? 1 : msg.key === "ArrowDown" ? -1 : 0;
      if (model.mode.type !== "selected" || dir === 0) return model;
      u.handled(dir === 1 ? "faster" : "slower");
      return nudge(model, { name: model.mode.name, dir });
    }
    case "trigger":
      if (msg.name !== "reset") return model;
      u.handled("reset");
      return init();
    case "mouseup":
    case "mousemove":
    case "keyup":
    case "param":
      return model;
  }
}

function drawPlanet(v: View, a: { planet: DeepReadonly<Planet>; at: [number, number]; selected: boolean }): Drawing {
  const [x, y] = a.at;
  const { size, colour, name } = a.planet;
  return [
    a.selected && v.circle(x, y, size + 7, { stroke: "#f8fafc", weight: 1.5 }),
    // A larger transparent disc under the same name gives a fingertip room.
    v.circle(x, y, Math.max(size + 6, 20), { fill: "transparent", name: `planet-${name}` }),
    v.circle(x, y, size, { fill: v.radialGradient(x - size * 0.4, y - size * 0.4, size * 1.6, [[0, "#ffffff"], [0.25, colour], [1, "#0b1020"]]), name: `planet-${name}` }),
  ];
}

export function draw(v: View, model: DeepReadonly<Model>, p: Params): RootDrawing {
  const scale = p["speed-scale"];
  const focus = model.planets.find((pl) => pl.name === p.focus);
  const selected = model.mode.type === "selected" ? model.mode.name : "none";
  return [
    v.background("#0b1020"),
    p["show-orbits"] && model.planets.map((pl) => v.circle(SUN.x, SUN.y, pl.orbit, { stroke: "#26324f", weight: 1 })),
    v.circle(SUN.x, SUN.y, 20, { fill: "#fcd34d", effects: { glow: { blur: 18, color: "#f59e0b", strength: 2 } } }),
    model.planets.map((pl) => drawPlanet(v, { planet: pl, at: position(pl), selected: pl.name === selected })),
    v.column({ x: 12, y: 12, gap: 4 }, [
      v.text(`speed ×${scale.toFixed(1)}   selected: ${selected}`, { x: 0, y: 0 }, HUD),
      focus !== undefined && v.text(`${focus.name}: ${Math.abs(focus.speed).toFixed(3)} rad per frame`, { x: 0, y: 0 }, HUD),
    ]),
  ];
}
