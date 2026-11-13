// Bouncing ball with drag interaction (TEA tier).
//
//   - grab: mousedown within the ball's radius picks it up
//   - drag: mousemove while held moves the ball and tracks pointer velocity
//   - throw: mouseup releases it with the last drag velocity
//   - 'r' resets the ball to center
//
// All state lives in Model; `update` is the only thing that changes it.
import type { DeepReadonly, Msg, Util, View } from "@ianbicking/canvas-loop";

export const canvas = { width: 400, height: 300 };

interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

type Hold =
  | { type: "free" }
  | { type: "grabbed"; lastX: number; lastY: number };

export interface Model {
  ball: Ball;
  hold: Hold;
  frame: number;
}

const RADIUS = 24;
const GRAVITY = 0.4;
const RESTITUTION = 0.72;
const START = { x: 200, y: 150 };

export function init(u: Util): Model {
  const ball: Ball = { ...START, vx: u.random(-2, 2), vy: 0 };
  u.log("setup: ball at", ball.x, ball.y);
  return { ball, hold: { type: "free" }, frame: 0 };
}

function step(ball: DeepReadonly<Ball>): Ball {
  let { x, y, vx, vy } = ball;
  vy += GRAVITY;
  x += vx;
  y += vy;
  if (x < RADIUS) {
    x = RADIUS;
    vx = -vx * RESTITUTION;
  }
  if (x > canvas.width - RADIUS) {
    x = canvas.width - RADIUS;
    vx = -vx * RESTITUTION;
  }
  if (y < RADIUS) {
    y = RADIUS;
    vy = -vy * RESTITUTION;
  }
  if (y > canvas.height - RADIUS) {
    y = canvas.height - RADIUS;
    vy = -vy * RESTITUTION;
    vx *= 0.98;
  }
  return { x, y, vx, vy };
}

export function update(model: DeepReadonly<Model>, msg: Msg, u: Util): Model {
  switch (msg.type) {
    case "tick":
      return {
        ...model,
        frame: msg.frame,
        ball: model.hold.type === "grabbed" ? model.ball : step(model.ball),
      };
    case "mousedown": {
      const dx = msg.x - model.ball.x;
      const dy = msg.y - model.ball.y;
      if (dx * dx + dy * dy > RADIUS * RADIUS) return model;
      u.handled("grab");
      u.log("grabbed ball at", msg.x, msg.y);
      return {
        ...model,
        hold: { type: "grabbed", lastX: msg.x, lastY: msg.y },
        ball: { ...model.ball, vx: 0, vy: 0 },
      };
    }
    case "mousemove": {
      if (model.hold.type !== "grabbed") return model;
      u.handled("drag");
      return {
        ...model,
        hold: { type: "grabbed", lastX: msg.x, lastY: msg.y },
        ball: {
          x: msg.x,
          y: msg.y,
          vx: msg.x - model.hold.lastX,
          vy: msg.y - model.hold.lastY,
        },
      };
    }
    case "mouseup":
      if (model.hold.type !== "grabbed") return model;
      u.handled("release");
      u.log("released with velocity", model.ball.vx, model.ball.vy);
      return { ...model, hold: { type: "free" } };
    case "keydown":
      if (msg.key !== "r") return model;
      u.handled("reset");
      u.log("reset");
      return {
        ...model,
        ball: { ...START, vx: 0, vy: 0 },
        hold: { type: "free" },
      };
    case "keyup":
    case "param":
    case "trigger":
      return model;
  }
}

export function draw(v: View, model: DeepReadonly<Model>): void {
  v.background("#0f172a");
  const fill = model.hold.type === "grabbed" ? "#f59e0b" : "#38bdf8";
  v.circle(model.ball.x, model.ball.y, RADIUS, { fill });
  v.text(
    `frame ${model.frame}`,
    { x: 8, y: 8 },
    { size: 12, fill: "#e2e8f0", align: "left", valign: "top" },
  );
}
