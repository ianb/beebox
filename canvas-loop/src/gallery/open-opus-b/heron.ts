// Old Pell the heron, in a red knitted scarf, reaching the lighting pole up to
// the last lamp. Local coordinates: origin between the feet, facing +x.
import type { Sketch, Vec2 } from "@ianbicking/canvas-loop";

import { deckFront, deckTop, LAMP } from "./pier.js";

const FEET_X = 560;
const FEET_Y = (deckTop(FEET_X) + deckFront(FEET_X)) / 2 - 2;
const SCALE = 1.2;

const H = {
  body: "#8593ae",
  bodyShade: "#4e587a",
  belly: "#d3d8e2",
  wing: "#5b6788",
  wingDark: "#363e5e",
  rim: "#ffc98c",
  ink: "#1d1c2c",
  leg: "#c99e55",
  bill: "#e3ad45",
  scarf: "#c63a36",
  scarfDark: "#7e1f2c",
  pole: "#4a2f24",
} as const;

const BODY: readonly Vec2[] = [
  [52, -150],
  [48, -110],
  [22, -84],
  [-28, -78],
  [-84, -66],
  [-68, -116],
  [-30, -158],
  [16, -172],
];

const WING: readonly Vec2[] = [
  [30, -148],
  [32, -114],
  [6, -92],
  [-60, -76],
  [-104, -62],
  [-64, -104],
  [-18, -150],
];

const NECK: readonly Vec2[] = [
  [30, -164],
  [48, -190],
  [32, -212],
  [34, -228],
  [42, -234],
];

const HEAD = { x: 48, y: -236 } as const;
const GRIP: Vec2 = [50, -116];

type Tint = (pts: readonly Vec2[]) => void;

/** Fill a shape, then inside it a warm rim on the lamp side and a cool shade on the far side. */
function litShape(s: Sketch, pts: readonly Vec2[], base: string, extra?: Tint): void {
  s.noStroke();
  s.fill(H.rim);
  s.curve(pts, true);
  s.clip(s.curvePath(pts, true), () => {
    s.fill(base);
    s.curve(s.offset(pts, -1).map(([x, y]): Vec2 => [x - 4, y + 2.5]), true);
    s.fill(H.bodyShade);
    s.group({ opacity: 0.35 }, () => {
      s.curve(s.offset(pts, -2).map(([x, y]): Vec2 => [x - 26, y + 22]), true);
    });
    if (extra) extra(pts);
  });
}

export function drawHeron(s: Sketch): void {
  drawShadow(s);
  s.push();
  s.translate(FEET_X, FEET_Y);
  s.scale(SCALE);
  drawLegs(s);
  drawPole(s);
  drawBody(s);
  drawNeckAndHead(s);
  drawScarf(s);
  drawGrip(s);
  s.pop();
}

function drawLegs(s: Sketch): void {
  s.noFill();
  s.stroke(H.leg);
  s.brush("ink");
  s.gesture({ pressure: "even", wobble: 0.3 });
  s.strokeWeight(4.5);
  const legs: Vec2[][] = [[[-8, -84], [-4, -40], [-10, 0]], [[8, -84], [18, -44], [14, -2]]];
  for (const leg of legs) s.curve(leg);
  // Shade on the back edge of each leg, warm light on the lamp side.
  s.strokeWeight(1.6);
  s.stroke("#6e4e30");
  for (const leg of legs) s.curve(leg.map(([x, y]): Vec2 => [x - 1.6, y]));
  s.stroke("#ffe0a0");
  s.strokeWeight(1.1);
  for (const leg of legs) s.curve(leg.map(([x, y]): Vec2 => [x + 1.5, y]));
  s.stroke(H.leg);
  s.strokeWeight(2.5);
  s.gesture({ pressure: "taper-out" });
  for (const [fx, fy] of [[-10, 0], [14, -2]] as const) {
    s.line(fx, fy, fx + 16, fy + 3);
    s.line(fx, fy, fx - 12, fy + 2);
    s.line(fx, fy, fx + 6, fy + 6);
  }
  s.noBrush();
}

function drawBody(s: Sketch): void {
  litShape(s, BODY, H.body, () => {
    // Brushed feather tone following the body's curve.
    s.noFill();
    s.brush("bristle", { bristles: 10, load: 0.9, flow: 0.45, spread: 0.6 });
    s.gesture({ pressure: "taper", wobble: 1.5 });
    for (let i = 0; i < 7; i += 1) {
      s.stroke(i % 2 === 0 ? "#a4afc6" : "#6f7c9c");
      s.strokeWeight(10);
      s.curve([[40 - i * 4, -160 + i * 3], [10 - i * 6, -150 + i * 9], [-40 - i * 4, -110 + i * 6], [-80, -72 + i]]);
    }
    s.noBrush();
    s.noStroke();
    s.fill(H.belly);
    s.curve([[52, -150], [44, -104], [26, -90], [30, -130], [40, -158]], true);
    // Pencil hatching in the shadow under the belly.
    s.noFill();
    s.stroke("#434b6c");
    s.brush("pencil", { opacity: 0.85 });
    s.gesture({ pressure: "taper", wobble: 0.4 });
    s.strokeWeight(1.8);
    for (let x = -50; x < 40; x += 4) s.line(x, -78, x + 10, -100);
    s.noBrush();
  });
  litShape(s, WING, H.wing, () => {
    s.noFill();
    // A dark band of flight feathers along the lower wing.
    s.stroke(H.wingDark);
    s.brush("wash", { opacity: 0.8 });
    s.gesture({ pressure: "swell", wobble: 1 });
    s.strokeWeight(22);
    s.curve([[20, -100], [-30, -86], [-100, -64]]);
    // Feather edges inside the band.
    s.brush("ink");
    s.gesture({ pressure: "taper", wobble: 0.4 });
    s.stroke("#8e9abb");
    s.strokeWeight(1.3);
    for (let i = 0; i < 5; i += 1) {
      s.curve([[8 - i * 9, -108 + i * 5], [-44 - i * 6, -88 + i * 4], [-98 + i * 3, -66 + i]]);
    }
    s.noBrush();
    // Pale covert feathers in rows across the shoulder, back rows first.
    for (let row = 0; row < 3; row += 1) {
      for (let j = 0; j < 6 - row; j += 1) {
        const cx = 22 - j * 12 - row * 5;
        const cy = -142 + j * 7 + row * 12;
        const f: Vec2[] = [[cx - 8, cy - 8], [cx + 8, cy - 8], [cx + 7, cy + 3], [cx, cy + 9], [cx - 7, cy + 3]];
        s.noStroke();
        s.fill(row === 0 ? "#9aa6c2" : row === 1 ? "#8592b2" : "#7280a2");
        s.curve(f, true);
        s.noFill();
        s.stroke("#2e3552");
        s.brush("ink");
        s.gesture({ pressure: "swell", wobble: 0.3 });
        s.strokeWeight(1.6);
        s.curve([[cx - 7, cy + 2], [cx, cy + 9], [cx + 7, cy + 2]]);
        s.noBrush();
      }
    }
  });
  // Split primary tips at the wing's end.
  s.noStroke();
  s.fill(H.wingDark);
  s.polygon([[-80, -70], [-112, -58], [-86, -64], [-108, -50], [-80, -60], [-98, -44], [-70, -62]]);
  // Cool shadow over the lower body, away from the lamp.
  s.clip(s.curvePath(BODY, true), () => {
    s.noFill();
    s.stroke("#2c3150");
    s.brush("wash", { opacity: 0.45 });
    s.gesture({ pressure: "swell", wobble: 2 });
    s.strokeWeight(26);
    s.curve([[-90, -66], [-40, -76], [20, -80]]);
    s.noBrush();
  });
  s.noFill();
  s.stroke(H.ink);
  // Heavier line on the shadow side (front-lower edge round to the tail), thin toward the lamp.
  s.strokeWeight(3.6);
  s.brush("ink", { thinning: 0.8 });
  s.gesture({ pressure: [[0, 0.3], [0.2, 0.7], [0.45, 1], [0.62, 0.9], [0.8, 0.45], [1, 0.3]], wobble: 0.6 });
  s.curve(BODY, true);
  s.curve(WING, true);
  s.noBrush();
}

function drawNeckAndHead(s: Sketch): void {
  const neck = s.tube(NECK, { width: 19, profile: [[0, 1.4], [1, 0.8]] });
  s.noStroke();
  s.fill(H.rim);
  s.path(neck);
  s.clip(neck, () => {
    s.fill(H.belly);
    s.path(s.tube(NECK.map(([x, y]): Vec2 => [x - 3, y + 1]), { width: 19, profile: [[0, 1.4], [1, 0.8]] }));
    s.fill(H.body);
    s.path(s.tube(NECK.map(([x, y]): Vec2 => [x - 13, y + 1]), { width: 19, profile: [[0, 1.4], [1, 0.8]] }));
    // The dark dashed streak down the front of a heron's neck.
    s.noFill();
    s.stroke("#2b2f48");
    s.brush("ink");
    s.gesture({ pressure: "swell", wobble: 0.3 });
    s.strokeWeight(2);
    const front = NECK.map(([x, y]): Vec2 => [x + 3, y]);
    for (let i = 0; i < front.length - 1; i += 1) {
      const [ax, ay] = front[i] ?? [0, 0];
      const [bx, by] = front[i + 1] ?? [0, 0];
      s.line(ax + (bx - ax) * 0.2, ay + (by - ay) * 0.2, ax + (bx - ax) * 0.65, ay + (by - ay) * 0.65);
    }
    s.noBrush();
  });
  // Head.
  const head: Vec2[] = [
    [HEAD.x + 18, HEAD.y - 1],
    [HEAD.x + 4, HEAD.y - 11],
    [HEAD.x - 14, HEAD.y - 6],
    [HEAD.x - 12, HEAD.y + 8],
    [HEAD.x + 8, HEAD.y + 10],
  ];
  litShape(s, head, H.body, () => {
    s.fill(H.belly);
    s.ellipse(HEAD.x + 6, HEAD.y + 6, 22, 9);
  });
  // Bill.
  s.noStroke();
  s.fill(H.bill);
  s.polygon([
    [HEAD.x + 13, HEAD.y - 5],
    [HEAD.x + 46, HEAD.y + 7],
    [HEAD.x + 12, HEAD.y + 6],
  ]);
  s.fill("#f6d27e");
  s.polygon([
    [HEAD.x + 13, HEAD.y - 5],
    [HEAD.x + 46, HEAD.y + 7],
    [HEAD.x + 13, HEAD.y + 1],
  ]);
  s.noFill();
  s.stroke(H.ink);
  s.brush("ink");
  s.gesture({ pressure: "taper-out", wobble: 0.5 });
  // Black crest stripe and plume.
  s.strokeWeight(5);
  s.curve([[HEAD.x + 8, HEAD.y - 9], [HEAD.x - 10, HEAD.y - 9], [HEAD.x - 30, HEAD.y - 3], [HEAD.x - 46, HEAD.y + 8]]);
  s.strokeWeight(3);
  s.curve([[HEAD.x - 4, HEAD.y - 6], [HEAD.x - 22, HEAD.y + 2], [HEAD.x - 38, HEAD.y + 18]]);
  s.gesture({ pressure: "taper", wobble: 0.5 });
  s.strokeWeight(1.6);
  s.line(HEAD.x + 14, HEAD.y + 1, HEAD.x + 42, HEAD.y + 6);
  s.strokeWeight(2.2);
  s.curve(NECK.map(([x, y]): Vec2 => [x - 9, y]));
  s.curve(head, true);
  s.noBrush();
  // Eye.
  s.noStroke();
  s.fill("#fff2c8");
  s.circle(HEAD.x + 6, HEAD.y - 2, 7);
  s.fill(H.ink);
  s.circle(HEAD.x + 7, HEAD.y - 2, 3.5);
}

function drawScarf(s: Sketch): void {
  // One band: knot at the front of the neck, round the back, out into the wind.
  const band: Vec2[] = [[52, -160], [44, -174], [24, -176], [6, -168], [-14, -158], [-38, -170], [-66, -160]];
  const shape = s.tube(band, { width: 14, profile: [[0, 1.2], [0.3, 1], [1, 0.85]] });
  s.noStroke();
  s.fill(H.scarf);
  s.path(shape);
  s.clip(shape, () => {
    // Knit ribs, and a shadow along the lower edge.
    s.noFill();
    s.stroke(H.scarfDark);
    s.brush("pencil", { opacity: 0.9 });
    s.gesture({ pressure: "even", wobble: 0.3 });
    s.strokeWeight(1.6);
    for (let x = -74; x < 64; x += 4.5) s.line(x, -192, x - 3, -146);
    s.brush("wash", { opacity: 0.6 });
    s.strokeWeight(8);
    s.curve(band.map(([x, y]): Vec2 => [x - 2, y + 7]));
    s.stroke("#ff9a7a");
    s.brush("wash", { opacity: 0.5 });
    s.strokeWeight(5);
    s.curve(band.slice(0, 4).map(([x, y]): Vec2 => [x + 2, y - 5]));
    s.noBrush();
  });
  // Fringe.
  s.noFill();
  s.stroke(H.scarf);
  s.brush("ink");
  s.gesture({ pressure: "taper-out", wobble: 0.6 });
  s.strokeWeight(2.4);
  for (let i = 0; i < 4; i += 1) s.line(-64, -166 + i * 4, -78, -164 + i * 6);
  s.stroke(H.ink);
  s.strokeWeight(1.8);
  s.gesture({ pressure: "taper", wobble: 0.5 });
  s.path(shape);
  s.noBrush();
}

function tip(): Vec2 {
  return [(LAMP.hx - 2 - FEET_X) / SCALE, (LAMP.hy + 48 - FEET_Y) / SCALE];
}

function drawPole(s: Sketch): void {
  const [tx, ty] = tip();
  const dx = tx - GRIP[0];
  const dy = ty - GRIP[1];
  const back: Vec2 = [GRIP[0] - dx * 0.45, GRIP[1] - dy * 0.45];
  s.noFill();
  s.stroke(H.pole);
  s.brush("ink");
  s.gesture({ pressure: "even", wobble: 0.4 });
  s.strokeWeight(3.6);
  s.line(back[0], back[1], tx, ty);
  s.noBrush();
  // Taper flame.
  s.noStroke();
  s.fill(s.radialGradient(tx, ty - 4, 18, [
    [0, "rgba(255,240,180,0.95)"],
    [1, "rgba(255,160,80,0)"],
  ]));
  s.circle(tx, ty - 4, 36);
  s.fill("#fff3c0");
  s.ellipse(tx, ty - 6, 5, 11);
}

function drawGrip(s: Sketch): void {
  // Three primary feathers curled round the pole, like fingers.
  const [gx, gy] = GRIP;
  const feathers: Vec2[][] = [
    [[gx - 30, gy - 6], [gx - 8, gy - 12], [gx + 8, gy - 8], [gx + 6, gy - 2], [gx - 10, gy - 3]],
    [[gx - 30, gy - 1], [gx - 6, gy - 4], [gx + 10, gy + 1], [gx + 6, gy + 6], [gx - 12, gy + 4]],
    [[gx - 28, gy + 4], [gx - 8, gy + 4], [gx + 6, gy + 10], [gx + 1, gy + 14], [gx - 14, gy + 10]],
  ];
  for (const f of feathers) {
    litShape(s, f, H.wing);
    s.noFill();
    s.stroke(H.ink);
    s.brush("ink");
    s.gesture({ pressure: "taper", wobble: 0.3 });
    s.strokeWeight(1.8);
    s.curve(f, true);
    s.noBrush();
  }
}

/** Cast shadow on the deck, thrown back and left by the lamp, and a contact shadow under the feet. */
function drawShadow(s: Sketch): void {
  const deck: Vec2[] = [[180, deckTop(180)], [740, deckTop(740)], [740, deckFront(740)], [180, deckFront(180)]];
  s.noStroke();
  s.clip(deck, () => {
    s.group({ opacity: 0.85, blend: "multiply" }, () => {
      s.fill(s.ellipseGradient(FEET_X - 80, FEET_Y - 5, 210, 24, [
        [0, "#5a3a58"],
        [0.55, "rgba(90,58,88,0.7)"],
        [1, "rgba(90,58,88,0)"],
      ]));
      s.ellipse(FEET_X - 80, FEET_Y - 5, 210, 24);
      s.fill(s.ellipseGradient(FEET_X + 2, FEET_Y + 2, 54, 10, [
        [0, "#3a2236"],
        [1, "rgba(58,34,54,0)"],
      ]));
      s.ellipse(FEET_X + 2, FEET_Y + 2, 54, 10);
    });
  });
}
