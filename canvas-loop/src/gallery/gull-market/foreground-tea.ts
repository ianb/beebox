// Things around the theft: the gull's flight trail from the gap, drips and a
// loose feather, its shadow on the quay, bunting, crates of fish, a jealous
// gull on a bollard and a cat who saw everything.
import type { View, Vec2 } from "@ianbicking/canvas-loop";
import { fish } from "./fish-tea.js";
import { GULL_AT } from "./gull-tea.js";
import { form, hash, INK, mark, ring } from "./kit-tea.js";

/** Shadows the sun throws down and to the left of everything standing on the quay. */
export function castShadows(v: View): void {
  v.group({ opacity: 0.4, blend: "multiply" }, () => {
    const shadow = { fill: "#8a6e4e" };
    v.polygon(
      [
        [454, 600],
        [884, 600],
        [846, 632],
        [412, 632],
      ],
      shadow,
    );
    v.polygon(
      [
        [90, 596],
        [240, 596],
        [204, 624],
        [54, 624],
      ],
      shadow,
    );
    v.ellipse(276, 618, 56, 12, shadow);
    v.ellipse(372, 632, 88, 14, shadow);
    v.ellipse(322, 548, 60, 10, shadow);
    v.ellipse(40, 624, 70, 12, shadow);
    v.polygon(
      [
        [8, 636],
        [26, 636],
        [-10, 668],
        [-28, 668],
      ],
      shadow,
    );
  });
}

export function shadowAndBunting(v: View): void {
  // the gull's shadow, down and left on the quay
  v.ellipse(250, 590, 150, 28, {
    fill: v.ellipseGradient(250, 590, 150, 28, [
      [0, "rgba(90,70,50,0.35)"],
      [1, "rgba(90,70,50,0)"],
    ]),
  });
  // lamppost and a string of bunting to the stall
  form(
    v,
    [
      [12, 150],
      [22, 150],
      [26, 640],
      [8, 640],
    ],
    {
      base: "#2f4f4f",
      shade: "#1b3030",
      depth: 5,
      sharp: true,
      weight: 2,
      seed: 3001,
    },
  );
  form(
    v,
    [
      [0, 120],
      [34, 120],
      [28, 150],
      [6, 150],
    ],
    {
      base: "#fff3c4",
      shade: "#d9c88a",
      depth: 4,
      sharp: true,
      weight: 2,
      seed: 3002,
    },
  );
  const line: Vec2[] = [
    [20, 160],
    [180, 198],
    [330, 198],
    [478, 166],
  ];
  mark(v, line, { color: INK, weight: 1.6, pressure: "even", seed: 3003 });
  const colours = ["#e2423a", "#f7d548", "#3e86b8", "#7fb069", "#f78154"];
  for (let i = 0; i < 13; i += 1) {
    const t = (i + 0.5) / 13;
    const x = 20 + t * 458;
    const sag = Math.sin(t * Math.PI) * 34;
    const y = 160 + t * 6 + sag;
    form(
      v,
      [
        [x - 10, y],
        [x + 10, y + 1],
        [x + 1, y + 24],
      ],
      {
        base: colours[i % colours.length] ?? "#e2423a",
        shade: "#00000033",
        depth: 3,
        sharp: true,
        weight: 1.4,
        seed: 3010 + i,
      },
    );
  }
}

export function trail(v: View): void {
  // speed strokes behind the gull
  for (let i = 0; i < 4; i += 1) {
    const y = GULL_AT[1] - 30 + i * 16;
    mark(
      v,
      [
        [GULL_AT[0] + 150, y],
        [GULL_AT[0] + 220 - i * 10, y + 6],
      ],
      { color: "#8aa3b4", weight: 3, wobble: 1, seed: 3120 + i },
    );
  }
  // drips falling from the fish, and a loose feather
  for (let i = 0; i < 4; i += 1) {
    const x = 182 + hash(i + 3) * 30;
    const y = 360 + i * 30;
    form(
      v,
      [
        [x, y - 8],
        [x + 4, y + 2],
        [x, y + 5],
        [x - 4, y + 2],
      ],
      {
        base: "#9fd6ea",
        shade: "#4d97b8",
        depth: 2,
        weight: 1.2,
        seed: 3130 + i,
      },
    );
  }
  v.at({ translate: [452, 330], rotate: 0.6 }, () => {
    form(
      v,
      [
        [-16, 0],
        [-6, -5],
        [14, -3],
        [18, 0],
        [14, 3],
        [-6, 5],
      ],
      { base: "#f4f4f0", shade: "#c8d2da", depth: 2, weight: 1.4, seed: 3140 },
    );
    mark(
      v,
      [
        [-20, 0],
        [16, 0],
      ],
      { color: "#8a96a0", weight: 1.2, pressure: "even" },
    );
  });
}

export function crates(v: View): void {
  for (const [x, y, w, h] of [
    [90, 520, 150, 80],
    [110, 470, 120, 56],
  ] as const) {
    form(
      v,
      [
        [x, y],
        [x + w, y],
        [x + w, y + h],
        [x, y + h],
      ],
      {
        base: "#c98b4f",
        shade: "#8c5a2c",
        light: "#e8b47a",
        depth: 14,
        sharp: true,
        weight: 2.6,
        seed: x + y,
      },
    );
    v.clip(
      [
        [x, y],
        [x + w, y],
        [x + w, y + h],
        [x, y + h],
      ],
      () => {
        for (let i = 1; i < 3; i += 1) {
          mark(
            v,
            [
              [x, y + (h * i) / 3],
              [x + w, y + (h * i) / 3],
            ],
            { color: "#6e4420", weight: 2.4, pressure: "even", seed: x + i },
          );
        }
        mark(
          v,
          [
            [x + 8, y + 4],
            [x + w * 0.6, y + h * 0.7],
          ],
          {
            color: "#a46a35",
            weight: 12,
            brush: "bristle",
            opacity: 0.7,
            seed: y + 5,
          },
        );
      },
    );
  }
  // fish heaped in the top crate
  for (let i = 0; i < 4; i += 1) {
    fish(v, {
      at: [130 + i * 26, 468 - (i % 2) * 6],
      len: 54,
      angle: -0.5 + i * 0.35,
      body: "#8fa3ad",
      belly: "#eef2f2",
      seed: 3200 + i * 5,
    });
  }
  // a bucket
  form(
    v,
    [
      [262, 560],
      [312, 560],
      [304, 616],
      [270, 616],
    ],
    {
      base: "#8fa8b8",
      shade: "#5c7484",
      light: "#c8d8e2",
      depth: 8,
      sharp: true,
      weight: 2.4,
      seed: 3300,
    },
  );
  form(v, ring(287, 560, 25, 6), {
    base: "#3c4e5a",
    shade: "#2a3a44",
    depth: 2,
    weight: 2,
    seed: 3301,
  });
  mark(
    v,
    [
      [264, 560],
      [287, 530],
      [310, 560],
    ],
    { color: INK, weight: 2, pressure: "even", seed: 3302 },
  );
}

export function bollardGull(v: View): void {
  // a second gull on a bollard, watching the thief, beak open in envy
  form(
    v,
    [
      [22, 620],
      [22, 560],
      [34, 548],
      [70, 548],
      [82, 560],
      [82, 620],
    ],
    {
      base: "#3a3f45",
      shade: "#22262a",
      light: "#5d656e",
      depth: 10,
      weight: 2.6,
      seed: 3400,
    },
  );
  const body: Vec2[] = [
    [18, 540],
    [30, 506],
    [62, 498],
    [96, 512],
    [104, 534],
    [72, 548],
    [30, 550],
  ];
  form(v, body, {
    base: "#fbfbf7",
    shade: "#c8d2da",
    depth: 10,
    weight: 2.4,
    seed: 3401,
  });
  form(
    v,
    [
      [46, 506],
      [92, 508],
      [102, 530],
      [60, 528],
    ],
    { base: "#b4c2cc", shade: "#7f909d", depth: 6, weight: 2.2, seed: 3402 },
  );
  form(v, ring(36, 492, 17, 15), {
    base: "#fbfbf7",
    shade: "#c8d2da",
    depth: 6,
    weight: 2.4,
    seed: 3403,
  });
  form(
    v,
    [
      [44, 486],
      [74, 476],
      [72, 484],
      [46, 494],
    ],
    {
      base: "#f4c430",
      shade: "#c8901c",
      depth: 2,
      sharp: true,
      weight: 1.8,
      seed: 3404,
    },
  );
  v.circle(40, 487, 5, { fill: INK });
  mark(
    v,
    [
      [32, 480],
      [46, 482],
    ],
    { color: INK, weight: 2.2, seed: 3405 },
  );
}

export function cat(v: View): void {
  // a ginger cat sitting on the quay, looking up at the gull and the fish
  const [cx, cy] = [392, 600];
  form(
    v,
    [
      [cx - 30, cy + 30],
      [cx - 34, cy - 4],
      [cx - 18, cy - 34],
      [cx + 12, cy - 36],
      [cx + 30, cy - 4],
      [cx + 30, cy + 30],
    ],
    {
      base: "#e8913f",
      shade: "#b0602a",
      light: "#f6b46e",
      strokes: "#f6b46e",
      depth: 12,
      weight: 2.8,
      seed: 3500,
    },
  );
  mark(
    v,
    [
      [cx + 28, cy + 26],
      [cx + 58, cy + 20],
      [cx + 62, cy - 6],
    ],
    { color: "#e8913f", weight: 12, pressure: "taper-out", seed: 3501 },
  );
  const head: Vec2 = [cx - 8, cy - 46];
  form(
    v,
    [
      [head[0] - 22, head[1] - 4],
      [head[0] - 20, head[1] - 28],
      [head[0] - 8, head[1] - 16],
      [head[0] + 8, head[1] - 18],
      [head[0] + 18, head[1] - 30],
      [head[0] + 22, head[1] - 2],
      [head[0] + 10, head[1] + 16],
      [head[0] - 12, head[1] + 16],
    ],
    {
      base: "#e8913f",
      shade: "#b0602a",
      light: "#f6b46e",
      depth: 8,
      weight: 2.6,
      seed: 3502,
    },
  );
  for (const ex of [head[0] - 8, head[0] + 8]) {
    v.ellipse(ex, head[1] - 2, 9, 10, { fill: "#d9f07a" });
    v.ellipse(ex - 2.5, head[1] - 5, 3, 5, { fill: INK });
  }
  for (let i = 0; i < 4; i += 1) {
    mark(
      v,
      [
        [cx - 22 + i * 12, cy - 30],
        [cx - 24 + i * 13, cy - 10],
      ],
      { color: "#b0602a", weight: 3, seed: 3510 + i },
    );
  }
}

export function child(v: View): void {
  // a small child in a yellow raincoat, laughing and pointing up at the gull
  const skin = "#f2c29a";
  for (const [x0, x1] of [
    [326, 322],
    [342, 348],
  ] as const) {
    v.path(
      v.tube(
        [
          [x0, 500],
          [x1, 534],
        ],
        { width: 11 },
      ),
      { fill: "#3e4a6b" },
    );
    form(
      v,
      [
        [x1 - 9, 530],
        [x1 + 9, 530],
        [x1 + 12, 546],
        [x1 - 10, 546],
      ],
      {
        base: "#d8483a",
        shade: "#93302a",
        depth: 3,
        sharp: true,
        weight: 1.8,
        seed: 3600 + x0,
      },
    );
  }
  form(
    v,
    [
      [316, 450],
      [350, 450],
      [364, 508],
      [302, 508],
    ],
    {
      base: "#f7c82e",
      shade: "#c9951c",
      light: "#ffe788",
      strokes: "#ffe27a",
      depth: 9,
      sharp: true,
      weight: 2.4,
      seed: 3610,
    },
  );
  mark(
    v,
    [
      [333, 454],
      [333, 506],
    ],
    { color: "#a8780f", weight: 1.6, pressure: "even" },
  );
  // pointing arm
  const arm = v.tube(
    [
      [348, 462],
      [362, 438],
      [370, 416],
    ],
    { width: 11 },
  );
  v.path(arm, { fill: "#f7c82e" });
  v.path(arm, { stroke: "#2b2230", weight: 2 });
  form(v, ring(371, 410, 5, 5), {
    base: skin,
    shade: "#cf9670",
    depth: 2,
    weight: 1.6,
  });
  mark(
    v,
    [
      [372, 406],
      [376, 396],
    ],
    { color: "#2b2230", weight: 3, pressure: "even" },
  );
  // head with a sou'wester, looking up
  form(v, ring(333, 432, 17, 17), {
    base: skin,
    shade: "#cf9670",
    depth: 6,
    weight: 2.4,
    seed: 3620,
  });
  form(
    v,
    [
      [310, 430],
      [318, 414],
      [334, 408],
      [350, 414],
      [358, 428],
      [346, 424],
      [322, 424],
    ],
    { base: "#f7c82e", shade: "#c9951c", depth: 4, weight: 2.2, seed: 3621 },
  );
  v.circle(332, 429, 4, { fill: INK });
  v.circle(344, 428, 4, { fill: INK });
  v.circle(333, 428, 1.5, { fill: "#ffffff" });
  v.circle(345, 427, 1.5, { fill: "#ffffff" });
  form(
    v,
    [
      [330, 438],
      [344, 436],
      [340, 444],
    ],
    {
      base: "#7a2a2a",
      shade: "#5a1a1a",
      depth: 1,
      sharp: true,
      weight: 1.4,
      seed: 3622,
    },
  );
  // (the outline of the form just above carries over onto this circle)
  v.circle(325, 437, 8, {
    fill: "rgba(226,92,80,0.35)",
    stroke: "#2b2230",
    weight: 1.4,
  });
}

interface Stroller {
  at: Vec2;
  coat: string;
  hat: string;
  /** Carries a basket on the near arm. */
  basket: boolean;
}

/** Small market-goers along the harbour edge, far behind the action. */
export function strollers(v: View): void {
  const folk: Stroller[] = [
    { at: [252, 352], coat: "#c0504d", hat: "#f2e6c9", basket: true },
    { at: [280, 350], coat: "#5b8ec9", hat: "#2f3f6b", basket: false },
    { at: [412, 354], coat: "#7fb069", hat: "#9c4a3c", basket: true },
  ];
  for (const [i, f] of folk.entries()) {
    const [x, y] = f.at;
    v.rect(x - 5, y - 12, 4, 12, { fill: "#3e4a6b" });
    v.rect(x + 1, y - 12, 4, 12, { fill: "#3e4a6b" });
    form(
      v,
      [
        [x - 8, y - 40],
        [x + 8, y - 40],
        [x + 11, y - 10],
        [x - 11, y - 10],
      ],
      {
        base: f.coat,
        shade: "#00000040",
        depth: 4,
        sharp: true,
        weight: 1.4,
        seed: 3700 + i,
      },
    );
    form(v, ring(x, y - 46, 6, 6), {
      base: "#f2c29a",
      shade: "#cf9670",
      depth: 2,
      weight: 1.2,
      seed: 3710 + i,
    });
    form(
      v,
      [
        [x - 8, y - 49],
        [x, y - 56],
        [x + 8, y - 49],
      ],
      {
        base: f.hat,
        shade: "#00000040",
        depth: 2,
        sharp: true,
        weight: 1.2,
        seed: 3720 + i,
      },
    );
    if (f.basket)
      form(
        v,
        [
          [x + 8, y - 26],
          [x + 20, y - 26],
          [x + 18, y - 17],
          [x + 10, y - 17],
        ],
        {
          base: "#c98b4f",
          shade: "#8c5a2c",
          depth: 2,
          sharp: true,
          weight: 1.2,
          seed: 3730 + i,
        },
      );
  }
}
