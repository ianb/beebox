import type { BrushName, DeepReadonly, Drawing, Msg, ParamValues, ParamsDecl, RootDrawing, Style, Util, Vec2, View } from "@ianbicking/canvas-loop";

export const canvas = { width: 760, height: 760 };

export const params = {
  current: { type: "number", min: 0, max: 2, default: 1, step: 0.1 },
  lantern: { type: "boolean", default: true },
  fireflies: { type: "boolean", default: true },
} as const satisfies ParamsDecl;

type Params = ParamValues<typeof params>;
interface Ripple {
  x: number;
  y: number;
  born: number;
}

export interface Model {
  frame: number;
  ripples: readonly Ripple[];
  dragging: boolean;
  lastDragFrame: number;
  lanternLit: boolean;
  hoveringLantern: boolean;
}

export function init(u: Util<typeof params>): Model {
  return {
    frame: 0,
    ripples: [],
    dragging: false,
    lastDragFrame: -20,
    lanternLit: u.params.lantern,
    hoveringLantern: false,
  };
}

function overLantern(x: number, y: number): boolean {
  return Math.hypot(x - 327, y - 454) < 36;
}

function overWater(x: number, y: number): boolean {
  return y > 605 && x >= 0 && x <= 760 && y <= 760;
}

function addRipple(model: DeepReadonly<Model>, x: number, y: number): Model {
  return {
    ...model,
    ripples: [...model.ripples.slice(-5), { x, y, born: model.frame }],
  };
}

export function update(
  model: DeepReadonly<Model>,
  msg: Msg,
  u: Util<typeof params>,
): Model {
  switch (msg.type) {
    case "tick":
      return {
        ...model,
        frame: msg.frame,
        ripples: model.ripples.filter((r) => msg.frame - r.born < 56),
      };
    case "mousedown":
      if (overLantern(msg.x, msg.y)) {
        u.handled("toggle-lantern");
        return { ...model, lanternLit: !model.lanternLit, dragging: false };
      }
      if (overWater(msg.x, msg.y)) {
        u.handled("touch-water");
        return {
          ...addRipple(model, msg.x, msg.y),
          dragging: true,
          lastDragFrame: model.frame,
        };
      }
      return model;
    case "mousemove":
      if (
        model.dragging &&
        overWater(msg.x, msg.y) &&
        model.frame - model.lastDragFrame >= 5
      ) {
        u.handled("trail-ripples");
        return {
          ...addRipple(model, msg.x, msg.y),
          lastDragFrame: model.frame,
        };
      }
      if (overLantern(msg.x, msg.y) !== model.hoveringLantern) {
        u.handled("lantern-hover");
        return { ...model, hoveringLantern: overLantern(msg.x, msg.y) };
      }
      return model;
    case "mouseup":
      if (model.dragging) {
        u.handled("release-water");
        return { ...model, dragging: false };
      }
      return model;
    case "param":
      if (msg.name === "lantern")
        return { ...model, lanternLit: u.params.lantern };
      return model;
    case "keydown":
    case "keyup":
    case "trigger":
      return model;
  }
}

function drawWater(v: View, model: DeepReadonly<Model>, p: Params): Drawing {
  const out: Drawing[] = [];
  const phase = model.frame * 0.055 * p.current;
  for (let row = 0; row < 5; row += 1) {
    const y = 646 + row * 21;
    const drift = Math.sin(phase + row * 1.4) * 14;
    const style: Style = {
      stroke: row % 2 ? "#f4c58b3c" : "#a8c7b047",
      weight: row % 2 ? 2.1 : 1.5,
    };
    for (let col = 0; col < 3; col += 1) {
      const x = ((col * 249 + row * 73 + drift + 780) % 780) - 10;
      out.push(v.line(x, y, x + 18 + row * 2, y - 1, style));
    }
  }
  for (let i = 0; i < 5; i += 1) {
    const y = 647 + i * 19;
    const x = 313 + Math.sin(phase * 0.7 + i * 1.8) * (12 + i * 2);
    out.push(v.line(x, y, x + 20 + i * 2, y - 1, {
      stroke: "#f9d3968a",
      weight: 3.5 - i * 0.25,
    }));
  }
  for (const ripple of model.ripples) {
    const age = model.frame - ripple.born;
    const radius = 7 + age * (0.65 + p.current * 0.25);
    const alpha = Math.max(0, Math.round((1 - age / 56) * 145))
      .toString(16)
      .padStart(2, "0");
    out.push(v.ellipse(ripple.x, ripple.y, (radius * 2.5) / 2, (radius * 0.75) / 2, {
      stroke: `#d8d5ae${alpha}`,
      weight: 2.3,
    }));
    if (age > 11) {
      out.push(v.ellipse(ripple.x, ripple.y, (radius * 3.6) / 2, (radius * 1.1) / 2, {
        stroke: `#b6d0bc${alpha}`,
        weight: 1.3,
      }));
    }
  }
  return out;
}

function drawLight(v: View, model: DeepReadonly<Model>, p: Params): Drawing {
  const out: Drawing[] = [];
  if (!model.lanternLit) {
    out.push(v.rect(339, 462, 50, 57, { fill: "#294445a8" }));

    out.push(v.rect(320, 445, 14, 18, { fill: "#4c514bce" }));
    return out;
  }
  const pulse = 0.5 + 0.5 * Math.sin(model.frame * 0.09);
  const size = (model.hoveringLantern ? 89 : 69) + pulse * 9;

  out.push(v.ellipse(327, 455, size, size, {
    fill: v.ellipseGradient(327, 455, size, size, [
      [0, "#ffe5a965"],
      [1, "#ffe5a900"],
    ]),
  }));

  out.push(v.ellipse(
    326 + Math.sin(model.frame * 0.16) * 1.2,
    454,
    (8 + pulse * 2) / 2,
    (13 + pulse * 3) / 2,
    { fill: "#fff3b2" },
  ));

  out.push(v.ellipse(364, 492, (39 + pulse * 7) / 2, (45 + pulse * 7) / 2, { fill: "#ffdda92c" }));
  for (let i = 0; i < 5; i += 1) {
    const y = 655 + i * 18;
    const x = 315 + Math.sin(model.frame * 0.065 + i * 2) * 13;

    out.push(v.ellipse(x, y, (16 + (i % 2) * 9) / 2, 1.75, { fill: "#ffda9f7a" }));
  }
  if (p.fireflies) {
    for (let i = 0; i < 4; i += 1) {
      const x = 460 + i * 47 + Math.sin(model.frame * 0.025 + i * 2.4) * 9;
      const y = 370 + i * 27 + Math.cos(model.frame * 0.035 + i * 2.1) * 10;

      out.push(v.circle(x, y, 3.5, { fill: "#ffe0a862" }));

      out.push(v.circle(x, y, 1.25, { fill: "#fff1bf" }));
    }
  }
  return out;
}

function drawTurtleEye(v: View, model: DeepReadonly<Model>): Drawing {
  const out: Drawing[] = [];
  const blinkDistance = Math.abs((model.frame % 100) - 65);
  const openness = Math.min(1, blinkDistance / 3);

  out.push(v.ellipse(629, 511, 5, 6.5, { fill: "#3b6b61" }));

  out.push(v.ellipse(629, 511, 3, (1.2 + openness * 7) / 2, { fill: "#142f37" }));
  if (openness > 0.55) {
    out.push(v.circle(630, 509, 1.1, { fill: "#f6d69c" }));
  }
  return out;
}

export function draw(v: View, model: DeepReadonly<Model>, p: Params): RootDrawing {
  return [
    v.place(v.picture({ key: "painted-library", width: v.width, height: v.height }, () => drawOriginal(v)), 0, 0),
    drawTurtleEye(v, model),
    drawWater(v, model, p),
    drawLight(v, model, p),
  ];
}

const P = (points: number[][]): Vec2[] =>
  points.map((point) => [point[0] ?? 0, point[1] ?? 0]);

const GESTURE = { pressure: "taper", wobble: 0.5 } as const;

function blob(v: View, points: number[][], color: string): Drawing {
  return v.curve(P(points), true, { fill: color });
}

function mark(
  v: View,
  points: number[][],
  color: string,
  width: number,
  brush: BrushName = "ink",
): Drawing {
  return v.curve(P(points), false, {
    stroke: color,
    weight: width,
    brush,
    gesture: GESTURE,
  });
}

function glint(v: View, x: number, y: number, r: number): Drawing {
  return [
    v.circle(x, y, r / 2, { fill: "#ffdb91" }),
    mark(
      v,
      [
        [x - r * 1.3, y],
        [x + r * 1.3, y],
      ],
      "#ffe8b4",
      1.4,
    ),
    mark(
      v,
      [
        [x, y - r * 1.3],
        [x, y + r * 1.3],
      ],
      "#ffe8b4",
      1.4,
    ),
  ];
}

function drawOriginal(v: View): Drawing {
  // Port: `v.paperTexture(0.36)` at the end becomes what was drawn before it, in a group with
  // `effects.paper` (draft section 2).
  return v.paper({ scale: 3.2, contrast: 0.68, seed: 11 }, v.group({ effects: { paper: 0.36 } }, ((): Drawing => {
    const parts: Drawing[] = [];
    parts.push(v.background(
      v.linearGradient(0, 0, 0, 760, [
        [0, "#182d47"],
        [0.38, "#496b78"],
        [0.62, "#b38c76"],
        [1, "#233f58"],
      ]),
    ));

    // A gap in the storm over the library.

    parts.push(v.ellipse(388, 250, 275, 230, {
      fill: v.ellipseGradient(388, 250, 275, 230, [
        [0, "#deb5909c"],
        [1, "#deb59000"],
      ]),
    }));

    parts.push(v.circle(590, 117, 27.5, { fill: "#f8dfae" }));

    parts.push(v.circle(590, 117, 26, { fill: "#f1d8a9" }));

    // Rain clouds, broken into broad painted bands.
    for (let i = 0; i < 11; i += 1) {
      const y = 47 + i * 18;
      parts.push(mark(
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
      ));
    }
    for (let i = 0; i < 25; i += 1) {
      const x = 18 + ((i * 101) % 735);
      const y = 35 + ((i * 71) % 270);
      if (i % 4 === 0) parts.push(glint(v, x, y, 1.8));
    }

    // Flooded village on the far bank.
    parts.push(blob(
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
    ));
    const houses: [number, number, number][] = [
      [43, 339, 62],
      [162, 344, 48],
      [583, 330, 59],
      [690, 345, 51],
    ];
    for (const [x, y, w] of houses) {
      parts.push(blob(
        v,
        [
          [x - 8, y + 8],
          [x + w / 2, y - 26],
          [x + w + 8, y + 8],
        ],
        "#213d51",
      ));
      parts.push(v.rect(x, y, w, 75, { fill: "#294658" }));
      parts.push(v.rect(x + w * 0.43, y + 20, 11, 13, { fill: "#ddaa78" }));
      parts.push(mark(
        v,
        [
          [x - 8, y + 8],
          [x + w / 2, y - 26],
          [x + w + 8, y + 8],
        ],
        "#173248",
        2.3,
      ));
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
      parts.push(mark(
        v,
        [
          [x, 405],
          [x - 5, 354],
          [x + 4, top + 17],
        ],
        "#243f4e",
        4.5,
        "ink",
      ));
      parts.push(blob(
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
      ));
      parts.push(mark(
        v,
        [
          [x - 18, top + 50],
          [x - 5, top + 37],
          [x + 14, top + 47],
        ],
        "#64827988",
        4,
        "bristle",
      ));
    }
    parts.push(mark(
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
    ));

    // Quiet water behind the principal subject.

    parts.push(v.rect(0, 410, 760, 350, {
      fill: v.linearGradient(0, 410, 0, 760, [
        [0, "#536c71"],
        [0.48, "#284e62"],
        [1, "#172e49"],
      ]),
    }));
    for (let row = 0; row < 21; row += 1) {
      const y = 425 + row * 16;
      const width = 32 + row * 2;
      for (let col = 0; col < 9; col += 1) {
        const x = ((col * 103 + row * 43) % 825) - 35;
        parts.push(mark(
          v,
          [
            [x, y],
            [x + width * 0.5, y - 2],
            [x + width, y],
          ],
          row % 3 === 0 ? "#dcb28a56" : "#8eb2aa55",
          row % 3 === 0 ? 3.6 : 2.3,
          "bristle",
        ));
      }
    }

    // The turtle's feet sit deep in the flood; the neck leads the eye right.
    parts.push(blob(
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
    ));
    parts.push(blob(
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
    ));
    parts.push(blob(
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
    ));
    parts.push(blob(
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
    ));
    parts.push(blob(
      v,
      [
        [618, 542],
        [637, 559],
        [661, 559],
        [653, 569],
        [621, 561],
      ],
      "#31574e",
    ));
    parts.push(mark(
      v,
      [
        [583, 501],
        [636, 492],
        [661, 508],
      ],
      "#a9b781",
      10,
      "wash",
    ));
    parts.push(v.ellipse(629, 511, 3.5, 4.5, { fill: "#142f37" }));
    parts.push(v.circle(630, 509, 1.2, { fill: "#f6d69c" }));
    parts.push(v.circle(663, 527, 1.1, { fill: "#36574d" }));
    parts.push(mark(
      v,
      [
        [614, 500],
        [627, 497],
        [638, 503],
      ],
      "#264c49",
      3.1,
    ));
    parts.push(mark(
      v,
      [
        [637, 539],
        [649, 544],
        [661, 540],
      ],
      "#183a3b",
      2.4,
    ));
    parts.push(mark(
      v,
      [
        [550, 532],
        [567, 547],
        [587, 553],
      ],
      "#204044",
      2.3,
    ));
    parts.push(mark(
      v,
      [
        [536, 510],
        [559, 493],
        [589, 487],
      ],
      "#91a97c",
      8,
      "bristle",
    ));
    parts.push(mark(
      v,
      [
        [182, 552],
        [210, 570],
        [242, 575],
      ],
      "#749578",
      8,
      "bristle",
    ));
    parts.push(mark(
      v,
      [
        [147, 610],
        [169, 605],
        [191, 608],
      ],
      "#83a17c",
      6,
      "bristle",
    ));
    parts.push(mark(
      v,
      [
        [517, 617],
        [546, 627],
        [570, 635],
      ],
      "#75957a",
      6,
      "bristle",
    ));

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
    parts.push(blob(v, shell, "#704f49"));
    parts.push(v.clip(v.curvePath(P(shell), true), ((): Drawing => {
      const nodes: Drawing[] = [];
      for (let i = 0; i < 23; i += 1) {
        const y = 392 + i * 9;
        nodes.push(mark(
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
        ));
      }
      nodes.push(mark(
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
      ));
      for (let i = 0; i < 8; i += 1) {
        const x = 240 + i * 31;
        nodes.push(mark(
          v,
          [
            [x, 476],
            [x + 9, 463],
            [x + 24, 464],
          ],
          "#f2bf825d",
          7,
          "bristle",
        ));
      }
      nodes.push(mark(
        v,
        [
          [236, 455],
          [258, 430],
          [287, 416],
        ],
        "#b37a6388",
        2.7,
      ));
      nodes.push(mark(
        v,
        [
          [298, 393],
          [309, 408],
          [319, 415],
        ],
        "#c9926f9c",
        2.6,
      ));
      nodes.push(mark(
        v,
        [
          [352, 385],
          [356, 402],
          [354, 411],
        ],
        "#dfaa7da6",
        2.8,
      ));
      nodes.push(mark(
        v,
        [
          [420, 407],
          [409, 422],
          [403, 434],
        ],
        "#d69d749c",
        2.6,
      ));
      nodes.push(mark(
        v,
        [
          [480, 468],
          [465, 481],
          [448, 486],
        ],
        "#d9a079a0",
        2.6,
      ));
      nodes.push(mark(
        v,
        [
          [494, 531],
          [472, 530],
          [453, 523],
        ],
        "#d89b739c",
        2.7,
      ));
      nodes.push(mark(
        v,
        [
          [272, 567],
          [289, 549],
          [301, 543],
        ],
        "#d69d758c",
        2.8,
      ));
      nodes.push(mark(
        v,
        [
          [359, 590],
          [363, 568],
          [370, 552],
        ],
        "#d09b748c",
        2.8,
      ));
      return nodes;
    })()));
    parts.push(mark(v, shell.concat([shell[0] ?? [205, 507]]), "#223d42", 5.5));
    parts.push(mark(
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
    ));
    parts.push(mark(
      v,
      [
        [232, 531],
        [297, 548],
        [379, 553],
        [464, 531],
      ],
      "#233e3f",
      3.5,
    ));

    // The timbered room glows through a wall set into the shell.

    parts.push(v.ellipse(359, 472, 102.5, 90, {
      fill: v.ellipseGradient(359, 472, 102.5, 90, [
        [0, "#edb87b6b"],
        [1, "#edb87b00"],
      ]),
    }));
    parts.push(blob(
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
    ));
    parts.push(blob(
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
    ));
    parts.push(blob(
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
    ));
    parts.push(mark(
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
    ));
    for (let i = 0; i < 7; i += 1) {
      const x = 322 + i * 13;
      parts.push(mark(
        v,
        [
          [x, 427],
          [x + 8, 435],
        ],
        "#ad7258",
        2.5,
        "ink",
      ));
    }
    parts.push(v.rect(331, 442, 65, 12, { fill: "#deb57e" }));
    parts.push(v.text(
      "BOOKS",
      { x: 363, y: 451 },
      { size: 8, align: "center", valign: "baseline", fill: "#604d45" },
    ));
    parts.push(v.rect(332, 453, 63, 69, { fill: "#efc48b" }));
    parts.push(v.rect(339, 462, 49, 58, { fill: "#a25e4b" }));
    parts.push(v.rect(344, 467, 39, 50, { fill: "#f9d68e" }));
    // Book spines in the window, some tilted by the crossing.
    for (let i = 0; i < 7; i += 1) {
      const x = 345 + i * 5.5;

      parts.push(v.rect(x, 481 + (i % 3) * 2, 4.2, 24 - (i % 3) * 2, {
        fill: ["#703f46", "#54716b", "#936447", "#355769"][i % 4] ?? "#703f46",
      }));
    }
    parts.push(mark(
      v,
      [
        [344, 506],
        [383, 506],
      ],
      "#5c493e",
      2,
    ));
    parts.push(mark(
      v,
      [
        [363, 467],
        [363, 517],
      ],
      "#6f4d42",
      2,
    ));
    parts.push(mark(
      v,
      [
        [342, 481],
        [386, 481],
      ],
      "#e8b673",
      1.5,
    ));
    parts.push(mark(
      v,
      [
        [340, 519],
        [387, 519],
      ],
      "#704e45",
      3,
    ));
    parts.push(mark(
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
    ));
    parts.push(mark(
      v,
      [
        [300, 531],
        [348, 544],
        [398, 541],
        [440, 524],
      ],
      "#172f35",
      5,
    ));
    // Roof shingles climb the turtle's curve.
    for (let i = 0; i < 9; i += 1) {
      const x = 277 + i * 19;
      parts.push(mark(
        v,
        [
          [x, 420 - (i < 5 ? i : 9 - i) * 5],
          [x + 16, 412 - (i < 5 ? i : 9 - i) * 5],
        ],
        "#d8a879",
        3.4,
        "bristle",
      ));
    }

    // A small keeper on the shell: coat, face, lantern and reaching arm.
    parts.push(blob(
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
    ));
    parts.push(blob(
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
    ));
    parts.push(v.ellipse(273, 446, 7.5, 8.5, { fill: "#efd0a2" }));
    parts.push(v.circle(277, 442, 1.2, { fill: "#273c3e" }));
    parts.push(v.circle(281, 448, 1.25, { fill: "#ad6253" }));
    parts.push(mark(
      v,
      [
        [267, 453],
        [274, 458],
        [281, 455],
      ],
      "#823f3a",
      2,
    ));
    parts.push(mark(
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
    ));
    parts.push(mark(
      v,
      [
        [274, 471],
        [272, 498],
      ],
      "#9f6347",
      2,
    ));
    parts.push(v.circle(267, 481, 1.15, { fill: "#8a5b4b" }));
    parts.push(v.circle(266, 490, 1.15, { fill: "#8a5b4b" }));
    parts.push(mark(
      v,
      [
        [279, 475],
        [304, 459],
        [321, 449],
      ],
      "#d5a66d",
      7,
      "ink",
    ));
    parts.push(v.circle(318, 450, 2.5, { fill: "#edc193" }));
    parts.push(mark(
      v,
      [
        [259, 503],
        [251, 524],
      ],
      "#463e3b",
      5,
    ));
    parts.push(mark(
      v,
      [
        [280, 504],
        [289, 526],
      ],
      "#463e3b",
      5,
    ));
    // Lantern at the end of the keeper's arm.
    parts.push(v.ellipse(327, 455, 62.5, 62.5, {
      fill: v.ellipseGradient(327, 455, 62.5, 62.5, [
        [0, "#ffd38a9c"],
        [1, "#ffd38a00"],
      ]),
    }));
    parts.push(v.rect(318, 443, 18, 24, { fill: "#fce2a3" }));
    parts.push(v.rect(316, 441, 22, 27, {
      stroke: "#243b3e",
      weight: 3,
      brush: "ink",
      gesture: GESTURE,
    }));
    parts.push(mark(
      v,
      [
        [321, 441],
        [325, 433],
        [333, 441],
      ],
      "#27383b",
      2,
    ));

    // Ripples and the wake wrap the crossing in light.
    for (let i = 0; i < 13; i += 1) {
      const y = 617 + i * 10;
      const extent = 145 + i * 15;
      parts.push(mark(
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
      ));
    }
    parts.push(mark(
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
    ));
    parts.push(mark(
      v,
      [
        [105, 610],
        [170, 592],
        [230, 608],
      ],
      "#91b1a8",
      6,
      "wash",
    ));
    for (let i = 0; i < 14; i += 1) {
      const y = 647 + i * 7;
      const x = 302 + Math.sin(i * 2.6) * 20;
      parts.push(mark(
        v,
        [
          [x, y],
          [x + 24 + (i % 3) * 10, y - 2],
        ],
        i % 3 === 0 ? "#ffd197b0" : "#edaf75a0",
        6 + (i % 3),
        "bristle",
      ));
    }
    const reeds: [number, number][] = [
      [20, 1],
      [744, -1],
    ];
    for (const [x, flip] of reeds) {
      parts.push(mark(
        v,
        [
          [x, 766],
          [x + flip * 7, 713],
          [x + flip * 28, 649],
        ],
        "#142e3e",
        6,
        "ink",
      ));
      parts.push(mark(
        v,
        [
          [x + flip * 9, 757],
          [x + flip * 33, 693],
          [x + flip * 42, 677],
        ],
        "#203d46",
        3.5,
        "ink",
      ));
      parts.push(blob(
        v,
        [
          [x + flip * 9, 723],
          [x + flip * 34, 710],
          [x + flip * 45, 715],
          [x + flip * 25, 728],
        ],
        "#254b4c",
      ));
      parts.push(blob(
        v,
        [
          [x + flip * 19, 687],
          [x + flip * 38, 675],
          [x + flip * 50, 680],
          [x + flip * 33, 694],
        ],
        "#31544c",
      ));
      parts.push(mark(
        v,
        [
          [x + flip * 28, 649],
          [x + flip * 31, 628],
        ],
        "#806b56",
        7,
        "bristle",
      ));
    }
    for (let i = 0; i < 7; i += 1) {
      const y = 600 + i * 23;
      const x = 579 + Math.sin(i * 2.1) * 26;
      parts.push(mark(
        v,
        [
          [x, y],
          [x + 25 + i * 2, y - 1],
        ],
        "#c5c8ae75",
        3.5,
        "bristle",
      ));
    }
    return parts;
  })()));
}
