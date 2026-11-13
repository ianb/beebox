import type { Style, View } from "@ianbicking/canvas-loop";

const INK = "#35454c";
const TAPER = { pressure: "taper", wobble: 0.65 } as const;

const EDGE: Style = { stroke: INK, weight: 2.5, brush: "ink", gesture: TAPER };
function fillOf(fill: string): Style {
  return { fill };
}

function mark(
  v: View,
  points: [number, number][],
  color: string,
  width = 3,
): void {
  v.curve(points, false, {
    stroke: color,
    weight: width,
    brush: "ink",
    gesture: TAPER,
  });
}

function block(
  v: View,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
): void {
  v.rect(x, y, w, h, fillOf(color));
  v.rect(x, y, w, h, EDGE);
}

function window(v: View, x: number, y: number, color: string): void {
  block(v, x, y, 47, 56, "#f6d497");
  v.rect(x + 6, y + 7, 35, 39, fillOf(color));
  v.rect(x + 9, y + 9, 4, 25, fillOf("#ffffff8a"));
  mark(
    v,
    [
      [x + 23, y + 5],
      [x + 23, y + 48],
    ],
    INK,
    2,
  );
  block(v, x - 4, y + 49, 55, 8, "#efbd7b");
}

export function paintOccupiedWindowTrim(v: View): void {
  for (const x of [105, 219, 425, 539, 747]) {
    v.rect(x, 277, 47, 7, fillOf("#ead0a0"));
    v.rect(x - 4, 283, 55, 3, fillOf("#614e4b"));
    v.rect(x, 228, 3, 49, fillOf("#f7dfb7"));
    v.rect(x + 44, 228, 3, 49, fillOf("#f7dfb7"));
  }
}

function shop(
  v: View,
  x: number,
  w: number,
  color: string,
  name: string,
  awning: string,
): void {
  block(v, x, 185, w, 326, color);
  block(v, x - 7, 170, w + 14, 20, "#f5d5a5");
  for (let i = 0; i < 5; i += 1) {
    const wx = x + 24 + i * ((w - 72) / 4);
    window(v, wx, 228, i % 2 ? "#7ac4bc" : "#94cfc9");
  }
  v.rect(x + 7, 355, w - 14, 66, fillOf("#fdf0d5"));
  v.rect(x + 6, 416, w - 12, 22, fillOf(awning));
  for (let i = 0; i < 8; i += 1) {
    v.rect(
      x + 8 + i * ((w - 16) / 8),
      438,
      (w - 16) / 8,
      32,
      fillOf(i % 2 ? "#fff2d1" : awning),
    );
  }
  block(v, x + 20, 476, 64, 35, "#eed5a7");
  v.text(
    name,
    { x: x + w / 2, y: 399 },
    {
      size: 20,
      font: "Georgia",
      style: "bold",
      fill: INK,
      align: "center",
      valign: "baseline",
    },
  );
}

function stars(v: View, dusk: boolean): void {
  if (!dusk) return;
  for (let i = 0; i < 18; i += 1)
    v.circle(18 + i * 53, 33 + ((i * 43) % 95), (2 + (i % 3)) / 2, fillOf("#f8e8bc"));
}

export function paintTown(v: View, dusk: boolean): void {
  v.paper({ scale: 3, contrast: 0.7, seed: 21 });
  v.background(dusk ? "#506984" : "#b8e1d8");
  stars(v, dusk);
  v.circle(846, 83, 40, fillOf(dusk ? "#f7e2a8" : "#fff0b8"));
  for (let i = 0; i < 8; i += 1)
    v.ellipse(
      i * 147 - 30,
      140 + (i % 2) * 13,
      82.5,
      28.5,
      fillOf(dusk ? "#7295a2" : "#eaf3d7"),
    );
  // Rooflines are staggered so the page reads as a street rather than a grid.
  shop(v, 24, 300, "#e9a77e", "BUN & BELL", "#bf6a62");
  shop(v, 344, 302, "#f4cc86", "POST & PARCEL", "#6d9e9d");
  shop(v, 665, 309, "#a9c6aa", "ODD & ENDS", "#e89d71");
  v.triangle(12, 170, 174, 86, 335, 170, fillOf("#865e5a"));
  v.triangle(333, 170, 495, 100, 656, 170, fillOf("#557b82"));
  v.triangle(654, 170, 815, 79, 985, 170, fillOf("#6e8f77"));
  for (let x = 55; x < 970; x += 28)
    mark(
      v,
      [
        [x, 171],
        [x + 15, 163],
      ],
      "#fbe7bb",
      2,
    );
  for (let roof = 0; roof < 3; roof += 1) {
    const left = roof * 322 + 24;
    for (let row = 0; row < 3; row += 1)
      for (let i = 0; i < 8 - row; i += 1) {
        const x = left + 21 + i * 35 + row * 17,
          y = 151 - row * 17;
        mark(
          v,
          [
            [x, y],
            [x + 18, y - 4],
          ],
          "#f1d4ad8c",
          1.5,
        );
      }
  }
  block(v, 72, 104, 34, 44, "#a26b61");
  block(v, 718, 100, 33, 43, "#789b81");
  for (let i = 0; i < 3; i += 1)
    v.arc(90 + i * 7, 81 - i * 15, 18, 0, Math.PI, {
      stroke: "#f8e5be",
      weight: 3,
      brush: "ink",
      gesture: TAPER,
    });
  // Shop displays, doors, and tiny objects make the static plate worth searching.
  for (const x of [39, 358, 681]) {
    block(v, x + 3, 476, 118, 52, "#e8f2dc");
    for (let i = 0; i < 4; i += 1)
      v.ellipse(x + 20 + i * 26, 503, 9.5, 6, fillOf("#d38869"));
  }
  // Tiny notices, parcels, bread and a signpost break up the long façade.
  for (const [x, y] of [
    [288, 306],
    [610, 306],
    [936, 306],
  ] as const) {
    block(v, x, y, 25, 31, "#f9e7c4");
    mark(
      v,
      [
        [x + 5, y + 10],
        [x + 18, y + 10],
      ],
      "#9b7e6d",
      1.4,
    );
    mark(
      v,
      [
        [x + 5, y + 18],
        [x + 15, y + 18],
      ],
      "#9b7e6d",
      1.4,
    );
  }
  // Three distinct windows at pavement level: pastries, mail, and curios.
  for (let i = 0; i < 5; i += 1) {
    v.ellipse(
      56 + i * 30,
      490 + (i % 2) * 6,
      12,
      6.5,
      fillOf(i % 2 ? "#e5ad74" : "#b66c55"),
    );
    v.circle(61 + i * 30, 487 + (i % 2) * 6, 1.5, fillOf("#f6dda4"));
  }
  for (let i = 0; i < 4; i += 1) {
    block(v, 376 + i * 32, 482 - (i % 2) * 7, 22, 23, "#d2a479");
    mark(
      v,
      [
        [380 + i * 32, 487 - (i % 2) * 7],
        [392 + i * 32, 499 - (i % 2) * 7],
      ],
      "#9e765f",
      1.5,
    );
  }
  for (let i = 0; i < 5; i += 1) {
    v.circle(
      702 + i * 34,
      492 + (i % 2) * 7,
      7,
      fillOf(["#f0d18a", "#90b4b0", "#d78b73"][i % 3] ?? "#f0d18a"),
    );
    v.circle(702 + i * 34, 492 + (i % 2) * 7, 2, fillOf("#4d6567"));
  }
  for (let i = 0; i < 3; i += 1) {
    block(v, 480 + i * 22, 507 - i * 7, 20, 16, "#c9956e");
  }
  block(v, 97, 487, 24, 19, "#e7ad76");
  v.circle(107, 489, 2.5, fillOf("#8c614d"));
  mark(
    v,
    [
      [834, 533],
      [834, 468],
    ],
    "#4d6564",
    4,
  );
  block(v, 810, 452, 53, 20, "#f3d69e");
  v.text(
    "BUS STOP",
    { x: 836, y: 466 },
    {
      size: 10,
      font: "Georgia",
      fill: "#475d5c",
      align: "center",
      valign: "baseline",
    },
  );
  block(v, 233, 472, 74, 69, "#765c59");
  block(v, 561, 472, 68, 69, "#668d8b");
  block(v, 878, 472, 76, 69, "#789272");
  for (const x of [290, 611, 936])
    v.circle(x, 505, 2.5, { ...EDGE, fill: "#f6dfa8" }); // the last block left its inked outline current
  block(v, 0, 537, 1000, 43, "#ead6ab");
  v.rect(0, 580, 1000, 120, fillOf("#7eaaac"));
  mark(
    v,
    [
      [0, 584],
      [250, 581],
      [550, 584],
      [1000, 581],
    ],
    "#e8f2d2",
    4,
  );
  for (let i = 0; i < 14; i += 1) {
    v.rect(i * 79 + 7, 634, 41, 5, fillOf("#f1e7ba"));
  }
  // Lamp posts and planters frame little vignettes.
  for (const x of [17, 329, 650, 980]) {
    mark(
      v,
      [
        [x, 561],
        [x, 401],
      ],
      "#45575a",
      6,
    );
    if (dusk)
      v.ellipse(x, 398, 52, 52, {
        fill: v.ellipseGradient(x, 398, 52, 52, [
          [0, "#ffe6a4b3"],
          [1, "#ffe6a400"],
        ]),
        blend: "screen",
      });
    v.circle(x, 395, 8.5, fillOf("#f4d994"));
    v.rect(x - 12, 383, 24, 4, fillOf("#50615d"));
  }
  for (const x of [122, 432, 757, 964]) {
    block(v, x, 531, 32, 30, "#be896a");
    for (let i = 0; i < 5; i += 1)
      v.circle(x + 4 + i * 6, 526 - (i % 2) * 8, 7, fillOf("#6d9b74"));
    v.circle(x + 8, 516, 2.5, fillOf("#f8c8a2"));
    v.circle(x + 25, 519, 2.5, fillOf("#f8c8a2"));
  }
  v.paperTexture(0.28);
}
