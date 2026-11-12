// Every moving thing, drawn each frame from sprites and a few cheap marks.
import type { Sprite, View } from "@ianbicking/canvas-loop";
import type { Clock, Id } from "./things-tea.js";
import { BUS_Y, FEET, IDS, W, act, boxOf, busX, snailX } from "./things-tea.js";
import * as S from "./folk-tea.js";

export interface Scene extends Clock {
  readonly hover: Id | "";
  readonly bloom: number;
  readonly night: boolean;
  /** Dusk or night: the street lamp is lit. */
  readonly evening: boolean;
}

interface Place {
  readonly x: number;
  readonly y: number;
  readonly px: number;
  readonly py: number;
  readonly rot?: number;
  readonly flip?: boolean;
  readonly alpha?: number;
  readonly scale?: number;
}

/** Draw a sprite with its pivot (px, py) at (x, y), turned, flipped and scaled about the pivot. */
export function put(v: View, s: Sprite, at: Place): void {
  v.push();
  v.translate(at.x, at.y);
  if (at.rot !== undefined) v.rotate(at.rot);
  if (at.flip === true) v.scale(-1, 1);
  if (at.scale !== undefined) v.scale(at.scale);
  v.image(s, -at.px, -at.py, at.alpha ?? 1);
  v.pop();
}

/** Hover cue: a little hop while the pointer is over an idle thing. */
export function hop(s: Scene, id: Id): number {
  return s.hover === id && act(s, id) === null ? -Math.abs(Math.sin(s.frame * 0.22)) * 6 : 0;
}

/** Hover cue for fixed things: a small wiggle. */
function wiggle(s: Scene, id: Id): number {
  return s.hover === id && act(s, id) === null ? Math.sin(s.frame * 0.5) * 0.06 : 0;
}

function puff(v: View, x: number, y: number, r: number, alpha: number): void {
  v.noStroke();
  v.fill(`rgba(250,250,250,${alpha.toFixed(3)})`);
  v.circle(x, y, r * 2);
}

function drops(v: View, color: string, pts: readonly (readonly [number, number])[]): void {
  v.noStroke();
  v.fill(color);
  for (const [x, y] of pts) v.ellipse(x, y, 4, 6);
}

const bell = (t: number, a: number, b: number): number => (t < a || t > b ? 0 : Math.sin(((t - a) / (b - a)) * Math.PI));

// ── Bakery row ─────────────────────────────────────────────────────

export function chimney(v: View, s: Scene): void {
  const t = act(s, "chimney");
  const shake = t === null ? wiggle(s, "chimney") : Math.sin(t * 60) * 0.08 * (1 - t);
  put(v, S.chimney(v), { x: 185, y: 252, px: 17, py: 56, rot: shake });
  for (let i = 0; i < 6; i += 1) {
    const age = ((s.frame + i * 20) % 120) / 120;
    puff(v, 186 + Math.sin(age * 5 + i) * 8 + age * 30, 196 - age * 90, 5 + age * 12, (1 - age) * 0.55);
  }
  if (t !== null) {
    v.noFill();
    v.noBrush();
    for (let i = 0; i < 3; i += 1) {
      const k = t * 1.6 - i * 0.25;
      if (k <= 0 || k >= 1) continue;
      v.stroke(`rgba(90,80,90,${(0.8 * (1 - k)).toFixed(3)})`);
      v.strokeWeight(5 * (1 - k) + 1);
      v.ellipse(186 + k * 20, 190 - k * 150, 18 + k * 50, 8 + k * 20);
    }
  }
}

export function windowAndGoat(v: View, s: Scene): void {
  const t = act(s, "window");
  const open = t !== null && t > 0.04 && t < 0.94;
  const x = 50;
  const y = 282 + hop(s, "window");
  if (open) {
    const rise = Math.min(1, (t - 0.04) / 0.12) * Math.min(1, (0.94 - t) / 0.1);
    put(v, S.windowSprite(v, true), { x, y, px: 0, py: 0 });
    const gy = y + 120 - rise * 36;
    v.clip([[x + 16, y + 6], [x + 64, y + 6], [x + 64, y + 66], [x + 16, y + 66]], () => {
      put(v, S.folk(v, "goat-water"), { x: x + 40, y: gy, px: 32, py: 96 });
    });
    v.clip([[x, y + 64], [x + 80, y + 64], [x + 80, y + 86], [x, y + 86]], () => put(v, S.windowSprite(v, true), { x, y, px: 0, py: 0 }));
    const pour = t > 0.18 && t < 0.8;
    const tilt = pour ? 0.55 + Math.sin(s.frame * 0.2) * 0.08 : 0;
    // the can pokes out over the sill, held at the goat's hands
    if (rise > 0.6) put(v, S.wateringCan(v), { x: x + 66, y: gy - 38, px: 6, py: 10, rot: tilt });
    if (pour) {
      const sx = x + 66 + Math.cos(tilt) * 23 - Math.sin(tilt) * -8;
      const sy = gy - 38 + Math.sin(tilt) * 23 + Math.cos(tilt) * -8;
      const pts: [number, number][] = [];
      for (let i = 0; i < 5; i += 1) {
        const k = ((s.frame * 2 + i * 7) % 35) / 35;
        pts.push([sx - k * 22, sy + k * k * (y + 56 - sy)]);
      }
      // what the box cannot hold drips out underneath, onto whoever sits below
      for (let i = 0; i < 4; i += 1) {
        const k = ((s.frame * 1.5 + i * 13) % 52) / 52;
        if (t > 0.3) pts.push([x + 28 + (i % 2) * 8, y + 82 + k * 40]);
      }
      drops(v, "rgba(110,170,230,0.85)", pts);
    }
  } else {
    put(v, S.windowSprite(v, false), { x, y, px: 0, py: 0 });
  }
  // flowers in the box: they sway, and grow while watered
  const grow = t !== null && t > 0.18 ? Math.min(1, (t - 0.18) / 0.5) : 0;
  const tall = 10 + s.bloom * 6 + grow * 6;
  const colors = ["#e84a6a", "#f2c84b", "#b46ad8", "#ff8a3a", "#e84a6a"];
  for (let i = 0; i < 5; i += 1) {
    const fx = x + 16 + i * 12;
    const sway = Math.sin(s.frame * 0.05 + i) * 2;
    v.noBrush();
    v.noFill();
    v.stroke("#3f7a3a");
    v.strokeWeight(2);
    v.line(fx, y + 67, fx + sway, y + 67 - tall);
    v.noStroke();
    v.fill(colors[i] ?? "#e84a6a");
    v.circle(fx + sway, y + 67 - tall, 9 + grow * 3 + s.bloom);
    v.fill("#fff3b0");
    v.circle(fx + sway, y + 67 - tall, 3);
  }
}

export function cat(v: View, s: Scene): void {
  const t = act(s, "cat");
  const leap = t === null ? 0 : Math.sin(Math.min(1, t / 0.7) * Math.PI) * 46;
  const mode = t !== null && t < 0.75 ? "arch" : "sit";
  const x = 52;
  const y = 360 - leap + hop(s, "cat");
  // tail first, behind
  const flick = t === null ? Math.sin(s.frame * 0.09) * 10 + Math.sin(s.frame * 0.23) * 4 : 0;
  v.noBrush();
  v.noFill();
  v.stroke("#8e8a9a");
  v.strokeWeight(6);
  if (mode === "sit") {
    v.curve([[x + 36, y + 50], [x + 50, y + 56], [x + 56 + flick * 0.3, y + 64], [x + 54 + flick, y + 78]]);
  } else {
    v.curve([[x + 42, y + 34], [x + 50, y + 20], [x + 52, y + 4]]);
  }
  put(v, S.cat(v, mode), { x, y, px: 0, py: 0 });
}

export function baker(v: View, s: Scene): void {
  const t = act(s, "baker");
  const x = 114;
  const pose: S.Pose = t === null || t > 0.82 ? "baker-idle" : t < 0.28 ? "baker-reach" : "baker-up";
  const bob = Math.sin(s.frame * 0.07) * 1.2 + hop(s, "baker");
  put(v, S.folk(v, pose), { x, y: FEET + bob, px: 32, py: 96 });
  if (t === null || t > 0.82) return;
  let lx: number;
  let ly: number;
  if (t < 0.28) {
    const k = t / 0.28;
    lx = 200 - k * 58;
    ly = 520 - k * 12;
    v.noBrush();
    v.stroke("#8a5a3a");
    v.strokeWeight(3);
    v.line(lx + 26, ly + 2, 142, 543);
  } else {
    lx = x;
    ly = FEET - 92 + bob;
  }
  put(v, S.loaf(v), { x: lx, y: ly, px: 22, py: 14 });
  for (let i = 0; i < 6; i += 1) {
    const age = ((s.frame * 1.3 + i * 11) % 66) / 66;
    puff(v, lx + Math.sin(age * 6 + i * 2) * 7, ly - 8 - age * 46, 3 + age * 8, (1 - age) * 0.7);
  }
}

// ── Post office ────────────────────────────────────────────────────

export function mailCarrier(v: View, s: Scene): void {
  const t = act(s, "mail");
  const x = 292;
  const pose: S.Pose = t !== null && t < 0.6 ? "mail-toss" : "mail-idle";
  const bob = t === null ? Math.abs(Math.sin(s.frame * 0.05)) * -2 : Math.sin(t * Math.PI * 4) * -4;
  put(v, S.folk(v, pose), { x, y: FEET + bob, px: 32, py: 96 });
  if (t === null || t > 0.62) return;
  for (let i = 0; i < 3; i += 1) {
    const k = (t - i * 0.12) / 0.4;
    if (k <= 0 || k >= 1) continue;
    const lx = 318 + k * 46;
    const ly = 506 - Math.sin(k * Math.PI) * 60 + k * 18;
    put(v, S.letter(v), { x: lx, y: ly, px: 9, py: 6, rot: k * 6 });
  }
}

export function mailbox(v: View, s: Scene): void {
  const t = act(s, "mailbox");
  const open = t !== null && t > 0.1 && t < 0.8;
  const jig = t === null ? 0 : Math.sin(t * 50) * 0.07 * (1 - t);
  put(v, S.mailbox(v, open), { x: 380, y: 570 + hop(s, "mailbox"), px: 20, py: 66, rot: jig });
  if (t === null) return;
  for (let i = 0; i < 4; i += 1) {
    const k = (t - 0.12 - i * 0.05) / 0.62;
    if (k <= 0 || k >= 1) continue;
    const up = Math.sin(k * Math.PI) * (50 + i * 12);
    put(v, S.letter(v), { x: 380 + Math.sin(k * 9 + i) * (10 + i * 5), y: 524 - up, px: 9, py: 6, rot: Math.sin(k * 7 + i) * 0.8 });
  }
}

// ── Painter's house ────────────────────────────────────────────────

export function owl(v: View, s: Scene): void {
  const t = act(s, "owl");
  // an owl keeps owl hours: asleep by day, awake at night
  const roused = t !== null && t > 0.05 && t < 0.85;
  const awake = s.night ? !roused || Math.floor(s.frame / 6) % 2 === 0 : roused;
  put(v, S.owl(v, awake), { x: 441, y: 237 + hop(s, "owl"), px: 0, py: 0 });
  if (!awake && t === null) {
    for (let i = 0; i < 3; i += 1) {
      const k = ((s.frame + i * 40) % 120) / 120;
      v.noStroke();
      v.fill(`rgba(60,70,110,${(1 - k).toFixed(3)})`);
      v.textSize(9 + k * 8);
      v.textAlign("center", "middle");
      v.text("z", 490 + k * 22 + Math.sin(k * 8) * 4, 240 - k * 34);
    }
  }
}

export function painter(v: View, s: Scene): void {
  const t = act(s, "painter");
  const wob = t === null ? wiggle(s, "painter") : Math.sin(t * Math.PI * 9) * 0.2 * (1 - t) * Math.min(1, t * 8);
  const hang = t !== null && t < 0.8;
  put(v, S.ladder(v, hang), { x: 536, y: 568, px: 16, py: 236, rot: wob });
  if (!hang) {
    // idle: the brush arm dabs, leaving a dab of yellow on the wall
    const dab = Math.sin(s.frame * 0.12);
    v.noStroke();
    v.fill("rgba(247,214,92,0.9)");
    v.ellipse(592 + dab * 2, 382 + dab * 7, 7, 10);
  }
  if (t !== null && t < 0.9) {
    // paint drips falling to the bucket
    const pts: [number, number][] = [];
    for (let i = 0; i < 3; i += 1) {
      const k = (t - 0.1 - i * 0.08) / 0.35;
      if (k > 0 && k < 1) pts.push([584 + i * 3, 360 + k * k * 196]);
    }
    drops(v, "#f2c43a", pts);
  }
}

export function bucket(v: View, s: Scene): void {
  const t = act(s, "bucket");
  const tip = t === null ? wiggle(s, "bucket") : bell(t, 0, 0.7) * 1.1;
  const jump = t === null ? hop(s, "bucket") : -bell(t, 0, 0.25) * 18;
  if (t !== null && t > 0.12) {
    const k = Math.min(1, (t - 0.12) / 0.2);
    const fade = t > 0.75 ? 1 - (t - 0.75) / 0.25 : 1;
    v.noStroke();
    v.fill(`rgba(247,214,92,${(0.95 * fade).toFixed(3)})`);
    v.ellipse(618, 580, 10 + k * 56, 6 + k * 12);
    for (let i = 0; i < 6; i += 1) v.circle(600 + i * 8 + k * 10, 572 - Math.sin(i * 2.1) * 6 * k, 4 + (i % 2) * 2);
  }
  put(v, S.bucket(v), { x: 600, y: 582 + jump, px: 16, py: 32, rot: tip });
}

export function hydrant(v: View, s: Scene): void {
  const t = act(s, "hydrant");
  put(v, S.hydrant(v), { x: 434, y: 576 + hop(s, "hydrant"), px: 14, py: 44, rot: t === null ? 0 : Math.sin(t * 70) * 0.03 });
  if (t === null || t > 0.85) return;
  const pts: [number, number][] = [];
  const reach = Math.min(1, t / 0.15);
  for (let i = 0; i < 24; i += 1) {
    const k = (((s.frame * 3 + i * 7) % 48) / 48) * reach;
    pts.push([448 + k * 60, 552 - Math.sin(k * Math.PI) * 40 + k * 16 + Math.sin(i * 3) * 2]);
  }
  drops(v, "rgba(120,180,235,0.85)", pts);
}

export function dog(v: View, s: Scene): void {
  const t = act(s, "dog");
  const hy = act(s, "hydrant");
  const wet = hy !== null && hy > 0.2;
  const x = 488;
  let rot = 0;
  let flip = false;
  let lift = hop(s, "dog");
  const begging = t !== null && act(s, "baker") !== null;
  if (begging) {
    // sits up on its hind legs for the bread
    v.push();
    v.translate(x - 19, 584);
    v.rotate(-0.55 + Math.sin(s.frame * 0.3) * 0.05);
    v.image(S.dog(v, "stand"), -18, -50);
    v.pop();
    return;
  }
  if (t !== null) {
    // chase its own tail: flip back and forth, hopping
    flip = Math.floor(t * 12) % 2 === 1;
    lift = -Math.abs(Math.sin(t * Math.PI * 12)) * 10;
    rot = Math.sin(t * Math.PI * 6) * 0.15;
  }
  const wag = Math.sin(s.frame * (t === null ? 0.4 : 1.2)) * 6;
  v.push();
  v.translate(x, 586 + lift);
  v.rotate(rot);
  if (flip) v.scale(-1, 1);
  v.noBrush();
  v.noFill();
  v.stroke("#d9a25f");
  v.strokeWeight(5);
  v.curve([[-22, -22], [-30, -28], [-34 + wag * 0.4, -38], [-32 + wag, -44]]);
  v.image(S.dog(v, wet ? "wet" : "stand"), -37, -52);
  v.pop();
}

export function lamp(v: View, s: Scene): void {
  const t = act(s, "lamp");
  const on = s.evening || t !== null;
  const flick = t !== null && t < 0.15 ? Math.floor(t * 60) % 2 === 0 : on;
  put(v, S.lamp(v, flick), { x: 609, y: 574, px: 15, py: 190, rot: wiggle(s, "lamp") });
  if (!flick) return;
  v.blendMode("screen");
  v.image(S.glow(v), 609 - 80, 400 - 80, s.night ? 1 : 0.7);
  v.blendMode("normal");
  if (t !== null) {
    v.noStroke();
    v.fill("#5a4a3a");
    for (let i = 0; i < 2; i += 1) {
      const a = s.frame * 0.15 + i * Math.PI;
      v.ellipse(609 + Math.cos(a) * (18 + i * 6), 398 + Math.sin(a * 1.3) * 12, 5, 3);
    }
  }
}

// ── Grocer and town hall ───────────────────────────────────────────

export function grocer(v: View, s: Scene): void {
  const t = act(s, "grocer");
  const x = 762;
  const juggling = t !== null && t < 0.9;
  if (!juggling) {
    // sweeping: the broom swings about the hands
    const sw = Math.sin(s.frame * 0.1) * 0.35;
    v.push();
    v.translate(x - 16, FEET - 14);
    v.rotate(0.35 + sw);
    v.noBrush();
    v.stroke("#8a5a3a");
    v.strokeWeight(3);
    v.line(0, -16, -6, 22);
    v.noStroke();
    v.fill("#d9b45a");
    v.polygon([[-14, 20], [2, 20], [4, 32], [-16, 32]]);
    v.pop();
    put(v, S.folk(v, "grocer-sweep"), { x, y: FEET + hop(s, "grocer"), px: 32, py: 96 });
    return;
  }
  put(v, S.folk(v, "grocer-juggle"), { x, y: FEET + Math.sin(t * 40) * 1.5, px: 32, py: 96 });
  for (let i = 0; i < 3; i += 1) {
    const a = t * Math.PI * 10 + (i * Math.PI * 2) / 3;
    put(v, S.apple(v), { x: x + Math.cos(a) * 22, y: FEET - 64 - Math.abs(Math.sin(a)) * 60, px: 7, py: 8, scale: 1.4 });
  }
}

export function clockHands(v: View, s: Scene): void {
  const t = act(s, "clock");
  const spin = t === null ? 0 : t * t * Math.PI * 8;
  const minute = s.frame * 0.0017 - Math.PI / 2 + spin;
  const hour = s.frame * 0.00014 + 0.9 + spin / 12;
  const cx = 900;
  const cy = 200 + (t === null ? 0 : Math.sin(t * 80) * 1.2);
  v.noBrush();
  v.stroke("#3b2a24");
  v.strokeWeight(4);
  v.line(cx, cy, cx + Math.cos(hour) * 13, cy + Math.sin(hour) * 13);
  v.strokeWeight(3);
  v.line(cx, cy, cx + Math.cos(minute) * 20, cy + Math.sin(minute) * 20);
  v.noStroke();
  v.fill("#c23b3b");
  v.circle(cx, cy, 6);
  if (s.hover === "clock" && t === null) {
    v.image(S.glint(v), cx + 16, cy - 30, 0.6 + Math.sin(s.frame * 0.3) * 0.4);
  }
  if (t !== null) {
    // sound rings from the tower
    v.noFill();
    for (let i = 0; i < 3; i += 1) {
      const k = (t * 3 - i * 0.3) % 1;
      if (k < 0) continue;
      v.stroke(`rgba(194,59,59,${(0.6 * (1 - k)).toFixed(3)})`);
      v.strokeWeight(2);
      v.arc(cx, 130, 40 + k * 90, Math.PI * 1.1, Math.PI * 1.9);
    }
  }
}

const PIGEON_HOME: readonly (readonly [number, number])[] = [
  [818, 336],
  [842, 336],
  [954, 336],
  [978, 336],
];

export function pigeons(v: View, s: Scene): void {
  const t = act(s, "pigeons");
  for (const [i, [hx, hy]] of PIGEON_HOME.entries()) {
    if (t === null || t > 0.95) {
      const peck = Math.max(0, Math.sin(s.frame * 0.06 + i * 1.7)) ** 6 * 0.6;
      put(v, S.pigeon(v, false), { x: hx, y: hy + hop(s, "pigeons"), px: 13, py: 20, rot: peck, flip: i % 2 === 1 });
      continue;
    }
    // fly a loop round the tower and land
    const k = Math.min(1, t / 0.95);
    const a = k * Math.PI * 2 + i * 0.6;
    const r = Math.sin(k * Math.PI);
    const fx = hx + (900 - hx) * r + Math.cos(a) * 90 * r;
    const fy = hy - r * 170 + Math.sin(a) * 40 * r;
    const flapping = Math.floor(s.frame / 5 + i) % 2 === 0;
    put(v, S.pigeon(v, flapping), { x: fx, y: fy, px: 13, py: 20, flip: Math.cos(a) < 0 });
  }
}

export function flag(v: View, s: Scene): void {
  const t = act(s, "flag");
  const amp = t === null ? (s.hover === "flag" ? 6 : 3) : 9;
  const speed = t === null ? 0.12 : 0.45;
  const len = 52 + (t === null ? 0 : bell(t, 0, 1) * 10);
  const top: [number, number][] = [];
  const bottom: [number, number][] = [];
  for (let i = 0; i <= 8; i += 1) {
    const k = i / 8;
    const w = Math.sin(s.frame * speed - k * 5) * amp * k;
    top.push([902 + k * len, 44 + w]);
    bottom.push([902 + k * len, 76 + w - k * 4]);
  }
  v.noBrush();
  v.stroke("#3b2a24");
  v.strokeWeight(1.5);
  v.fill("#d8443a");
  v.polygon([...top, ...bottom.reverse()]);
  const mid = Math.sin(s.frame * speed - 2.5) * amp * 0.5;
  v.noStroke();
  v.fill("#f2c84b");
  v.circle(902 + len * 0.5, 60 + mid, 13);
  v.fill("#8a5a3a");
  v.rect(898 + len * 0.5, 50 + mid, 8, 4);
}

export function duck(v: View, s: Scene): void {
  const t = act(s, "duck");
  const quack = t !== null && t < 0.85;
  const x = 928;
  const rustle = quack ? 0 : Math.sin(s.frame * 0.05) * 0.03;
  const jump = quack ? -bell(t, 0, 0.3) * 18 : hop(s, "duck");
  put(v, S.folk(v, quack ? "duck-quack" : "duck-read"), { x, y: 553 + jump, px: 32, py: 96, rot: rustle });
}

// ── The road ───────────────────────────────────────────────────────

export function manhole(v: View, s: Scene): void {
  const t = act(s, "manhole");
  const cx = 303;
  const cy = 662;
  if (t === null) {
    put(v, S.manhole(v), { x: cx, y: cy + hop(s, "manhole") * 0.5, px: 31, py: 10 });
    const age = (s.frame % 150) / 150;
    if (age < 0.5) puff(v, cx + Math.sin(age * 9) * 6, cy - 6 - age * 50, 4 + age * 10, 0.45 * (1 - age * 2));
    return;
  }
  const up = bell(t, 0.05, 0.92);
  v.noStroke();
  v.fill("#1f1f26");
  v.ellipse(cx, cy, 54, 14);
  v.clip([[cx - 40, cy - 80], [cx + 40, cy - 80], [cx + 40, cy], [cx - 40, cy]], () => {
    const look = t > 0.3 && t < 0.7 ? Math.sin((t - 0.3) * 25) * 4 : 0;
    put(v, S.mole(v), { x: cx + look, y: cy + 36 - up * 50, px: 20, py: 40 });
  });
  put(v, S.manhole(v), { x: cx + 38 * up, y: cy - 4 * up, px: 31, py: 10, rot: -0.2 * up });
}

export function snail(v: View, s: Scene): void {
  const t = act(s, "snail");
  const tucked = t !== null && t < 0.9;
  put(v, S.snail(v, tucked), { x: snailX(s.frame), y: 580 + hop(s, "snail"), px: 0, py: 0, rot: tucked ? Math.sin(s.frame * 0.6) * 0.05 : 0 });
}

export function bus(v: View, s: Scene): void {
  const t = act(s, "bus");
  const x = busX(s);
  const idleShake = t === null ? Math.sin(s.frame * 1.7) * 0.6 : Math.sin(s.frame * 0.9) * 1.2;
  const y = BUS_Y + idleShake + hop(s, "bus");
  // exhaust from the back
  for (let i = 0; i < 4; i += 1) {
    const age = ((s.frame * (t === null ? 1 : 2.5) + i * 15) % 60) / 60;
    puff(v, x - 6 - age * 40, y + 78 - age * 26, 4 + age * 10, (1 - age) * 0.45);
  }
  v.image(S.bus(v), x, y);
  const turn = x * 0.07;
  for (const wx of [48, 172]) put(v, S.wheel(v), { x: x + wx, y: y + 98, px: 15, py: 15, rot: turn });
  if (t !== null && t > 0.6) {
    // a passenger waves out of the window on the way back
    v.noStroke();
    v.fill("#f4b6b4");
    v.circle(x + 34 + Math.sin(s.frame * 0.4) * 4, y + 8, 8);
  }
}

// ── Speech, hover glints, weather ─────────────────────────────────

interface Bubble {
  readonly text: string;
  readonly from: number;
  readonly to: number;
  readonly dx: number;
  readonly dy: number;
}

const BUBBLES: Readonly<Partial<Record<Id, Bubble>>> = {
  baker: { text: "Fresh bread!", from: 0.3, to: 0.8, dx: 50, dy: -12 },
  chimney: { text: "POF!", from: 0.05, to: 0.4, dx: -20, dy: -10 },
  window: { text: "Drink up, petunias!", from: 0.2, to: 0.75, dx: 90, dy: -10 },
  cat: { text: "MRRAOW!", from: 0, to: 0.6, dx: 60, dy: 0 },
  mail: { text: "Special delivery!", from: 0.05, to: 0.55, dx: 0, dy: -10 },
  mailbox: { text: "*burp*", from: 0.15, to: 0.6, dx: 30, dy: -20 },
  painter: { text: "Whoa whoa whoa!", from: 0.05, to: 0.7, dx: -10, dy: 0 },
  bucket: { text: "SPLOSH", from: 0.15, to: 0.5, dx: 40, dy: -6 },
  owl: { text: "WHO?!", from: 0.08, to: 0.75, dx: 70, dy: 6 },
  hydrant: { text: "fssshhh", from: 0.05, to: 0.6, dx: -14, dy: -16 },
  dog: { text: "Woof! Woof!", from: 0.1, to: 0.8, dx: 0, dy: -8 },
  lamp: { text: "ding!", from: 0, to: 0.3, dx: 36, dy: 10 },
  grocer: { text: "Ta-da!", from: 0.5, to: 0.9, dx: 56, dy: 10 },
  clock: { text: "DONG! DONG!", from: 0.05, to: 0.8, dx: -96, dy: -4 },
  flag: { text: "flap flap", from: 0.1, to: 0.7, dx: -60, dy: 30 },
  duck: { text: "QUACK! QUACK!", from: 0.05, to: 0.85, dx: -40, dy: -8 },
  bus: { text: "beep beep!", from: 0, to: 0.25, dx: 150, dy: -12 },
  manhole: { text: "Oh, hi!", from: 0.3, to: 0.7, dx: 40, dy: -60 },
  snail: { text: "eek", from: 0.05, to: 0.6, dx: 34, dy: -12 },
};

/** Some lines depend on what the neighbours are doing. */
function say(s: Scene, id: Id, line: string): string {
  const away = act(s, "bus");
  if (id === "duck" && away !== null && away < 0.9) return "QUACK! You're late!";
  if (id === "dog" && act(s, "baker") !== null) return "Sniff sniff... bread?";
  if (id === "dog" && act(s, "hydrant") !== null) return "Brrr! Wet dog!";
  if (id === "owl" && s.night) return "Hoo! It's MY bedtime!";
  const watering = act(s, "window");
  if (id === "cat" && watering !== null && watering < 0.85) return "MRRAOW! Wet!";
  return line;
}

interface Placed {
  readonly x: number;
  readonly y: number;
  readonly w: number;
}

const overlaps = (a: Placed, b: Placed): boolean => Math.abs(a.x - b.x) < (a.w + b.w) / 2 + 4 && Math.abs(a.y - b.y) < 29;

export function bubbles(v: View, s: Scene): void {
  const placed: Placed[] = [];
  for (const id of IDS) {
    const b = BUBBLES[id];
    const t = act(s, id);
    if (b === undefined || t === null || t < b.from || t > b.to) continue;
    const box = boxOf(s, id);
    const text = say(s, id, b.text);
    const w = text.length * 7.2 + 18;
    const cx = Math.min(W - w / 2 - 6, Math.max(w / 2 + 6, box.x + box.w / 2 + b.dx));
    const tipX = cx - b.dx * 0.15;
    const tipY = Math.max(24, box.y + b.dy - 14) + 24;
    // nudge up past any bubble already placed, so lines never cover each other
    let cy = tipY - 24;
    for (let tries = 0; tries < 5 && placed.some((p) => overlaps(p, { x: cx, y: cy, w })); tries += 1) cy -= 30;
    placed.push({ x: cx, y: cy, w });
    v.noBrush();
    v.fill("#fffdf4");
    v.stroke("#3b2a24");
    v.strokeWeight(2);
    v.triangle(cx - 6, cy + 10, cx + 6, cy + 10, tipX, tipY);
    v.rect(cx - w / 2, cy - 13, w, 25);
    v.noStroke();
    v.rect(cx - 7, cy + 8, 14, 5);
    v.fill("#3b2a24");
    v.textSize(13);
    v.textAlign("center", "middle");
    v.text(text, cx, cy);
  }
}

export function hoverGlint(v: View, s: Scene): void {
  if (s.hover === "" || act(s, s.hover) !== null) return;
  const b = boxOf(s, s.hover);
  const k = Math.sin(s.frame * 0.25);
  put(v, S.glint(v), { x: b.x + b.w - 4, y: b.y + 6, px: 12, py: 12, rot: s.frame * 0.05, alpha: 0.75 + k * 0.25, scale: 1.1 + k * 0.3 });
}

export function rain(v: View, frame: number): void {
  v.noBrush();
  v.stroke("rgba(210,225,250,0.7)");
  v.strokeWeight(1.5);
  for (let i = 0; i < 110; i += 1) {
    const x = (i * 97.3 + frame * 3) % 1040 - 20;
    const y = (i * 53.7 + frame * 14) % 760;
    v.line(x, y, x - 4, y + 14);
  }
  v.noFill();
  v.stroke("rgba(220,235,250,0.5)");
  for (let i = 0; i < 8; i += 1) {
    const k = ((frame + i * 13) % 40) / 40;
    v.ellipse(60 + i * 123, i % 2 === 0 ? 590 : 728, 6 + k * 22, 2 + k * 6);
  }
}
