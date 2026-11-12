// The boardwalk out from the village, its posts, and the lamps along it.
import type { Sketch, Vec2 } from "@ianbicking/canvas-loop";

const X0 = 180;
const X1 = 740;

/** Top (far) edge of the deck at x. */
export function deckTop(x: number): number {
  return 505 + ((x - X0) / (X1 - X0)) * 83;
}

/** Front (near) edge of the deck at x. */
export function deckFront(x: number): number {
  return 514 + ((x - X0) / (X1 - X0)) * 108;
}

/** Perspective scale at x: 1 at the pier's end. */
export function depth(x: number): number {
  return 0.35 + (0.65 * (x - X0)) / (X1 - X0);
}

export interface Lamp {
  readonly x: number;
  readonly height: number;
  /** Where the lantern hangs. */
  readonly hx: number;
  readonly hy: number;
  readonly k: number;
}

function lampAt(x: number, height: number): Lamp {
  const k = depth(x);
  const top = deckTop(x) - height;
  return { x, height, hx: x - 34 * k, hy: top + 8 * k, k };
}

export const LAMP = lampAt(738, 315);
export const LIT_LAMPS: readonly Lamp[] = [lampAt(300, 285 * depth(300)), lampAt(430, 285 * depth(430))];

const WOOD = { deck: "#8c6b70", deckLit: "#c4917a", beam: "#3f2b38", post: "#2e2131", plank: "#5a4150" } as const;

export function drawWalkway(s: Sketch): void {
  // Posts down into the water, with short dark reflections.
  s.brush("ink");
  s.gesture({ pressure: "even", wobble: 0.8 });
  for (let x = X0 + 30; x <= X1; x += 62) {
    const k = depth(x);
    const y0 = deckFront(x);
    s.stroke(WOOD.post);
    s.strokeWeight(9 * k);
    s.line(x, y0, x, y0 + 50 * k);
    s.stroke("rgba(30,24,50,0.45)");
    s.strokeWeight(7 * k);
    s.line(x, y0 + 50 * k, x + 1, y0 + 90 * k);
  }
  s.noBrush();
  // Deck surface.
  s.noStroke();
  const deck: Vec2[] = [
    [X0, deckTop(X0)],
    [X1, deckTop(X1)],
    [X1, deckFront(X1)],
    [X0, deckFront(X0)],
  ];
  s.fill(s.linearGradient(X0, 0, X1, 0, [
    [0, WOOD.deck],
    [1, WOOD.deckLit],
  ]));
  s.polygon(deck);
  // Side beam under the front edge.
  s.fill(WOOD.beam);
  s.polygon([
    [X0, deckFront(X0)],
    [X1, deckFront(X1)],
    [X1, deckFront(X1) + 16],
    [X0, deckFront(X0) + 5],
  ]);
  // Plank seams, over brushed wood grain.
  s.clip(deck, () => {
    s.noFill();
    s.brush("bristle", { bristles: 9, load: 0.9, flow: 0.4, spread: 0.6 });
    s.gesture({ pressure: "taper", wobble: 0.6 });
    for (let i = 0; i < 6; i += 1) {
      const f = (i + 0.5) / 6;
      s.stroke(i % 2 === 0 ? "#6e5060" : "#d8a585");
      s.strokeWeight(5);
      s.line(X0, deckTop(X0) + f * (deckFront(X0) - deckTop(X0)), X1, deckTop(X1) + f * (deckFront(X1) - deckTop(X1)));
    }
    s.noFill();
    s.stroke(WOOD.plank);
    s.brush("pencil", { opacity: 0.8 });
    s.gesture({ pressure: "even", wobble: 0.4 });
    for (let x = X0 + 8; x < X1; x += 5 + 16 * depth(x)) {
      s.strokeWeight(1.5 + 1.5 * depth(x));
      s.line(x, deckTop(x) - 2, x + 6 * depth(x), deckFront(x) + 2);
    }
    s.noBrush();
  });
}

export function drawLantern(s: Sketch, lamp: Lamp, main: boolean): void {
  const { x, hx, hy, k } = lamp;
  const base = deckTop(x);
  const top = base - lamp.height;
  // Reflection of the light in the water.
  s.noFill();
  s.brush("wash", { opacity: 0.5 });
  s.gesture({ pressure: "taper-out", wobble: 4 });
  s.stroke("#ffcf7a");
  s.strokeWeight(26 * k);
  s.line(hx, deckFront(x) + 24 * k, hx + 2, deckFront(x) + 170 * k);
  s.noBrush();
  // Glow, and a pool of light on the deck below.
  s.noStroke();
  const r = (main ? 230 : 150) * k;
  s.fill(s.radialGradient(hx, hy + 26 * k, r, [
    [0, "rgba(255,222,140,0.85)"],
    [0.18, "rgba(255,196,112,0.45)"],
    [0.55, "rgba(255,170,100,0.12)"],
    [1, "rgba(255,170,100,0)"],
  ]));
  s.circle(hx, hy + 26 * k, 2 * r);
  if (main) {
    s.fill(s.radialGradient(hx, hy + 28 * k, 46 * k, [
      [0, "rgba(255,246,210,0.95)"],
      [0.5, "rgba(255,226,150,0.5)"],
      [1, "rgba(255,210,130,0)"],
    ]));
    s.circle(hx, hy + 28 * k, 92 * k);
  }
  s.fill(s.ellipseGradient(hx, (deckTop(x) + deckFront(x)) / 2, 220 * k, 50 * k, [
    [0, "rgba(255,210,140,0.6)"],
    [1, "rgba(255,190,120,0)"],
  ]));
  s.ellipse(hx, (deckTop(x) + deckFront(x)) / 2, 220 * k, 50 * k);
  // Post and arm.
  s.stroke(WOOD.post);
  s.brush("ink");
  s.gesture({ pressure: "even", wobble: 0.5 });
  s.strokeWeight(8 * k);
  s.line(x, base + 2, x, top);
  s.strokeWeight(4 * k);
  s.line(x + 3 * k, top + 2 * k, hx - 4 * k, top + 2 * k);
  s.strokeWeight(2 * k);
  s.line(hx, top + 2 * k, hx, hy + 6 * k);
  s.noBrush();
  // Lantern: cap, glass, base.
  s.noStroke();
  s.fill("#ffe2a0");
  s.polygon([
    [hx - 11 * k, hy + 14 * k],
    [hx + 11 * k, hy + 14 * k],
    [hx + 9 * k, hy + 40 * k],
    [hx - 9 * k, hy + 40 * k],
  ]);
  s.fill("#fff6d6");
  s.ellipse(hx, hy + 30 * k, 8 * k, 14 * k);
  s.fill("#2a1e2e");
  s.triangle(hx - 15 * k, hy + 15 * k, hx + 15 * k, hy + 15 * k, hx, hy + 4 * k);
  s.rect(hx - 11 * k, hy + 39 * k, 22 * k, 5 * k);
  s.stroke("#2a1e2e");
  s.strokeWeight(1.6 * k);
  s.line(hx, hy + 15 * k, hx, hy + 40 * k);
}
