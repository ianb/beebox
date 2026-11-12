// One fish, drawn in its own frame: nose at -len/2, tail at +len/2, belly down.
import type { Sketch, Vec2 } from "@ianbicking/canvas-loop";
import { form, INK, mark } from "./kit.js";

export interface FishSpec {
  at: Vec2;
  len: number;
  angle: number;
  body: string;
  belly: string;
  /** Dark tiger stripes along the back (mackerel). */
  stripes?: string;
  /** Bend of the body: positive curls the tail down. */
  curl?: number;
  seed: number;
}

export function fish(s: Sketch, f: FishSpec): void {
  s.push();
  s.translate(f.at[0], f.at[1]);
  s.rotate(f.angle);
  paintFish(s, f);
  s.pop();
}

function paintFish(s: Sketch, f: FishSpec): void {
  const L = f.len / 2;
  const h = f.len * 0.17;
  const c = f.curl ?? 0;
  const bend = (x: number): number => c * ((x + L) / (2 * L)) ** 2 * f.len * 0.25;
  const body: Vec2[] = [
    [-L, bend(-L)],
    [-L * 0.6, -h * 0.85 + bend(-L * 0.6)],
    [0, -h + bend(0)],
    [L * 0.55, -h * 0.45 + bend(L * 0.55)],
    [L * 0.8, bend(L * 0.8) - h * 0.12],
    [L * 0.55, h * 0.4 + bend(L * 0.55)],
    [0, h * 0.95 + bend(0)],
    [-L * 0.6, h * 0.75 + bend(-L * 0.6)],
  ];
  const tail: Vec2[] = [
    [L * 0.74, bend(L * 0.74)],
    [L * 1.05, -h * 0.85 + bend(L)],
    [L * 0.96, bend(L)],
    [L * 1.05, h * 0.85 + bend(L)],
  ];
  form(s, tail, { base: f.body, shade: INK, depth: 2, sharp: true, weight: 1.6, seed: f.seed + 1 });
  form(s, body, { base: f.body, shade: f.belly, depth: 3, light: "#eef6fb", weight: 2, seed: f.seed });
  s.clip(s.curvePath(body, true), () => {
    s.noStroke();
    s.fill(f.belly);
    s.curve(body.map(([x, y]): Vec2 => [x, y + h * 0.9]), true);
    if (f.stripes !== undefined) {
      for (let i = 0; i < 7; i += 1) {
        const x = -L * 0.35 + i * L * 0.17;
        mark(s, [[x, -h + bend(x)], [x + 4, -h * 0.4 + bend(x)], [x - 2, -h * 0.05 + bend(x)]], {
          color: f.stripes, weight: 2.4, wobble: 1.2, seed: f.seed * 10 + i,
        });
      }
    }
    // a shine along the back
    mark(s, [[-L * 0.5, -h * 0.55 + bend(-L * 0.5)], [0, -h * 0.72 + bend(0)], [L * 0.4, -h * 0.4 + bend(L * 0.4)]], {
      color: "#ffffff", weight: 2.2, opacity: 0.8, seed: f.seed + 2,
    });
  });
  // gill and eye
  mark(s, [[-L * 0.55, -h * 0.6 + bend(-L * 0.55)], [-L * 0.47, bend(-L * 0.5)], [-L * 0.55, h * 0.55 + bend(-L * 0.55)]], {
    color: INK, weight: 1.6, seed: f.seed + 3,
  });
  s.noStroke();
  s.fill("#ffffff");
  s.circle(-L * 0.74, -h * 0.2 + bend(-L * 0.74), h * 0.6);
  s.fill(INK);
  s.circle(-L * 0.74, -h * 0.2 + bend(-L * 0.74), h * 0.3);
}
