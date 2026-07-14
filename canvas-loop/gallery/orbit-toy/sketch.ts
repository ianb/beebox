// Orbit toy: a sun with three orbiting planets.
//
//   - click a planet to select it (highlight ring)
//   - click empty space to deselect
//   - ArrowUp/ArrowDown while a planet is selected speeds it up / slows it down
//   - HUD (top-left) shows frame count + selected planet name & angular speed
//
// Position is angle-based: angle(frame) = angle0 + speed * frame, recomputed
// fresh each frame (not accumulated), so a speed change takes effect
// immediately and hit-testing in a handler (which runs *before* that frame's
// draw) can predict the exact on-screen spot with the same formula.
import type { Sketch, SketchInputEvent } from "@ianbicking/canvas-loop";

interface Planet {
  name: string;
  orbitRadius: number;
  angle0: number;
  speed: number;
  size: number;
  color: string;
}

const CENTER_X = 250;
const CENTER_Y = 200;
const SUN_RADIUS = 20;
const SPEED_STEP = 0.01;
const HIT_PADDING = 4;

let planets: Planet[] = [];
let selected = -1;

function makePlanets(): Planet[] {
  return [
    { name: "Mercury", orbitRadius: 60, angle0: 0, speed: 0.06, size: 10, color: "#f59e0b" },
    { name: "Venus", orbitRadius: 100, angle0: 2.1, speed: -0.035, size: 14, color: "#38bdf8" },
    { name: "Earth", orbitRadius: 150, angle0: 4.2, speed: 0.02, size: 16, color: "#22c55e" },
  ];
}

function planetPos(p: Planet, frame: number): { x: number; y: number } {
  const angle = p.angle0 + p.speed * frame;
  return { x: CENTER_X + p.orbitRadius * Math.cos(angle), y: CENTER_Y + p.orbitRadius * Math.sin(angle) };
}

function hitTest({ x, y, frame }: { x: number; y: number; frame: number }): number {
  for (let i = 0; i < planets.length; i++) {
    const p = planets.at(i);
    if (p === undefined) continue;
    const { x: px, y: py } = planetPos(p, frame);
    const dx = x - px;
    const dy = y - py;
    const hitRadius = p.size / 2 + HIT_PADDING;
    if (dx * dx + dy * dy <= hitRadius * hitRadius) return i;
  }
  return -1;
}

export function setup(s: Sketch): void {
  s.createCanvas(500, 400);
  planets = makePlanets();
  selected = -1;
}

export function draw(s: Sketch): void {
  s.background("#0b1020");

  // orbit paths
  s.noFill();
  s.stroke("#1e293b");
  s.strokeWeight(1);
  for (const p of planets) {
    s.circle(CENTER_X, CENTER_Y, p.orbitRadius * 2);
  }

  // sun
  s.noStroke();
  s.fill("#facc15");
  s.circle(CENTER_X, CENTER_Y, SUN_RADIUS * 2);

  // planets
  for (let i = 0; i < planets.length; i++) {
    const p = planets.at(i);
    if (p === undefined) continue;
    const { x, y } = planetPos(p, s.frameCount);
    s.noStroke();
    s.fill(p.color);
    s.circle(x, y, p.size);
    if (i === selected) {
      s.noFill();
      s.stroke("#f8fafc");
      s.strokeWeight(2);
      s.circle(x, y, p.size + HIT_PADDING * 2 + 4);
    }
  }

  // HUD
  s.noStroke();
  s.fill("#e2e8f0");
  s.textSize(14);
  s.textAlign("left", "top");
  s.text(`frame ${s.frameCount}`, 8, 8);
  const sel = selected >= 0 ? planets.at(selected) : undefined;
  if (sel !== undefined) {
    s.text(`selected: ${sel.name}  speed: ${sel.speed.toFixed(3)}`, 8, 26);
  } else {
    s.text("selected: none", 8, 26);
  }
}

export function mousePressed(s: Sketch): void {
  const hit = hitTest({ x: s.mouseX, y: s.mouseY, frame: s.frameCount });
  selected = hit;
  s.log(hit >= 0 ? `selected ${planets.at(hit)?.name}` : "deselected (empty space)");
}

export function keyPressed(s: Sketch, e: SketchInputEvent): void {
  if (selected < 0) return;
  const p = planets.at(selected);
  if (p === undefined) return;
  if (e.key === "ArrowUp") {
    p.speed += p.speed >= 0 ? SPEED_STEP : -SPEED_STEP;
    s.log(`${p.name} speed -> ${p.speed.toFixed(3)}`);
  } else if (e.key === "ArrowDown") {
    p.speed -= p.speed >= 0 ? SPEED_STEP : -SPEED_STEP;
    s.log(`${p.name} speed -> ${p.speed.toFixed(3)}`);
  }
}
