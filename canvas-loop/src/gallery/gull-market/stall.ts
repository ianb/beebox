// The fish stall: posts, striped awning, the dim interior behind the
// fishmonger, and (drawn after him) the counter with its tray of fish on ice
// and the fish-shaped gap where the stolen mackerel lay.
import type { Sketch, Vec2 } from "@ianbicking/canvas-loop";
import { fish } from "./fish.js";
import { form, hash, INK, mark, ring } from "./kit.js";

const LEFT = 478;
const RIGHT = 872;
const VALANCE = 206;
export const TRAY_BACK = 436;
export const TRAY_FRONT = 482;
/** Where the stolen fish lay. */
export const GAP: Vec2 = [530, 462];

export function stallBack(s: Sketch): void {
  // dim interior so the fishmonger stands out against it
  form(s, [[LEFT, VALANCE], [RIGHT, VALANCE], [RIGHT, TRAY_BACK + 10], [LEFT, TRAY_BACK + 10]], {
    base: "#3d5a66", shade: "#24363f", strokes: "#6a93a3", depth: 30, sharp: true, seed: 610,
  });
  for (let i = 0; i < 9; i += 1) {
    const x = LEFT + 20 + i * 44;
    mark(s, [[x, VALANCE + 4], [x + 2, TRAY_BACK + 6]], { color: "#2a414b", weight: 3, brush: "pencil", pressure: "even", wobble: 1, seed: 600 + i });
  }
  // posts
  for (const x of [LEFT, RIGHT]) {
    form(s, [[x - 8, 150], [x + 8, 150], [x + 8, 610], [x - 8, 610]], { base: "#f4efe4", shade: "#b9ae9a", depth: 7, sharp: true, weight: 2.2, seed: x });
  }
}

export function awning(s: Sketch): void {
  const backY = 154;
  // sloped roof in stripes
  const n = 9;
  for (let i = 0; i < n; i += 1) {
    const t0 = i / n;
    const t1 = (i + 1) / n;
    const bx = (t: number): number => 492 + t * 366;
    const fx = (t: number): number => 452 + t * 446;
    const quad: Vec2[] = [[bx(t0), backY], [bx(t1), backY], [fx(t1), VALANCE], [fx(t0), VALANCE]];
    form(s, quad, { base: i % 2 === 0 ? "#e2423a" : "#fbf4e6", shade: i % 2 === 0 ? "#a42a2a" : "#d9cbb3", strokes: i % 2 === 0 ? "#f2766a" : "#e6d6bc", slope: 0, depth: 8, sharp: true, seed: 620 + i });
  }
  // scalloped valance
  const scallops = 11;
  const step = 446 / scallops;
  for (let i = 0; i < scallops; i += 1) {
    const x0 = 452 + i * step;
    const lobe: Vec2[] = [[x0, VALANCE], [x0 + step, VALANCE], [x0 + step, VALANCE + 14], [x0 + step * 0.5, VALANCE + 32], [x0, VALANCE + 14]];
    form(s, lobe, { base: i % 2 === 0 ? "#e2423a" : "#fbf4e6", shade: i % 2 === 0 ? "#a42a2a" : "#d9cbb3", depth: 6, weight: 2, seed: 640 + i });
  }
  mark(s, [[492, backY], [858, backY]], { color: INK, weight: 2.5, pressure: "even" });
  mark(s, [[452, VALANCE], [898, VALANCE]], { color: INK, weight: 3, pressure: "swell" });
  mark(s, [[492, backY], [452, VALANCE]], { color: INK, weight: 2.5 });
  mark(s, [[858, backY], [898, VALANCE]], { color: INK, weight: 2.5 });
  // name board on the roof
  form(s, [[566, 106], [786, 106], [786, 146], [566, 146]], { base: "#1f4e6e", shade: "#123247", light: "#3f7da3", depth: 8, sharp: true, weight: 3, seed: 66 });
  mark(s, [[600, 146], [596, 156]], { color: INK, weight: 3, pressure: "even" });
  mark(s, [[752, 146], [756, 156]], { color: INK, weight: 3, pressure: "even" });
  s.noStroke();
  s.fill("#fbe7a1");
  s.textFont("Georgia, serif");
  s.textStyle("bold");
  s.textSize(26);
  s.textAlign("center", "middle");
  s.text("FRESH FISH", 676, 127);
}

export function counter(s: Sketch): void {
  // wooden front, painted blue, planks brushed
  const front: Vec2[] = [[446, TRAY_FRONT], [892, TRAY_FRONT], [884, 606], [454, 606]];
  form(s, front, { base: "#3e86b8", shade: "#25587e", light: "#7ab8de", depth: 18, sharp: true, weight: 3, seed: 70 });
  s.clip(front, () => {
    for (let i = 1; i < 5; i += 1) {
      const y = TRAY_FRONT + i * 25;
      mark(s, [[446, y], [892, y + 1]], { color: "#1d4766", weight: 2.4, pressure: "even", wobble: 0.8, seed: 700 + i });
    }
    for (let i = 0; i < 14; i += 1) {
      const y = TRAY_FRONT + 10 + hash(i + 5) * 110;
      const x = 460 + hash(i + 9) * 380;
      mark(s, [[x, y], [x + 60 + hash(i) * 80, y + 2]], { color: "#5aa0cf", weight: 10, brush: "bristle", opacity: 0.6, seed: 720 + i });
    }
  });
  // painted fish emblem on the front
  fish(s, { at: [670, 548], len: 110, angle: 0, body: "#f4efe4", belly: "#e8dcc5", seed: 760 });
  tray(s);
}

function tray(s: Sketch): void {
  const top: Vec2[] = [[468, TRAY_BACK], [872, TRAY_BACK], [892, TRAY_FRONT], [446, TRAY_FRONT]];
  form(s, top, { base: "#e9f5fa", shade: "#b9d6e3", depth: 8, sharp: true, weight: 2.5, seed: 80 });
  // crushed ice
  for (let i = 0; i < 70; i += 1) {
    const x = 470 + hash(i + 100) * 410;
    const y = TRAY_BACK + 6 + hash(i + 200) * 38;
    mark(s, [[x, y], [x + 5, y - 2]], { color: hash(i) > 0.5 ? "#ffffff" : "#a9cbdb", weight: 4, brush: "chalk", seed: 800 + i });
  }
  // the empty place: a wet, fish-shaped hollow in the ice, and a few drips
  form(s, ring(GAP[0], GAP[1], 42, 10), { base: "#9fc3d4", shade: "#7aa5ba", depth: 3, line: "#6f97ab", weight: 1.5, seed: 81 });
  mark(s, [[GAP[0] + 40, GAP[1] - 2], [GAP[0] + 56, GAP[1] - 10], [GAP[0] + 58, GAP[1] + 8]], { color: "#7aa5ba", weight: 2, seed: 82 });
  // the fish still on ice
  const laid: { x: number; y: number; a: number; body: string; belly: string; stripes?: string }[] = [
    { x: 612, y: 452, a: -0.18, body: "#4d7f8f", belly: "#dfe9ea", stripes: "#203a46" },
    { x: 690, y: 458, a: 0.12, body: "#d5584a", belly: "#f4c2a8" },
    { x: 768, y: 450, a: -0.1, body: "#8fa3ad", belly: "#eef2f2" },
    { x: 836, y: 462, a: 0.2, body: "#4d7f8f", belly: "#dfe9ea", stripes: "#203a46" },
    { x: 650, y: 472, a: 0.05, body: "#8fa3ad", belly: "#eef2f2" },
    { x: 740, y: 474, a: -0.06, body: "#4d7f8f", belly: "#dfe9ea", stripes: "#203a46" },
  ];
  for (const [i, f] of laid.entries()) {
    fish(s, { at: [f.x, f.y], len: 84, angle: f.a, body: f.body, belly: f.belly, ...(f.stripes === undefined ? {} : { stripes: f.stripes }), seed: 900 + i * 7 });
  }
  // lemons
  for (const [x, y] of [[582, 474], [808, 476]] as const) {
    form(s, ring(x, y, 10, 7), { base: "#f7d548", shade: "#d1a52a", light: "#fff3a6", depth: 4, weight: 1.6, seed: x });
  }
  // price card stuck in the ice beside the gap, now pointing at nothing
  form(s, [[462, 410], [530, 403], [534, 434], [466, 441]], { base: "#fffdf3", shade: "#e2dcc8", depth: 4, sharp: true, weight: 2, seed: 90 });
  mark(s, [[497, 438], [499, 458]], { color: "#8a6a44", weight: 3, pressure: "even" });
  s.noStroke();
  s.fill(INK);
  s.textFont("Georgia, serif");
  s.textStyle("bold");
  s.textSize(11);
  s.textAlign("center", "middle");
  s.text("MACKEREL", 498, 418);
  s.text("£2", 499, 431);
}
