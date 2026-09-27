// Pelican riding a bicycle, TEA edition. A frame-diamond bicycle rolls along
// a scrolling ground; a pelican (big pouched bill, plump body, curved neck)
// sits on the saddle with wings draped over the handlebars and feet tracking
// the pedals as the cranks revolve. `speed` scales the animation rate (wheel
// spin, crank revolution, ground scroll); `pause` freezes everything for a
// clean inspection frame. All motion is a pure function of `model.frame` and
// the params, so pausing/resuming never needs extra state. See TEA.md.
import type { DeepReadonly, Msg, ParamsDecl, ParamValues, Util, View } from "@ianbicking/canvas-loop";

type Ctx2D = View["ctx"];

export const params = {
  speed: { type: "number", min: 0, max: 3, default: 1, step: 0.1 },
  pause: { type: "boolean", default: false },
} as const satisfies ParamsDecl;

export const canvas = { width: 500, height: 400 };

type Params = ParamValues<typeof params>;

export interface Model {
  /** Accumulated "animation time" in frames — only advances when unpaused, scaled by speed. */
  animFrame: number;
}

// ── Layout constants (bicycle side-view geometry) ───────────────────
const GROUND_Y = 320;
const WHEEL_RADIUS = 45;
const REAR_AXLE = { x: 175, y: GROUND_Y - WHEEL_RADIUS };
const FRONT_AXLE = { x: 355, y: GROUND_Y - WHEEL_RADIUS };
const BB = { x: 252, y: GROUND_Y - 42 }; // bottom bracket (crank/pedal center)
const SEAT_TOP = { x: 205, y: 196 }; // saddle mount point
const HEAD_TOP = { x: 345, y: 175 }; // head tube top / handlebar stem base
const CRANK_RADIUS = 24;
const SPOKE_COUNT = 12;

const FPS = 60;
const WHEEL_SPIN_RATE = (Math.PI * 2) / FPS; // one wheel revolution per second at speed=1
const CRANK_RATE = WHEEL_SPIN_RATE; // pedals turn in lockstep with the wheel (fixed-ish gear)
const SCROLL_RATE = 6; // px per frame at speed=1

export function init(): Model {
  return { animFrame: 0 };
}

// eslint-disable-next-line max-params -- TEA contract: update(model, msg, util) is the framework-defined reducer signature
export function update(model: DeepReadonly<Model>, msg: Msg, u: Util<typeof params>): Model {
  switch (msg.type) {
    case "tick":
      if (u.params.pause) return model;
      return { animFrame: model.animFrame + u.params.speed };
    case "mousedown":
    case "mouseup":
    case "mousemove":
    case "keydown":
    case "keyup":
    case "param":
    case "trigger":
      return model;
  }
}

// ── Drawing helpers ──────────────────────────────────────────────────

function drawGround(params_: { v: View; animFrame: number }): void {
  const { v, animFrame } = params_;
  const scroll = animFrame * SCROLL_RATE;
  v.stroke("#94a3b8");
  v.strokeWeight(3);
  v.line(0, GROUND_Y + WHEEL_RADIUS, canvas.width, GROUND_Y + WHEEL_RADIUS);
  // Scrolling dash marks sell the forward motion.
  const dashSpacing = 40;
  const offset = scroll % dashSpacing;
  v.strokeWeight(4);
  v.stroke("#64748b");
  for (let x = -offset; x < canvas.width + dashSpacing; x += dashSpacing) {
    v.line(x, GROUND_Y + WHEEL_RADIUS + 10, x + 18, GROUND_Y + WHEEL_RADIUS + 10);
  }
  // A couple of distant background hummocks drifting slower (parallax).
  const bgSpacing = 160;
  const bgOffset = (scroll * 0.35) % bgSpacing;
  v.noStroke();
  v.fill("#1e293b");
  for (let x = -bgOffset; x < canvas.width + bgSpacing; x += bgSpacing) {
    v.circle(x, GROUND_Y + WHEEL_RADIUS + 4, 70);
  }
}

function drawWheel(params_: { v: View; center: { x: number; y: number }; angle: number }): void {
  const { v, center, angle } = params_;
  v.noFill();
  v.stroke("#e2e8f0");
  v.strokeWeight(5);
  v.circle(center.x, center.y, WHEEL_RADIUS * 2);
  v.strokeWeight(3);
  v.fill("#0f172a");
  v.circle(center.x, center.y, WHEEL_RADIUS * 2 - 10);
  v.stroke("#cbd5e1");
  v.strokeWeight(2);
  for (let i = 0; i < SPOKE_COUNT; i++) {
    const a = angle + (i / SPOKE_COUNT) * Math.PI * 2;
    const x1 = center.x + Math.cos(a) * 6;
    const y1 = center.y + Math.sin(a) * 6;
    const x2 = center.x + Math.cos(a) * (WHEEL_RADIUS - 4);
    const y2 = center.y + Math.sin(a) * (WHEEL_RADIUS - 4);
    v.line(x1, y1, x2, y2);
  }
  v.noStroke();
  v.fill("#94a3b8");
  v.circle(center.x, center.y, 10);
}

function drawFrame(v: View): void {
  v.stroke("#dc2626");
  v.strokeWeight(6);
  v.line(REAR_AXLE.x, REAR_AXLE.y, BB.x, BB.y); // chain stay
  v.line(BB.x, BB.y, SEAT_TOP.x, SEAT_TOP.y); // seat tube
  v.line(SEAT_TOP.x, SEAT_TOP.y, HEAD_TOP.x, HEAD_TOP.y); // top tube
  v.line(HEAD_TOP.x, HEAD_TOP.y, FRONT_AXLE.x, FRONT_AXLE.y); // fork
  v.line(BB.x, BB.y, HEAD_TOP.x, HEAD_TOP.y); // down tube
  v.line(REAR_AXLE.x, REAR_AXLE.y, SEAT_TOP.x, SEAT_TOP.y); // seat stay

  // Saddle.
  v.strokeWeight(4);
  v.line(SEAT_TOP.x - 16, SEAT_TOP.y - 6, SEAT_TOP.x + 12, SEAT_TOP.y - 10);

  // Handlebar stem + bar.
  v.strokeWeight(5);
  v.line(HEAD_TOP.x, HEAD_TOP.y, HEAD_TOP.x + 4, HEAD_TOP.y - 22);
  v.line(HEAD_TOP.x - 22, HEAD_TOP.y - 24, HEAD_TOP.x + 22, HEAD_TOP.y - 20);
}

interface PedalPos {
  x: number;
  y: number;
}

function pedalPos(angle: number): PedalPos {
  return { x: BB.x + Math.cos(angle) * CRANK_RADIUS, y: BB.y + Math.sin(angle) * CRANK_RADIUS };
}

function drawCranks(params_: { v: View; angle: number }): void {
  const { v, angle } = params_;
  const near = pedalPos(angle);
  const far = pedalPos(angle + Math.PI);
  // Far crank+pedal drawn first so the near one overlaps it (depth cue).
  v.stroke("#475569");
  v.strokeWeight(4);
  v.line(BB.x, BB.y, far.x, far.y);
  v.strokeWeight(3);
  v.fill("#1e293b");
  v.rect(far.x - 8, far.y - 3, 16, 6);
  v.stroke("#334155");
  v.strokeWeight(5);
  v.line(BB.x, BB.y, near.x, near.y);
  v.fill("#334155");
  v.noStroke();
  v.rect(near.x - 8, near.y - 3, 16, 6);
  v.fill("#94a3b8");
  v.circle(BB.x, BB.y, 12);
}

interface Point {
  x: number;
  y: number;
}

/**
 * A folded wing as a leaf/feather shape: a fat camber on one side tapering to
 * a point at the grip, a nearly-straight trailing edge on the other. Bulges
 * perpendicular to the shoulder→grip line so it reads as a wing, not a blob.
 */
function drawWing(params_: { ctx: Ctx2D; shoulder: Point; grip: Point; bulge: number; color: string }): void {
  const { ctx, shoulder, grip, bulge, color } = params_;
  const midX = (shoulder.x + grip.x) / 2;
  const midY = (shoulder.y + grip.y) / 2;
  const dx = grip.x - shoulder.x;
  const dy = grip.y - shoulder.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = "#64748b";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(shoulder.x, shoulder.y);
  ctx.quadraticCurveTo(midX + nx * bulge, midY + ny * bulge, grip.x, grip.y);
  ctx.quadraticCurveTo(midX - nx * (bulge * 0.35), midY - ny * (bulge * 0.35), shoulder.x, shoulder.y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // A couple of feather-crease lines from shoulder toward the tip.
  ctx.beginPath();
  ctx.moveTo(shoulder.x, shoulder.y);
  ctx.lineTo(shoulder.x + dx * 0.6 + nx * bulge * 0.3, shoulder.y + dy * 0.6 + ny * bulge * 0.3);
  ctx.moveTo(shoulder.x, shoulder.y);
  ctx.lineTo(shoulder.x + dx * 0.8 + nx * bulge * 0.15, shoulder.y + dy * 0.8 + ny * bulge * 0.15);
  ctx.stroke();
  ctx.restore();
}

/** Pelican anatomy, hand-fitted around the saddle/handlebar/pedal anchor points. */
function drawPelican(params_: { v: View; nearFootAngle: number; farFootAngle: number }): void {
  const { v, nearFootAngle, farFootAngle } = params_;
  const ctx = v.ctx;
  const bodyX = SEAT_TOP.x + 2;
  const bodyY = SEAT_TOP.y - 46;

  // ── Legs: hip (under the tail) down to each pedal, feet tracking the cranks.
  // Slate-grey, distinct from the bill's warm tones and the bike's red/orange.
  const hip = { x: bodyX - 6, y: bodyY + 30 };
  const nearFoot = pedalPos(nearFootAngle);
  const farFoot = pedalPos(farFootAngle);
  v.stroke("#78716c");
  v.strokeWeight(6);
  v.line(hip.x, hip.y, farFoot.x, farFoot.y - 4);
  v.strokeWeight(7);
  v.line(hip.x, hip.y, nearFoot.x, nearFoot.y - 4);
  v.noStroke();
  v.fill("#78716c");
  v.circle(nearFoot.x, nearFoot.y - 4, 10);

  // ── Far wing: shoulder to the far handlebar grip, mostly hidden by the body.
  const farShoulder = { x: bodyX + 8, y: bodyY - 18 };
  const farGrip = { x: HEAD_TOP.x - 22, y: HEAD_TOP.y - 22 };
  drawWing({ ctx, shoulder: farShoulder, grip: farGrip, bulge: 32, color: "#94a3b8" });

  // ── Body: plump oval, tail tucked toward the saddle.
  v.noStroke();
  v.fill("#f8fafc");
  v.ellipse(bodyX, bodyY, 112, 70);
  v.fill("#e2e8f0");
  v.triangle(bodyX - 52, bodyY - 8, bodyX - 70, bodyY + 4, bodyX - 48, bodyY + 16); // tail

  // ── Neck + head, curving up and forward from the shoulders to over the handlebars.
  const neckBase = { x: bodyX + 32, y: bodyY - 26 };
  const headX = HEAD_TOP.x - 2;
  const headY = HEAD_TOP.y - 62;
  ctx.save();
  ctx.strokeStyle = "#f8fafc";
  ctx.lineWidth = 32;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(neckBase.x, neckBase.y);
  ctx.quadraticCurveTo(neckBase.x + 34, bodyY - 96, headX, headY);
  ctx.stroke();
  ctx.restore();

  // ── Near wing: drawn after the neck so it overlaps the body/neck join, folded onto the near handlebar grip.
  const nearShoulder = { x: bodyX + 14, y: bodyY - 6 };
  const nearGrip = { x: HEAD_TOP.x + 20, y: HEAD_TOP.y - 18 };
  drawWing({ ctx, shoulder: nearShoulder, grip: nearGrip, bulge: 40, color: "#cbd5e1" });

  // ── Head + the pelican's signature bill: long flat upper mandible over a
  // sagging throat pouch, sketched as filled paths rather than primitives.
  v.noStroke();
  v.fill("#f1f5f9");
  v.circle(headX, headY, 38);

  const billTipX = headX + 84;
  const billTipY = headY + 10;

  // Throat pouch first — the upper mandible sits on top of it and hides the seam.
  ctx.save();
  ctx.fillStyle = "#fb923c";
  ctx.strokeStyle = "#c2660f";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(headX - 4, headY + 2);
  ctx.quadraticCurveTo(headX + 26, headY + 46, headX + 60, headY + 22);
  ctx.quadraticCurveTo(billTipX + 4, billTipY + 8, billTipX - 2, billTipY);
  ctx.quadraticCurveTo(headX + 40, headY + 12, headX - 4, headY + 2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  // Upper mandible: a long, flat, slightly hooked-tip wedge from the head to the bill tip.
  ctx.save();
  ctx.fillStyle = "#f2c14e";
  ctx.strokeStyle = "#c99a3b";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(headX - 8, headY - 18);
  ctx.quadraticCurveTo(headX + 46, headY - 20, billTipX, billTipY - 6);
  ctx.quadraticCurveTo(billTipX - 6, billTipY + 2, billTipX - 14, billTipY);
  ctx.quadraticCurveTo(headX + 40, headY - 2, headX - 2, headY - 2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // Culmen ridge line down the top of the bill for definition.
  ctx.beginPath();
  ctx.moveTo(headX + 4, headY - 12);
  ctx.quadraticCurveTo(headX + 48, headY - 13, billTipX - 4, billTipY - 4);
  ctx.stroke();
  ctx.restore();

  // Eye: white ring behind a dark pupil, set high on the head so it clears the bill.
  v.noStroke();
  v.fill("#1e293b");
  v.circle(headX - 4, headY - 18, 8);
  v.fill("#f8fafc");
  v.circle(headX - 4, headY - 18, 3);
}

// eslint-disable-next-line max-params -- TEA contract: draw(view, model, params) is the framework-defined render signature
export function draw(v: View, model: DeepReadonly<Model>, _p: Params): void {
  v.background("#0b1020");
  drawGround({ v, animFrame: model.animFrame });

  const wheelAngle = model.animFrame * WHEEL_SPIN_RATE;
  const crankAngle = model.animFrame * CRANK_RATE - Math.PI / 2;

  drawWheel({ v, center: REAR_AXLE, angle: wheelAngle });
  drawWheel({ v, center: FRONT_AXLE, angle: wheelAngle });
  drawFrame(v);
  drawCranks({ v, angle: crankAngle });
  drawPelican({ v, nearFootAngle: crankAngle, farFootAngle: crankAngle + Math.PI });
}
