// Bouncing ball with drag interaction.
//
//   - grab: mousedown within the ball's radius picks it up
//   - drag: mousemove while held moves the ball and tracks pointer velocity
//   - throw: mouseup releases it with the last drag velocity
//   - 'r' resets the ball to center
//
// State is (re)initialized in setup() so a fresh run is fully deterministic even
// when run() is called twice in the same process.
import type { Sketch } from "../src/sketch.js";
import type { SketchInputEvent } from "../src/types.js";

interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

const RADIUS = 24;
const GRAVITY = 0.4;
const RESTITUTION = 0.72;

let ball: Ball = { x: 200, y: 150, vx: 0, vy: 0 };
const drag = { grabbed: false, lastX: 0, lastY: 0 };

export function setup(s: Sketch): void {
  s.createCanvas(400, 300);
  ball = { x: 200, y: 150, vx: s.random(-2, 2), vy: 0 };
  drag.grabbed = false;
  s.log("setup: ball at", ball.x, ball.y);
}

export function draw(s: Sketch): void {
  if (!drag.grabbed) {
    ball.vy += GRAVITY;
    ball.x += ball.vx;
    ball.y += ball.vy;
    if (ball.x < RADIUS) {
      ball.x = RADIUS;
      ball.vx = -ball.vx * RESTITUTION;
    }
    if (ball.x > s.width - RADIUS) {
      ball.x = s.width - RADIUS;
      ball.vx = -ball.vx * RESTITUTION;
    }
    if (ball.y < RADIUS) {
      ball.y = RADIUS;
      ball.vy = -ball.vy * RESTITUTION;
    }
    if (ball.y > s.height - RADIUS) {
      ball.y = s.height - RADIUS;
      ball.vy = -ball.vy * RESTITUTION;
      ball.vx *= 0.98;
    }
  }

  s.background("#0f172a");
  s.noStroke();
  s.fill(drag.grabbed ? "#f59e0b" : "#38bdf8");
  s.circle(ball.x, ball.y, RADIUS * 2);
  s.fill("#e2e8f0");
  s.textSize(12);
  s.textAlign("left", "top");
  s.text(`frame ${s.frameCount}`, 8, 8);
}

export function mousePressed(s: Sketch): void {
  const dx = s.mouseX - ball.x;
  const dy = s.mouseY - ball.y;
  if (dx * dx + dy * dy <= RADIUS * RADIUS) {
    drag.grabbed = true;
    drag.lastX = s.mouseX;
    drag.lastY = s.mouseY;
    ball.vx = 0;
    ball.vy = 0;
    s.log("grabbed ball at", s.mouseX, s.mouseY);
  }
}

export function mouseDragged(s: Sketch): void {
  if (!drag.grabbed) return;
  ball.vx = s.mouseX - drag.lastX;
  ball.vy = s.mouseY - drag.lastY;
  ball.x = s.mouseX;
  ball.y = s.mouseY;
  drag.lastX = s.mouseX;
  drag.lastY = s.mouseY;
}

export function mouseReleased(s: Sketch): void {
  if (!drag.grabbed) return;
  drag.grabbed = false;
  s.log("released with velocity", ball.vx, ball.vy);
  s.snapshot("released");
}

export function keyPressed(s: Sketch, e: SketchInputEvent): void {
  if (e.key === "r") {
    ball = { x: 200, y: 150, vx: 0, vy: 0 };
    drag.grabbed = false;
    s.log("reset");
    s.snapshot("reset");
  }
}
