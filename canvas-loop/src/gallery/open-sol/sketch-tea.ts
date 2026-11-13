import type { BrushName, Gesture, View, Vec2 } from "@ianbicking/canvas-loop";

const P = (points: number[][]): Vec2[] =>
  points.map((point) => [point[0] ?? 0, point[1] ?? 0]);

function blob(v: View, points: number[][], color: string): void {
  v.curve(P(points), true, { fill: color });
}

const MARK_GESTURE: Gesture = { pressure: "taper", wobble: 0.5 };

function mark(
  v: View,
  points: number[][],
  color: string,
  width: number,
  brush: BrushName = "ink",
): void {
  v.curve(P(points), false, {
    stroke: color,
    weight: width,
    brush,
    gesture: MARK_GESTURE,
  });
}

function glint(v: View, x: number, y: number, r: number): void {
  v.circle(x, y, r / 2, { fill: "#ffdb91" });
  mark(
    v,
    [
      [x - r * 1.3, y],
      [x + r * 1.3, y],
    ],
    "#ffe8b4",
    1.4,
  );
  mark(
    v,
    [
      [x, y - r * 1.3],
      [x, y + r * 1.3],
    ],
    "#ffe8b4",
    1.4,
  );
}

export const canvas = { width: 760, height: 760 };

export function init(): Record<string, never> {
  return {};
}

export function update(model: Record<string, never>): Record<string, never> {
  return model;
}

export function draw(v: View): void {
  v.paper({ scale: 3.2, contrast: 0.68, seed: 11 });
  v.background(
    v.linearGradient(0, 0, 0, 760, [
      [0, "#182d47"],
      [0.38, "#496b78"],
      [0.62, "#b38c76"],
      [1, "#233f58"],
    ]),
  );

  // A gap in the storm over the library.
  v.ellipse(388, 250, 275, 230, {
    fill: v.ellipseGradient(388, 250, 275, 230, [
      [0, "#deb5909c"],
      [1, "#deb59000"],
    ]),
  });
  v.circle(590, 117, 27.5, { fill: "#f8dfae" });
  v.circle(590, 117, 26, { fill: "#f1d8a9" });

  // Rain clouds, broken into broad painted bands.
  for (let i = 0; i < 11; i += 1) {
    const y = 47 + i * 18;
    mark(
      v,
      [
        [-30, y + 16],
        [105, y - 7],
        [270, y + 7],
        [430, y - 14],
        [780, y + 5],
      ],
      i % 2 ? "#72939865" : "#102f4c57",
      23,
      "wash",
    );
  }
  for (let i = 0; i < 25; i += 1) {
    const x = 18 + ((i * 101) % 735);
    const y = 35 + ((i * 71) % 270);
    if (i % 4 === 0) glint(v, x, y, 1.8);
  }

  // Flooded village on the far bank.
  blob(
    v,
    [
      [0, 330],
      [80, 304],
      [159, 318],
      [230, 299],
      [330, 312],
      [460, 295],
      [570, 317],
      [680, 300],
      [760, 318],
      [760, 445],
      [0, 445],
    ],
    "#355664",
  );
  const houses: [number, number, number][] = [
    [43, 339, 62],
    [162, 344, 48],
    [583, 330, 59],
    [690, 345, 51],
  ];
  for (const [x, y, w] of houses) {
    blob(
      v,
      [
        [x - 8, y + 8],
        [x + w / 2, y - 26],
        [x + w + 8, y + 8],
      ],
      "#213d51",
    );
    v.rect(x, y, w, 75, { fill: "#294658" });
    v.rect(x + w * 0.43, y + 20, 11, 13, { fill: "#ddaa78" });
    mark(
      v,
      [
        [x - 8, y + 8],
        [x + w / 2, y - 26],
        [x + w + 8, y + 8],
      ],
      "#173248",
      2.3,
    );
  }
  const trees: [number, number, number][] = [
    [-8, 294, 30],
    [124, 269, 34],
    [265, 281, 27],
    [451, 280, 37],
    [541, 274, 30],
    [773, 282, 37],
  ];
  for (const [x, top, spread] of trees) {
    mark(
      v,
      [
        [x, 405],
        [x - 5, 354],
        [x + 4, top + 17],
      ],
      "#243f4e",
      4.5,
      "ink",
    );
    blob(
      v,
      [
        [x - spread, 356],
        [x - spread - 4, top + 42],
        [x - 9, top + 4],
        [x + 7, top],
        [x + spread, top + 38],
        [x + spread - 8, 356],
      ],
      "#315561",
    );
    mark(
      v,
      [
        [x - 18, top + 50],
        [x - 5, top + 37],
        [x + 14, top + 47],
      ],
      "#64827988",
      4,
      "bristle",
    );
  }
  mark(
    v,
    [
      [0, 407],
      [140, 402],
      [263, 410],
      [384, 399],
      [557, 407],
      [760, 403],
    ],
    "#b5a58a66",
    3.2,
    "bristle",
  );

  // Quiet water behind the principal subject.
  v.rect(0, 410, 760, 350, {
    fill: v.linearGradient(0, 410, 0, 760, [
      [0, "#536c71"],
      [0.48, "#284e62"],
      [1, "#172e49"],
    ]),
  });
  for (let row = 0; row < 21; row += 1) {
    const y = 425 + row * 16;
    const width = 32 + row * 2;
    for (let col = 0; col < 9; col += 1) {
      const x = ((col * 103 + row * 43) % 825) - 35;
      mark(
        v,
        [
          [x, y],
          [x + width * 0.5, y - 2],
          [x + width, y],
        ],
        row % 3 === 0 ? "#dcb28a56" : "#8eb2aa55",
        row % 3 === 0 ? 3.6 : 2.3,
        "bristle",
      );
    }
  }

  // The turtle's feet sit deep in the flood; the neck leads the eye right.
  blob(
    v,
    [
      [214, 567],
      [158, 577],
      [128, 609],
      [139, 644],
      [222, 650],
      [274, 620],
    ],
    "#254c4d",
  );
  blob(
    v,
    [
      [494, 573],
      [523, 600],
      [570, 612],
      [597, 642],
      [562, 659],
      [493, 646],
      [458, 617],
    ],
    "#20494b",
  );
  blob(
    v,
    [
      [174, 516],
      [202, 471],
      [319, 441],
      [464, 454],
      [529, 502],
      [519, 567],
      [444, 617],
      [284, 632],
      [193, 585],
    ],
    "#305b57",
  );
  blob(
    v,
    [
      [489, 495],
      [537, 477],
      [590, 492],
      [631, 481],
      [668, 508],
      [674, 542],
      [646, 562],
      [602, 557],
      [565, 538],
      [507, 545],
    ],
    "#3b6b61",
  );
  blob(
    v,
    [
      [618, 542],
      [637, 559],
      [661, 559],
      [653, 569],
      [621, 561],
    ],
    "#31574e",
  );
  mark(
    v,
    [
      [583, 501],
      [636, 492],
      [661, 508],
    ],
    "#a9b781",
    10,
    "wash",
  );
  v.ellipse(629, 511, 3.5, 4.5, { fill: "#142f37" });
  v.circle(630, 509, 1.2, { fill: "#f6d69c" });
  v.circle(663, 527, 1.1, { fill: "#36574d" });
  mark(
    v,
    [
      [614, 500],
      [627, 497],
      [638, 503],
    ],
    "#264c49",
    3.1,
  );
  mark(
    v,
    [
      [637, 539],
      [649, 544],
      [661, 540],
    ],
    "#183a3b",
    2.4,
  );
  mark(
    v,
    [
      [550, 532],
      [567, 547],
      [587, 553],
    ],
    "#204044",
    2.3,
  );
  mark(
    v,
    [
      [536, 510],
      [559, 493],
      [589, 487],
    ],
    "#91a97c",
    8,
    "bristle",
  );
  mark(
    v,
    [
      [182, 552],
      [210, 570],
      [242, 575],
    ],
    "#749578",
    8,
    "bristle",
  );
  mark(
    v,
    [
      [147, 610],
      [169, 605],
      [191, 608],
    ],
    "#83a17c",
    6,
    "bristle",
  );
  mark(
    v,
    [
      [517, 617],
      [546, 627],
      [570, 635],
    ],
    "#75957a",
    6,
    "bristle",
  );

  // Broad shell: the little library is built into its painted dome.
  const shell = [
    [205, 507],
    [237, 416],
    [325, 373],
    [420, 390],
    [492, 451],
    [522, 536],
    [474, 588],
    [355, 605],
    [244, 574],
  ];
  blob(v, shell, "#704f49");
  v.clip(v.curvePath(P(shell), true), () => {
    for (let i = 0; i < 23; i += 1) {
      const y = 392 + i * 9;
      mark(
        v,
        [
          [211, y + 38],
          [281, y + 11],
          [374, y + 23],
          [487, y + 65],
        ],
        i % 3 === 0 ? "#d2916866" : "#3b544e88",
        15,
        "bristle",
      );
    }
    mark(
      v,
      [
        [250, 446],
        [316, 412],
        [398, 422],
        [466, 468],
      ],
      "#e5b78366",
      28,
      "wash",
    );
    for (let i = 0; i < 8; i += 1) {
      const x = 240 + i * 31;
      mark(
        v,
        [
          [x, 476],
          [x + 9, 463],
          [x + 24, 464],
        ],
        "#f2bf825d",
        7,
        "bristle",
      );
    }
    mark(
      v,
      [
        [236, 455],
        [258, 430],
        [287, 416],
      ],
      "#b37a6388",
      2.7,
    );
    mark(
      v,
      [
        [298, 393],
        [309, 408],
        [319, 415],
      ],
      "#c9926f9c",
      2.6,
    );
    mark(
      v,
      [
        [352, 385],
        [356, 402],
        [354, 411],
      ],
      "#dfaa7da6",
      2.8,
    );
    mark(
      v,
      [
        [420, 407],
        [409, 422],
        [403, 434],
      ],
      "#d69d749c",
      2.6,
    );
    mark(
      v,
      [
        [480, 468],
        [465, 481],
        [448, 486],
      ],
      "#d9a079a0",
      2.6,
    );
    mark(
      v,
      [
        [494, 531],
        [472, 530],
        [453, 523],
      ],
      "#d89b739c",
      2.7,
    );
    mark(
      v,
      [
        [272, 567],
        [289, 549],
        [301, 543],
      ],
      "#d69d758c",
      2.8,
    );
    mark(
      v,
      [
        [359, 590],
        [363, 568],
        [370, 552],
      ],
      "#d09b748c",
      2.8,
    );
  });
  mark(v, shell.concat([shell[0] ?? [205, 507]]), "#223d42", 5.5);
  mark(
    v,
    [
      [213, 530],
      [285, 557],
      [372, 571],
      [464, 557],
      [514, 525],
    ],
    "#dfad77",
    9,
    "bristle",
  );
  mark(
    v,
    [
      [232, 531],
      [297, 548],
      [379, 553],
      [464, 531],
    ],
    "#233e3f",
    3.5,
  );

  // The timbered room glows through a wall set into the shell.
  v.ellipse(359, 472, 102.5, 90, {
    fill: v.ellipseGradient(359, 472, 102.5, 90, [
      [0, "#edb87b6b"],
      [1, "#edb87b00"],
    ]),
  });
  blob(
    v,
    [
      [292, 441],
      [317, 411],
      [405, 407],
      [440, 435],
      [448, 526],
      [405, 552],
      [300, 533],
    ],
    "#294445",
  );
  blob(
    v,
    [
      [311, 443],
      [330, 426],
      [393, 423],
      [419, 441],
      [421, 517],
      [395, 533],
      [313, 517],
    ],
    "#bb8060",
  );
  blob(
    v,
    [
      [303, 441],
      [329, 416],
      [390, 413],
      [425, 438],
      [419, 449],
      [391, 431],
      [332, 433],
      [310, 453],
    ],
    "#503e3d",
  );
  mark(
    v,
    [
      [307, 443],
      [333, 425],
      [390, 423],
      [419, 444],
    ],
    "#f1c390",
    5,
    "bristle",
  );
  for (let i = 0; i < 7; i += 1) {
    const x = 322 + i * 13;
    mark(
      v,
      [
        [x, 427],
        [x + 8, 435],
      ],
      "#ad7258",
      2.5,
      "ink",
    );
  }
  v.rect(331, 442, 65, 12, { fill: "#deb57e" });
  v.text(
    "BOOKS",
    { x: 363, y: 451 },
    { size: 8, align: "center", valign: "baseline", fill: "#604d45" },
  );
  v.rect(332, 453, 63, 69, { fill: "#efc48b" });
  v.rect(339, 462, 49, 58, { fill: "#a25e4b" });
  v.rect(344, 467, 39, 50, { fill: "#f9d68e" });
  // Book spines in the window, some tilted by the crossing.
  for (let i = 0; i < 7; i += 1) {
    const x = 345 + i * 5.5;
    v.rect(x, 481 + (i % 3) * 2, 4.2, 24 - (i % 3) * 2, {
      fill: ["#703f46", "#54716b", "#936447", "#355769"][i % 4] ?? "#703f46",
    });
  }
  mark(
    v,
    [
      [344, 506],
      [383, 506],
    ],
    "#5c493e",
    2,
  );
  mark(
    v,
    [
      [363, 467],
      [363, 517],
    ],
    "#6f4d42",
    2,
  );
  mark(
    v,
    [
      [342, 481],
      [386, 481],
    ],
    "#e8b673",
    1.5,
  );
  mark(
    v,
    [
      [340, 519],
      [387, 519],
    ],
    "#704e45",
    3,
  );
  mark(
    v,
    [
      [325, 450],
      [333, 441],
      [397, 439],
      [409, 450],
    ],
    "#f1c596",
    4,
    "bristle",
  );
  mark(
    v,
    [
      [300, 531],
      [348, 544],
      [398, 541],
      [440, 524],
    ],
    "#172f35",
    5,
  );
  // Roof shingles climb the turtle's curve.
  for (let i = 0; i < 9; i += 1) {
    const x = 277 + i * 19;
    mark(
      v,
      [
        [x, 420 - (i < 5 ? i : 9 - i) * 5],
        [x + 16, 412 - (i < 5 ? i : 9 - i) * 5],
      ],
      "#d8a879",
      3.4,
      "bristle",
    );
  }

  // A small keeper on the shell: coat, face, lantern and reaching arm.
  blob(
    v,
    [
      [257, 451],
      [246, 475],
      [256, 505],
      [283, 510],
      [294, 477],
      [281, 454],
    ],
    "#d19a5d",
  );
  blob(
    v,
    [
      [255, 454],
      [263, 435],
      [278, 435],
      [287, 451],
      [279, 464],
      [262, 464],
    ],
    "#a75646",
  );
  v.ellipse(273, 446, 7.5, 8.5, { fill: "#efd0a2" });
  v.circle(277, 442, 1.2, { fill: "#273c3e" });
  v.circle(281, 448, 1.25, { fill: "#ad6253" });
  mark(
    v,
    [
      [267, 453],
      [274, 458],
      [281, 455],
    ],
    "#823f3a",
    2,
  );
  mark(
    v,
    [
      [260, 463],
      [249, 478],
      [255, 499],
      [281, 502],
    ],
    "#f2c885",
    4.5,
    "bristle",
  );
  mark(
    v,
    [
      [274, 471],
      [272, 498],
    ],
    "#9f6347",
    2,
  );
  v.circle(267, 481, 1.15, { fill: "#8a5b4b" });
  v.circle(266, 490, 1.15, { fill: "#8a5b4b" });
  mark(
    v,
    [
      [279, 475],
      [304, 459],
      [321, 449],
    ],
    "#d5a66d",
    7,
    "ink",
  );
  v.circle(318, 450, 2.5, { fill: "#edc193" });
  mark(
    v,
    [
      [259, 503],
      [251, 524],
    ],
    "#463e3b",
    5,
  );
  mark(
    v,
    [
      [280, 504],
      [289, 526],
    ],
    "#463e3b",
    5,
  );
  // Lantern at the end of the keeper's arm.
  v.ellipse(327, 455, 62.5, 62.5, {
    fill: v.ellipseGradient(327, 455, 62.5, 62.5, [
      [0, "#ffd38a9c"],
      [1, "#ffd38a00"],
    ]),
  });
  v.rect(318, 443, 18, 24, { fill: "#fce2a3" });
  v.rect(316, 441, 22, 27, {
    stroke: "#243b3e",
    weight: 3,
    brush: "ink",
    gesture: MARK_GESTURE,
  });
  mark(
    v,
    [
      [321, 441],
      [325, 433],
      [333, 441],
    ],
    "#27383b",
    2,
  );

  // Ripples and the wake wrap the crossing in light.
  for (let i = 0; i < 13; i += 1) {
    const y = 617 + i * 10;
    const extent = 145 + i * 15;
    mark(
      v,
      [
        [380 - extent, y + 7],
        [315, y],
        [419, y - 2],
        [380 + extent, y + 5],
      ],
      i % 2 ? "#e0bd8d77" : "#8cb9ad8b",
      i % 2 ? 5 : 3,
      "bristle",
    );
  }
  mark(
    v,
    [
      [542, 573],
      [610, 577],
      [697, 600],
      [755, 593],
    ],
    "#b1c8ac",
    5,
    "wash",
  );
  mark(
    v,
    [
      [105, 610],
      [170, 592],
      [230, 608],
    ],
    "#91b1a8",
    6,
    "wash",
  );
  for (let i = 0; i < 14; i += 1) {
    const y = 647 + i * 7;
    const x = 302 + Math.sin(i * 2.6) * 20;
    mark(
      v,
      [
        [x, y],
        [x + 24 + (i % 3) * 10, y - 2],
      ],
      i % 3 === 0 ? "#ffd197b0" : "#edaf75a0",
      6 + (i % 3),
      "bristle",
    );
  }
  const reeds: [number, number][] = [
    [20, 1],
    [744, -1],
  ];
  for (const [x, flip] of reeds) {
    mark(
      v,
      [
        [x, 766],
        [x + flip * 7, 713],
        [x + flip * 28, 649],
      ],
      "#142e3e",
      6,
      "ink",
    );
    mark(
      v,
      [
        [x + flip * 9, 757],
        [x + flip * 33, 693],
        [x + flip * 42, 677],
      ],
      "#203d46",
      3.5,
      "ink",
    );
    blob(
      v,
      [
        [x + flip * 9, 723],
        [x + flip * 34, 710],
        [x + flip * 45, 715],
        [x + flip * 25, 728],
      ],
      "#254b4c",
    );
    blob(
      v,
      [
        [x + flip * 19, 687],
        [x + flip * 38, 675],
        [x + flip * 50, 680],
        [x + flip * 33, 694],
      ],
      "#31544c",
    );
    mark(
      v,
      [
        [x + flip * 28, 649],
        [x + flip * 31, 628],
      ],
      "#806b56",
      7,
      "bristle",
    );
  }
  for (let i = 0; i < 7; i += 1) {
    const y = 600 + i * 23;
    const x = 579 + Math.sin(i * 2.1) * 26;
    mark(
      v,
      [
        [x, y],
        [x + 25 + i * 2, y - 1],
      ],
      "#c5c8ae75",
      3.5,
      "bristle",
    );
  }
  v.paperTexture(0.36);
}
