// A drag as a mode: press on the ball to hold it, keeping where on the ball
// you took it so it does not jump to the pointer; move to carry it; release
// to throw it with the last move's velocity. `r` puts it back. Linked from
// README.md "Worked example" and TEA.md "The `Msg` union".
import type { DeepReadonly, Msg, RootDrawing, Util, View } from "@ianbicking/canvas-loop";

export const canvas = { width: 480, height: 320 };

interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/** Free: the ball falls and bounces. Held: it follows the pointer, offset by where it was taken. */
type Mode = { type: "free" } | { type: "held"; dx: number; dy: number };

export interface Model {
  ball: Ball;
  mode: Mode;
  /** The pointer is over the ball (for the cursor). */
  hover: boolean;
}

const R = 26;
const FLOOR = 280;
const GRAVITY = 0.45;
const BOUNCE = 0.7;
const START: Ball = { x: 140, y: FLOOR - R, vx: 0, vy: 0 };

export function init(_u: Util): Model {
  return { ball: START, mode: { type: "free" }, hover: false };
}

/** One frame of flight: gravity, then the walls and floor push back. */
function fall(b: DeepReadonly<Ball>): Ball {
  const vy = b.vy + GRAVITY;
  const x = Math.min(Math.max(b.x + b.vx, R), canvas.width - R);
  const y = Math.min(b.y + vy, FLOOR - R);
  const hitWall = x !== b.x + b.vx;
  const hitFloor = y === FLOOR - R && vy > 0;
  return { x, y, vx: (hitWall ? -b.vx * BOUNCE : b.vx) * (hitFloor ? 0.96 : 1), vy: hitFloor ? -vy * BOUNCE : vy };
}

export function update(model: DeepReadonly<Model>, msg: Msg, u: Util): Model {
  switch (msg.type) {
    case "tick":
      return model.mode.type === "held" ? model : { ...model, ball: fall(model.ball) };
    case "mousedown":
      if (!msg.targets.includes("ball")) return model;
      u.handled("grab");
      return { ...model, mode: { type: "held", dx: msg.x - model.ball.x, dy: msg.y - model.ball.y } };
    case "mousemove": {
      const { mode, ball } = model;
      if (mode.type === "free") {
        const hover = msg.targets.includes("ball");
        return hover === model.hover ? model : { ...model, hover };
      }
      u.handled("drag");
      const x = msg.x - mode.dx;
      const y = msg.y - mode.dy;
      return { ...model, ball: { x, y, vx: x - ball.x, vy: y - ball.y } };
    }
    case "mouseup":
      if (model.mode.type !== "held") return model;
      u.handled("throw");
      return { ...model, mode: { type: "free" } };
    case "keydown":
      if (msg.key !== "r") return model;
      u.handled("reset");
      return init(u);
    case "keyup":
    case "param":
    case "trigger":
      return model;
  }
}

export function draw(v: View, model: DeepReadonly<Model>): RootDrawing {
  const { ball, mode } = model;
  const lift = (FLOOR - R - ball.y) / FLOOR;
  v.cursor(mode.type === "held" ? "grabbing" : model.hover ? "grab" : "default");
  return [
    v.background("#f3eee4"),
    v.rect(0, FLOOR, canvas.width, canvas.height - FLOOR, { fill: "#d9cfbd" }),
    v.ellipse(ball.x, FLOOR + 2, R * (1 - lift * 0.5), 5 * (1 - lift * 0.6), { fill: `rgba(70,50,30,${0.35 - lift * 0.25})` }),
    v.circle(ball.x, ball.y, R, {
      fill: v.radialGradient(ball.x - R / 3, ball.y - R / 3, R * 1.4, [[0, "#ffb489"], [0.5, "#e2572f"], [1, "#8f2a14"]]),
      name: "ball",
    }),
    v.text(mode.type === "held" ? "let go to throw" : "drag the ball and throw it · r resets", { x: 16, y: 16 }, { size: 13, fill: "#6b5d4a" }),
  ];
}
