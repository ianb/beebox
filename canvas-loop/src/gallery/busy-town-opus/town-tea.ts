// The still town: sky, buildings, sidewalk, road. Painted once into a cache.
import type { Style, Vec2, View } from "@ianbicking/canvas-loop";
import { INK, ellipsePts, hash, ink, inked, label } from "./paint-tea.js";
import { CURB, H, ROAD_END, STREET, W } from "./things-tea.js";

function sky(v: View): void {
  v.rect(0, 0, W, STREET, {
    fill: v.linearGradient(0, 0, 0, STREET, [
      [0, "#8ec9ec"],
      [0.6, "#cfe9f4"],
      [1, "#f3f0dc"],
    ]),
  });
  // clouds: soft wash puffs
  const cloud: Style = {
    stroke: "rgba(255,255,255,0.85)",
    brush: { preset: "wash", opacity: 0.8 },
    gesture: { pressure: "swell", wobble: 3, faint: true },
  };
  for (const [x, y, w] of [
    [120, 70, 140],
    [430, 50, 110],
    [690, 90, 160],
    [300, 140, 80],
  ] as const) {
    v.line(x, y, x + w, y + 4, { ...cloud, weight: 34 });
    v.line(x + w * 0.2, y - 16, x + w * 0.7, y - 14, { ...cloud, weight: 26 });
  }
  // distant hills and rooftops
  v.curve(
    [
      [-20, 330],
      [150, 270],
      [330, 300],
      [520, 250],
      [760, 290],
      [1020, 240],
      [1020, 560],
      [-20, 560],
    ],
    true,
    { fill: "#a9cf9a" },
  );
  for (let i = 0; i < 14; i += 1) {
    const x = i * 75 + hash(i) * 30;
    const h = 60 + hash(i + 9) * 70;
    v.rect(x, 330 - h, 46, h + 220, { fill: "#b9b3d4" });
    v.triangle(x - 4, 330 - h, x + 50, 330 - h, x + 23, 300 - h, {
      fill: "#b9b3d4",
    });
  }
  v.rect(0, 150, W, 400, {
    fill: v.linearGradient(0, 150, 0, 330, [
      [0, "rgba(255,255,255,0)"],
      [1, "rgba(255,255,255,0.45)"],
    ]),
  });
}

function win(
  v: View,
  x: number,
  y: number,
  w: number,
  h: number,
  curtain = "#e9d6f0",
): void {
  v.rect(x, y, w, h, inked("#cfe7f2", 2.2));
  v.triangle(x + 2, y + 2, x + w * 0.35, y + 2, x + 2, y + h * 0.7, {
    fill: curtain,
  });
  v.triangle(x + w - 2, y + 2, x + w * 0.65, y + 2, x + w - 2, y + h * 0.7, {
    fill: curtain,
  });
  v.line(x + w / 2, y, x + w / 2, y + h, ink(1.6));
  v.line(x, y + h / 2, x + w, y + h / 2, ink(1.6));
  v.rect(x - 4, y + h, w + 8, 5, inked("#ffffff", 1.6));
}

function facade(
  v: View,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
): void {
  v.rect(x, y, w, h, inked(color, 2.6));
  // shade the right side and under the eaves with wash
  v.clip(
    [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
    ],
    () => {
      const wash: Style = {
        stroke: "rgba(70,40,60,0.45)",
        brush: { preset: "wash", opacity: 0.6 },
        gesture: { pressure: "even", wobble: 2 },
      };
      v.line(x + w - 4, y, x + w - 4, y + h, { ...wash, weight: 26 });
      v.line(x, y + 6, x + w, y + 6, { ...wash, weight: 30 });
    },
  );
}

function bricks(
  v: View,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  seed: number,
): void {
  for (let i = 0; i < Math.floor((w * h) / 2400); i += 1) {
    const bx = x + hash(seed + i) * (w - 24);
    const by = y + hash(seed + i * 3 + 1) * (h - 10);
    v.rect(bx, by, 18, 8, {
      stroke: color,
      weight: 2.6,
      brush: { preset: "pencil", opacity: 0.85 },
      gesture: { pressure: "even", seed: seed + i },
    });
  }
}

/** Pencil lines across a wall: clapboards (horizontal) or boards (vertical). */
function boards(
  v: View,
  x: number,
  y: number,
  w: number,
  h: number,
  o: { color: string; gap: number; vertical: boolean },
): void {
  const pencil: Style = {
    stroke: o.color,
    weight: 2.4,
    brush: { preset: "pencil", opacity: 0.85 },
    gesture: { pressure: "taper", wobble: 0.8 },
  };
  if (o.vertical) {
    for (let bx = x + o.gap; bx < x + w - 4; bx += o.gap)
      v.line(bx, y + 4, bx + 1, y + h - 2, pencil);
  } else {
    for (let by = y + o.gap; by < y + h - 4; by += o.gap)
      v.line(x + 3, by, x + w - 3, by + 1, pencil);
  }
}

function awning(
  v: View,
  x: number,
  y: number,
  w: number,
  a: string,
  b: string,
): void {
  const n = Math.round(w / 20);
  const sw = w / n;
  for (let i = 0; i < n; i += 1) {
    const stripe = { fill: i % 2 === 0 ? a : b };
    v.polygon(
      [
        [x + i * sw, y],
        [x + (i + 1) * sw, y],
        [x + (i + 1) * sw + 4, y + 26],
        [x + i * sw + 4, y + 26],
      ],
      stripe,
    );
    v.circle(x + i * sw + sw / 2 + 4, y + 26, sw, stripe);
  }
  v.line(x, y, x + w, y, ink(2.2));
  v.line(x, y, x + 4, y + 26, ink(2.2));
  v.line(x + w, y, x + w + 4, y + 26, ink(2.2));
}

function signBoard(
  v: View,
  cx: number,
  y: number,
  w: number,
  text: string,
  color: string,
): void {
  v.rect(cx - w / 2, y, w, 24, inked(color, 2.2));
  label(v, text, cx, y + 13, 15, "#fffaf0");
}

function door(v: View, x: number, y: number, w: number, color: string): void {
  v.path(
    [
      ["move", x, STREET],
      ["line", x, y + w / 2],
      ["quad", x + w / 2, y - 6, x + w, y + w / 2],
      ["line", x + w, STREET],
      ["close"],
    ],
    inked(color, 2.4),
  );
  v.circle(x + w - 9, y + 50, 6, { fill: "#f2c84b" });
  v.rect(x + 8, y + 18, w - 16, 22, inked("#d6eef7", 1.4));
}

function bakery(v: View): void {
  facade(v, 20, 255, 212, STREET - 255, "#f2c6a0");
  bricks(v, 24, 262, 204, 120, "#c98e6a", 10);
  v.polygon(
    [
      [10, 262],
      [242, 262],
      [222, 222],
      [30, 222],
    ],
    inked("#b54a3a", 2.6),
  );
  v.clip(
    [
      [10, 262],
      [242, 262],
      [222, 222],
      [30, 222],
    ],
    () => {
      const stripe: Style = {
        stroke: "#8e3328",
        weight: 14,
        brush: { preset: "bristle", load: 0.5 },
        gesture: { pressure: "press", wobble: 1.5 },
      };
      for (let i = 0; i < 4; i += 1)
        v.line(24 + i * 6, 230 + i * 9, 228 - i * 4, 232 + i * 9, stripe);
    },
  );
  win(v, 150, 290, 56, 60);
  signBoard(v, 162, 380, 104, "BAKERY", "#8a4b2e");
  // shop window with loaves
  v.rect(30, 455, 106, 74, inked("#fff1d6", 2.4));
  for (let i = 0; i < 5; i += 1) {
    v.curve(
      ellipsePts(46 + i * 19, 515 - (i % 2) * 22, 9, 6, 8),
      true,
      inked("#d58b42", 1.4),
    );
  }
  label(v, "fresh!", 83, 470, 11, "#b54a3a");
  door(v, 152, 452, 50, "#8a4b2e");
  awning(v, 22, 412, 208, "#d8443a", "#fff6ea");
}

function postOffice(v: View): void {
  facade(v, 242, 300, 170, STREET - 300, "#b9d4e6");
  boards(v, 242, 300, 170, STREET - 300, {
    color: "#7597b4",
    gap: 13,
    vertical: false,
  });
  v.rect(236, 290, 182, 14, inked("#7d9bb8", 2.2));
  win(v, 262, 324, 52, 56);
  win(v, 340, 324, 52, 56);
  signBoard(v, 327, 398, 150, "POST OFFICE", "#2f5d8a");
  v.rect(252, 440, 66, 70, inked("#fff7e6", 2.2));
  for (const [x, y, c] of [
    [258, 480, "#c99a63"],
    [282, 486, "#d8b27e"],
    [270, 462, "#c99a63"],
  ] as const) {
    v.rect(x, y, 26, 22, inked(c, 1.4));
    v.line(x + 13, y, x + 13, y + 22, ink(1));
  }
  door(v, 330, 446, 48, "#2f5d8a");
}

function paintersHouse(v: View): void {
  // left half freshly painted, right half old and peeling
  facade(v, 420, 216, 186, STREET - 216, "#a9a2b3");
  v.rect(422, 218, 100, STREET - 220, { fill: "#f7d65c" });
  const swipe: Style = {
    stroke: "#f7d65c",
    weight: 22,
    brush: { preset: "bristle", load: 0.6 },
    gesture: { pressure: "press", wobble: 2 },
  };
  for (let i = 0; i < 9; i += 1)
    v.line(520, 230 + i * 34, 534 + hash(i) * 14, 238 + i * 34, swipe);
  for (let i = 0; i < 6; i += 1)
    v.ellipse(548 + hash(i + 40) * 50, 260 + hash(i + 50) * 250, 14, 9, {
      fill: "#d9d2df",
    });
  v.rect(414, 206, 198, 14, inked("#6c6578", 2.2));
  for (const row of [0, 1, 2]) {
    for (const col of [1, 2])
      win(
        v,
        440 + col * 55,
        244 + row * 80,
        42,
        52,
        row === 1 ? "#f6c3c9" : "#e9d6f0",
      );
  }
  win(v, 446, 324, 42, 52, "#c9e7c3");
  door(v, 440, 468, 46, "#3f7a5a");
  // wet paint sign on the sidewalk
  v.rect(492, 500, 40, 24, inked("#ffffff", 1.6));
  label(v, "WET", 512, 507, 9, "#c23b3b");
  label(v, "PAINT", 512, 517, 9, "#c23b3b");
  v.line(500, 524, 496, 548, ink(1.8));
  v.line(524, 524, 528, 548, ink(1.8));
}

function grocer(v: View): void {
  facade(v, 612, 300, 182, STREET - 300, "#cfe3b4");
  boards(v, 612, 300, 182, STREET - 300, {
    color: "#8cae72",
    gap: 17,
    vertical: true,
  });
  v.rect(606, 290, 194, 14, inked("#8fb27a", 2.2));
  win(v, 636, 322, 54, 56, "#fbe1a6");
  win(v, 718, 322, 54, 56, "#fbe1a6");
  signBoard(v, 703, 392, 160, "FRUIT & VEG", "#3f7a3a");
  v.rect(624, 466, 80, 64, inked("#fff7e6", 2.2));
  door(v, 724, 462, 50, "#3f7a3a");
  awning(v, 614, 422, 180, "#3f9a4a", "#fffbe8");
}

function fruitStand(v: View): void {
  for (const [x, c] of [
    [630, "#d8443a"],
    [672, "#f29a2e"],
  ] as const) {
    v.rect(x, 528, 40, 34, inked("#b98a56", 2));
    for (let i = 0; i < 6; i += 1)
      v.circle(
        x + 8 + (i % 3) * 12,
        524 + Math.floor(i / 3) * 8,
        11,
        inked(c, 1.2),
      );
  }
  v.rect(642, 548, 50, 14, inked("#fffaf0", 1.4));
  label(v, "APPLES 5¢", 667, 555, 8);
}

function townHall(v: View): void {
  facade(v, 800, 336, 194, STREET - 336, "#eadcc4");
  bricks(v, 804, 380, 186, 150, "#c4ad86", 60);
  // tower
  facade(v, 864, 150, 72, 190, "#e3d2b4");
  bricks(v, 866, 236, 68, 96, "#c4ad86", 90);
  v.polygon(
    [
      [856, 152],
      [944, 152],
      [900, 98],
    ],
    inked("#5a6f9a", 2.4),
  );
  v.rect(794, 330, 206, 14, inked("#c9b48e", 2.2));
  v.circle(900, 200, 56, inked("#fffdf4", 2.6));
  for (let i = 0; i < 12; i += 1) {
    const a = (i / 12) * Math.PI * 2;
    v.circle(
      900 + Math.cos(a) * 22,
      200 + Math.sin(a) * 22,
      i % 3 === 0 ? 4 : 2,
      { fill: INK },
    );
  }
  v.line(900, 98, 900, 40, ink(2.6));
  signBoard(v, 897, 352, 120, "TOWN HALL", "#7a5a3a");
  for (const x of [818, 948]) win(v, x, 392, 34, 52);
  for (const x of [846, 940]) v.rect(x, 392, 12, 148, inked("#f6efe0", 1.8));
  door(v, 876, 456, 48, "#7a4a3a");
  v.rect(864, 530, 72, 10, inked("#d6c7a8", 1.6));
  // bus stop and bench
  v.line(846, 470, 846, 568, ink(3));
  v.circle(846, 466, 34, inked("#d8443a", 2));
  label(v, "BUS", 846, 462, 10, "#ffffff");
  label(v, "stop", 846, 472, 8, "#ffffff");
  v.rect(880, 540, 96, 8, inked("#8a5a3a", 1.8));
  v.rect(880, 512, 96, 8, inked("#8a5a3a", 1.8));
  v.rect(886, 548, 4, 18, { fill: INK });
  v.rect(966, 548, 4, 18, { fill: INK });
}

function street(v: View): void {
  // sidewalk
  v.rect(-4, STREET, W + 8, CURB - STREET, inked("#e2d6c0", 2));
  for (let x = 40; x < W; x += 80) v.line(x, STREET, x - 14, CURB, ink(1.2));
  v.rect(0, CURB - 6, W, 8, { fill: "#b9ab94" });
  // the shops' shadow along the back of the sidewalk
  v.line(-10, STREET + 6, W + 10, STREET + 6, {
    stroke: "rgba(90,70,80,0.5)",
    weight: 16,
    brush: { preset: "wash", opacity: 0.55 },
    gesture: { pressure: "even", wobble: 2 },
  });
  // road
  v.rect(0, CURB + 2, W, ROAD_END - CURB - 2, { fill: "#6d6c78" });
  const chalk: Style = {
    stroke: "rgba(255,255,255,0.4)",
    weight: 14,
    brush: { preset: "chalk", opacity: 0.6 },
    gesture: { pressure: "even", wobble: 1 },
  };
  for (let i = 0; i < 10; i += 1)
    v.line(
      hash(i + 70) * W,
      620 + i * 9,
      hash(i + 80) * W + 160,
      622 + i * 9,
      chalk,
    );
  for (let x = 10; x < W; x += 70) v.rect(x, 654, 36, 5, { fill: "#f6efe0" });
  // crosswalk
  for (let i = 0; i < 5; i += 1)
    v.rect(436 + i * 22, 610, 13, 96, { fill: "#f6efe0" });
  // verge
  v.rect(0, ROAD_END, W, H - ROAD_END, { fill: "#8fc278" });
  const grass: Style = {
    stroke: "#6fa85a",
    weight: 16,
    brush: { preset: "bristle", load: 0.7 },
    gesture: { pressure: "taper", wobble: 2 },
  };
  for (let i = 0; i < 7; i += 1)
    v.line(
      i * 150 - 20,
      728 + (i % 2) * 10,
      i * 150 + 120,
      726 + (i % 3) * 8,
      grass,
    );
  v.rect(-4, ROAD_END - 2, W + 8, 7, inked("#b9ab94", 1.6));
  for (let i = 0; i < 40; i += 1) {
    const x = hash(i + 100) * W;
    const y = ROAD_END + 14 + hash(i + 200) * 26;
    v.circle(x, y, 5, {
      fill: ["#ffffff", "#f2c84b", "#e88aa8"][i % 3] ?? "#ffffff",
    });
  }
  // street sign
  v.line(130, 742, 130, 702, ink(3));
  v.rect(92, 690, 76, 16, inked("#3f7a3a", 1.6));
  label(v, "ACORN LANE", 130, 698, 9, "#ffffff");
  // snail crossing joke sign
  v.line(26, 598, 26, 556, ink(2.4));
  v.polygon(
    [
      [26, 532],
      [44, 550],
      [26, 568],
      [8, 550],
    ],
    inked("#f2c84b", 1.6),
  );
  label(v, "SNAIL", 26, 546, 6.5);
  label(v, "X-ING", 26, 555, 6.5);
}

/** Little things to find: a mouse hole, a lost sock, a nest, a fishbowl, a pot plant. */
function jokes(v: View): void {
  // mouse hole in the bakery wall, with a mouse eyeing a crumb
  v.path(
    [
      ["move", 140, STREET],
      ["line", 140, 532],
      ["quad", 147, 522, 154, 532],
      ["line", 154, STREET],
      ["close"],
    ],
    { fill: "#2a1f1c" },
  );
  v.ellipse(148, 535, 10, 8, inked("#b9b3c4", 1.2));
  v.circle(145, 530, 5, inked("#b9b3c4", 1));
  v.circle(150, 534, 1.6, { fill: INK });
  v.circle(164, 538, 4, { fill: "#d58b42" });
  // LOST SOCK poster on the painter's house, and the sock itself up on the town hall
  v.rect(552, 452, 44, 40, inked("#fffaf0", 1.4));
  label(v, "LOST:", 574, 461, 8, "#c23b3b");
  label(v, "one red", 574, 472, 7);
  label(v, "sock", 574, 482, 7);
  v.path(
    [
      ["move", 884, 336],
      ["line", 884, 322],
      ["line", 892, 322],
      ["line", 892, 332],
      ["line", 900, 336],
      ["line", 898, 342],
      ["line", 884, 342],
      ["close"],
    ],
    inked("#d8443a", 1.2),
  );
  // a nest in the bakery gutter
  v.curve(ellipsePts(46, 222, 16, 6, 8), true, inked("#9a6a3a", 1.4));
  v.ellipse(40, 217, 6, 8, { fill: "#bfe2ee" });
  v.ellipse(48, 216, 6, 8, { fill: "#bfe2ee" });
  // fishbowl in the post office window, pot plant at the grocer's
  v.circle(366, 372, 26, inked("rgba(190,226,240,0.9)", 1.4));
  v.ellipse(368, 374, 10, 6, { fill: "#f29a2e" });
  v.polygon(
    [
      [734, 366],
      [756, 366],
      [752, 380],
      [738, 380],
    ],
    inked("#c97a4a", 1.4),
  );
  v.ellipse(740, 358, 9, 16, { fill: "#3f9a4a" });
  v.ellipse(750, 356, 9, 18, { fill: "#3f9a4a" });
  v.ellipse(745, 352, 8, 18, { fill: "#3f9a4a" });
  // a puddle by the curb
  v.ellipse(760, 706, 70, 10, { fill: "rgba(160,190,220,0.7)" });
}

/** The whole still town, for `v.cache`. */
export function paintTown(v: View): void {
  sky(v);
  bakery(v);
  postOffice(v);
  paintersHouse(v);
  grocer(v);
  townHall(v);
  street(v);
  fruitStand(v);
  jokes(v);
  v.paperTexture(0.35);
}

/** Window centres that light up after dark (the goat's window lights only when its shutters are open). */
export const LIT_WINDOWS: readonly Vec2[] = [
  [178, 320],
  [83, 492],
  [288, 352],
  [366, 352],
  [285, 475],
  [516, 270],
  [571, 270],
  [467, 350],
  [516, 350],
  [571, 430],
  [663, 350],
  [745, 350],
  [664, 498],
  [835, 418],
  [965, 418],
  [900, 200],
];

/** Moon and stars, for a screen-blended cache at night. */
export function paintNightSky(v: View): void {
  // screen-blended inside the cache too, so stars overlapping the moon add up as they did
  for (let i = 0; i < 40; i += 1)
    v.circle(hash(i + 300) * W, hash(i + 400) * 180, 1.5 + hash(i + 500) * 2, {
      fill: "rgba(255,255,230,0.9)",
      blend: "screen",
    });
  v.circle(120, 70, 50, { fill: "#fff6d0", blend: "screen" });
}
