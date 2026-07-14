// Analog clock, TEA edition. Virtual time starts at 10:08:00 and advances at
// `timeScale` virtual seconds per real second (default 60 — one virtual
// minute per real second at 60fps, i.e. one virtual second per frame). A
// `style` select toggles numerals on/off ("classic" | "minimal"); a
// `showDigital` boolean overlays an HH:MM:SS readout for verifying the hands
// against the underlying time. See TEA.md.
import type { DeepReadonly, Msg, ParamsDecl, ParamValues, Util, View } from "../src/tea.js";

export const params = {
  timeScale: { type: "number", min: 1, max: 3600, default: 60, step: 1 },
  style: { type: "select", options: ["classic", "minimal"], default: "classic" },
  showDigital: { type: "boolean", default: false },
} as const satisfies ParamsDecl;

export const canvas = { width: 400, height: 400 };

type Params = ParamValues<typeof params>;

export interface Model {
  virtualSeconds: number;
}

const CENTER_X = 200;
const CENTER_Y = 200;
const FACE_RADIUS = 180;
const START_VIRTUAL_SECONDS = 10 * 3600 + 8 * 60; // 10:08:00
const SECONDS_PER_DAY = 24 * 3600;
const FPS = 60;

const TICK_OUTER_RADIUS = FACE_RADIUS - 8;
const MINUTE_TICK_LENGTH = 10;
const HOUR_TICK_LENGTH = 18;
const MINUTE_TICK_WEIGHT = 1.5;
const HOUR_TICK_WEIGHT = 4;

const NUMERAL_RADIUS = FACE_RADIUS - 38;
const NUMERAL_SIZE = 24;

const HOUR_HAND_LENGTH = FACE_RADIUS * 0.5;
const MINUTE_HAND_LENGTH = FACE_RADIUS * 0.75;
const SECOND_HAND_LENGTH = FACE_RADIUS * 0.82;
const HOUR_HAND_WEIGHT = 7;
const MINUTE_HAND_WEIGHT = 5;
const SECOND_HAND_WEIGHT = 2;
const CENTER_CAP_RADIUS = 6;

export function init(): Model {
  return { virtualSeconds: START_VIRTUAL_SECONDS };
}

// eslint-disable-next-line max-params -- TEA contract: update(model, msg, util) is the framework-defined reducer signature
export function update(model: DeepReadonly<Model>, msg: Msg, u: Util<typeof params>): Model {
  switch (msg.type) {
    case "tick": {
      // Frame 0's tick is the initial render — leave virtualSeconds at the
      // init() value so frame 0 shows exactly the start time. Every
      // subsequent tick advances by one frame's worth of virtual time at the
      // current timeScale.
      if (msg.frame === 0) return model;
      const secondsPerFrame = u.params.timeScale / FPS;
      const next = (model.virtualSeconds + secondsPerFrame) % SECONDS_PER_DAY;
      return { virtualSeconds: next };
    }
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

// Angles measured clockwise from 12 o'clock (i.e. from -90deg / straight up),
// in radians, using fractional virtual seconds for smooth continuous motion.
function handAngles(virtualSeconds: number): { hour: number; minute: number; second: number } {
  const totalSeconds = virtualSeconds % SECONDS_PER_DAY;
  const secondsOfHour = totalSeconds % 3600;
  const secondsOfMinute = totalSeconds % 60;
  const hourFrac = (totalSeconds % (3600 * 12)) / (3600 * 12); // 0..1 across 12h
  const minuteFrac = secondsOfHour / 3600; // 0..1 across 60min
  const secondFrac = secondsOfMinute / 60; // 0..1 across 60s
  const TAU = Math.PI * 2;
  return { hour: hourFrac * TAU, minute: minuteFrac * TAU, second: secondFrac * TAU };
}

function drawTicks(v: View): void {
  for (let i = 0; i < 60; i++) {
    const isHour = i % 5 === 0;
    const angle = (i / 60) * Math.PI * 2 - Math.PI / 2;
    const length = isHour ? HOUR_TICK_LENGTH : MINUTE_TICK_LENGTH;
    const outerX = CENTER_X + TICK_OUTER_RADIUS * Math.cos(angle);
    const outerY = CENTER_Y + TICK_OUTER_RADIUS * Math.sin(angle);
    const innerX = CENTER_X + (TICK_OUTER_RADIUS - length) * Math.cos(angle);
    const innerY = CENTER_Y + (TICK_OUTER_RADIUS - length) * Math.sin(angle);
    v.stroke("#e2e8f0");
    v.strokeWeight(isHour ? HOUR_TICK_WEIGHT : MINUTE_TICK_WEIGHT);
    v.line(innerX, innerY, outerX, outerY);
  }
}

function drawNumerals(v: View): void {
  v.noStroke();
  v.fill("#f8fafc");
  v.textSize(NUMERAL_SIZE);
  v.textAlign("center", "middle");
  for (let n = 1; n <= 12; n++) {
    // Numeral n sits at the same angle as hour-hand-at-n on the clock face:
    // 12 at top (-90deg), each hour advances 30deg clockwise.
    const angle = (n / 12) * Math.PI * 2 - Math.PI / 2;
    const x = CENTER_X + NUMERAL_RADIUS * Math.cos(angle);
    const y = CENTER_Y + NUMERAL_RADIUS * Math.sin(angle);
    v.text(String(n), x, y);
  }
}

function drawHand(params_: { v: View; angle: number; length: number; weight: number; color: string }): void {
  const { v, angle, length, weight, color } = params_;
  const dialAngle = angle - Math.PI / 2; // 0 rad here = 12 o'clock, clockwise
  const x = CENTER_X + length * Math.cos(dialAngle);
  const y = CENTER_Y + length * Math.sin(dialAngle);
  v.stroke(color);
  v.strokeWeight(weight);
  v.line(CENTER_X, CENTER_Y, x, y);
}

function drawDigital(params_: { v: View; virtualSeconds: number }): void {
  const { v, virtualSeconds } = params_;
  const totalSeconds = Math.floor(virtualSeconds) % SECONDS_PER_DAY;
  const hours24 = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number): string => String(n).padStart(2, "0");
  v.noStroke();
  v.fill("#facc15");
  v.textSize(16);
  v.textAlign("center", "top");
  v.text(`${pad(hours24)}:${pad(minutes)}:${pad(seconds)}`, CENTER_X, 12);
}

// eslint-disable-next-line max-params -- TEA contract: draw(view, model, params) is the framework-defined render signature
export function draw(v: View, model: DeepReadonly<Model>, p: Params): void {
  v.background("#0b1020");

  v.noFill();
  v.stroke("#334155");
  v.strokeWeight(2);
  v.circle(CENTER_X, CENTER_Y, FACE_RADIUS * 2);

  drawTicks(v);
  if (p.style === "classic") drawNumerals(v);

  const angles = handAngles(model.virtualSeconds);
  drawHand({ v, angle: angles.hour, length: HOUR_HAND_LENGTH, weight: HOUR_HAND_WEIGHT, color: "#e2e8f0" });
  drawHand({ v, angle: angles.minute, length: MINUTE_HAND_LENGTH, weight: MINUTE_HAND_WEIGHT, color: "#e2e8f0" });
  drawHand({ v, angle: angles.second, length: SECOND_HAND_LENGTH, weight: SECOND_HAND_WEIGHT, color: "#f87171" });

  v.noStroke();
  v.fill("#f8fafc");
  v.circle(CENTER_X, CENTER_Y, CENTER_CAP_RADIUS * 2);

  if (p.showDigital) drawDigital({ v, virtualSeconds: model.virtualSeconds });
}
