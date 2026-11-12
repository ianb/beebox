// The fishmonger behind his counter, too late: cap jumping off his head,
// eyes up and left at the gull, one arm flung out pointing after it, the
// other hand spread in shock, mouth open on "Oi!".
import type { PathCommand, Sketch, Vec2 } from "@ianbicking/canvas-loop";
import { form, INK, LIGHT, mark, ring, shift } from "./kit.js";

const SKIN = "#f2b48c";
const SKIN_SHADE = "#c9805e";
const JUMPER = "#2f3f6b";
const JUMPER_SHADE = "#1c2747";
const HEAD: Vec2 = [692, 312];

interface LimbSpec {
  pts: readonly Vec2[];
  width: number;
  base: string;
  shade: string;
  seed: number;
}

function limb(s: Sketch, l: LimbSpec): void {
  const outline: PathCommand[] = s.tube(l.pts, { width: l.width, profile: [[0, 1], [1, 0.8]] });
  s.noStroke();
  s.fill(l.base);
  s.path(outline);
  s.clip(outline, () => {
    mark(s, shift(l.pts, -LIGHT[0] * l.width * 0.4, -LIGHT[1] * l.width * 0.4), {
      color: l.shade, weight: l.width * 0.7, brush: "wash", opacity: 0.8, pressure: "even", seed: l.seed,
    });
  });
  s.noFill();
  s.stroke(INK);
  s.strokeWeight(2.6);
  s.brush("ink");
  s.gesture({ pressure: "swell", wobble: 0.5, seed: l.seed + 1 });
  s.path(outline);
  s.noBrush();
}

export function fishmonger(s: Sketch): void {
  // torso and apron
  const torso: Vec2[] = [[608, 470], [614, 398], [636, 366], [692, 352], [750, 366], [774, 402], [782, 470]];
  form(s, torso, { base: JUMPER, shade: JUMPER_SHADE, light: "#4b5f94", strokes: "#4b5f94", depth: 22, weight: 3, seed: 1001 });
  const apron: Vec2[] = [[648, 398], [738, 398], [752, 470], [634, 470]];
  form(s, apron, { base: "#f6f3ea", shade: "#cfd6de", depth: 12, sharp: true, weight: 2.2, seed: 1002 });
  s.clip(apron, () => {
    for (let i = 0; i < 6; i += 1) {
      const x = 640 + i * 20;
      mark(s, [[x, 396], [x + (i - 2.5) * 2, 472]], { color: "#3e86b8", weight: 5, brush: "marker", pressure: "even", seed: 1010 + i });
    }
  });
  mark(s, [[652, 398], [660, 362]], { color: "#f6f3ea", weight: 6, pressure: "even" });
  mark(s, [[734, 398], [726, 362]], { color: "#f6f3ea", weight: 6, pressure: "even" });
  // the shocked arm, hand spread
  limb(s, { pts: [[758, 384], [796, 352], [814, 312]], width: 28, base: JUMPER, shade: JUMPER_SHADE, seed: 1020 });
  spreadHand(s);
  // the pointing arm: jumper sleeve to the elbow, bare forearm to the hand
  limb(s, { pts: [[628, 386], [598, 360], [584, 346]], width: 30, base: JUMPER, shade: JUMPER_SHADE, seed: 1030 });
  limb(s, { pts: [[590, 352], [568, 330], [552, 314]], width: 22, base: SKIN, shade: SKIN_SHADE, seed: 1040 });
  form(s, ring(548, 310, 13, 11), { base: SKIN, shade: SKIN_SHADE, depth: 5, weight: 2.4, seed: 1041 });
  limb(s, { pts: [[540, 304], [526, 294], [516, 288]], width: 8, base: SKIN, shade: SKIN_SHADE, seed: 1042 });
  head(s);
}

function spreadHand(s: Sketch): void {
  const palm: Vec2 = [818, 300];
  for (const [i, a] of [-2.3, -1.85, -1.4, -0.95, -0.35].entries()) {
    const len = i === 4 ? 14 : 20;
    limb(s, { pts: [palm, [palm[0] + Math.cos(a) * len, palm[1] + Math.sin(a) * len]], width: 7, base: SKIN, shade: SKIN_SHADE, seed: 1050 + i });
  }
  form(s, ring(palm[0], palm[1], 12, 12), { base: SKIN, shade: SKIN_SHADE, depth: 5, weight: 2.2, seed: 1060 });
}

function head(s: Sketch): void {
  const [hx, hy] = HEAD;
  form(s, ring(hx - 38, hy + 4, 8, 11), { base: SKIN, shade: SKIN_SHADE, depth: 4, weight: 2, seed: 1101 });
  form(s, ring(hx + 38, hy + 4, 8, 11), { base: SKIN, shade: SKIN_SHADE, depth: 4, weight: 2, seed: 1102 });
  form(s, ring(hx, hy, 38, 42, 20), { base: SKIN, shade: SKIN_SHADE, light: "#ffd7bb", depth: 12, weight: 3, seed: 1103 });
  // grey hair around the sides, bald crown (his cap has just left it)
  for (const side of [-1, 1]) {
    mark(s, [[hx + side * 30, hy - 26], [hx + side * 37, hy - 12], [hx + side * 36, hy + 2]], { color: "#9aa0a6", weight: 6, brush: "chalk", seed: 1110 + side });
  }
  // cheeks
  s.noStroke();
  s.fill("rgba(226,92,80,0.35)");
  s.circle(hx - 22, hy + 14, 18);
  s.circle(hx + 22, hy + 14, 18);
  // eyes wide, looking up and left after the gull
  for (const ex of [hx - 15, hx + 14]) {
    s.fill("#ffffff");
    s.stroke(INK);
    s.strokeWeight(2);
    s.ellipse(ex, hy - 8, 17, 19);
    s.noStroke();
    s.fill(INK);
    s.circle(ex - 4, hy - 12, 7);
    mark(s, [[ex - 10, hy - 24], [ex, hy - 30], [ex + 9, hy - 25]], { color: "#6b6f75", weight: 4, seed: 1120 + ex });
  }
  // nose, moustache, open mouth
  form(s, ring(hx + 1, hy + 6, 9, 8), { base: "#e98f73", shade: "#c26a52", depth: 4, weight: 2, seed: 1130 });
  form(s, ring(hx + 1, hy + 31, 9, 11), { base: "#5a1f24", shade: "#3a1015", depth: 3, weight: 2.2, seed: 1131 });
  s.noStroke();
  s.fill("#d9606a");
  s.ellipse(hx + 1, hy + 37, 10, 6);
  const tache: Vec2[] = [[hx - 26, hy + 22], [hx - 14, hy + 12], [hx + 1, hy + 17], [hx + 16, hy + 12], [hx + 28, hy + 22], [hx + 12, hy + 23], [hx + 1, hy + 20], [hx - 10, hy + 23]];
  form(s, tache, { base: "#b8b2a8", shade: "#7d776e", depth: 4, weight: 2, seed: 1132 });
  cap(s);

}

function cap(s: Sketch): void {
  s.push();
  s.translate(HEAD[0] + 26, HEAD[1] - 56);
  s.rotate(0.42);
  const crown: Vec2[] = [[-34, 4], [-26, -14], [6, -20], [32, -8], [36, 6]];
  form(s, crown, { base: "#5d6b5a", shade: "#3c473a", light: "#8a9a85", depth: 6, weight: 2.6, seed: 1140 });
  form(s, [[22, 2], [52, 4], [54, 10], [24, 10]], { base: "#4a5648", shade: "#323b30", depth: 3, weight: 2.2, seed: 1141 });
  s.pop();
  // jump lines under the cap
  for (const [i, x] of [700, 718, 736].entries()) {
    mark(s, [[x, 276 - i * 2], [x + 4, 266 - i * 2]], { color: INK, weight: 2.4, seed: 1150 + i });
  }
}

export function shock(s: Sketch): void {
  // a jagged burst with "OI!" in it, up by his pointing hand
  const c: Vec2 = [604, 236];
  const pts: Vec2[] = [];
  for (let i = 0; i < 18; i += 1) {
    const a = (i / 18) * Math.PI * 2;
    const r = i % 2 === 0 ? 40 : 28;
    pts.push([c[0] + Math.cos(a) * r * 1.25, c[1] + Math.sin(a) * r]);
  }
  form(s, pts, { base: "#fff3a8", shade: "#f2c94c", depth: 6, sharp: true, weight: 2.6, seed: 1160 });
  s.noStroke();
  s.fill("#c0302a");
  s.textFont("Georgia, serif");
  s.textStyle("bold");
  s.textSize(26);
  s.textAlign("center", "middle");
  s.text("OI!", c[0], c[1] + 1);
}
