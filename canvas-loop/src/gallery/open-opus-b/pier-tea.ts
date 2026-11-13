// The boardwalk out from the village, its posts, and the lamps along it.
import type { Style, Vec2, View } from "@ianbicking/canvas-loop";

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
export const LIT_LAMPS: readonly Lamp[] = [
  lampAt(300, 285 * depth(300)),
  lampAt(430, 285 * depth(430)),
];

const WOOD = {
  deck: "#8c6b70",
  deckLit: "#c4917a",
  beam: "#3f2b38",
  post: "#2e2131",
  plank: "#5a4150",
} as const;

export function drawWalkway(v: View): void {
  // Posts down into the water, with short dark reflections.
  const post: Style = {
    brush: "ink",
    gesture: { pressure: "even", wobble: 0.8 },
  };
  for (let x = X0 + 30; x <= X1; x += 62) {
    const k = depth(x);
    const y0 = deckFront(x);
    v.line(x, y0, x, y0 + 50 * k, {
      ...post,
      stroke: WOOD.post,
      weight: 9 * k,
    });
    v.line(x, y0 + 50 * k, x + 1, y0 + 90 * k, {
      ...post,
      stroke: "rgba(30,24,50,0.45)",
      weight: 7 * k,
    });
  }
  // Deck surface.
  const deck: Vec2[] = [
    [X0, deckTop(X0)],
    [X1, deckTop(X1)],
    [X1, deckFront(X1)],
    [X0, deckFront(X0)],
  ];
  v.polygon(deck, {
    fill: v.linearGradient(X0, 0, X1, 0, [
      [0, WOOD.deck],
      [1, WOOD.deckLit],
    ]),
  });
  // Side beam under the front edge.
  v.polygon(
    [
      [X0, deckFront(X0)],
      [X1, deckFront(X1)],
      [X1, deckFront(X1) + 16],
      [X0, deckFront(X0) + 5],
    ],
    { fill: WOOD.beam },
  );
  // Plank seams, over brushed wood grain.
  v.clip(deck, () => {
    const grain: Style = {
      weight: 5,
      brush: {
        preset: "bristle",
        bristles: 9,
        load: 0.9,
        flow: 0.4,
        spread: 0.6,
      },
      gesture: { pressure: "taper", wobble: 0.6 },
    };
    for (let i = 0; i < 6; i += 1) {
      const f = (i + 0.5) / 6;
      v.line(
        X0,
        deckTop(X0) + f * (deckFront(X0) - deckTop(X0)),
        X1,
        deckTop(X1) + f * (deckFront(X1) - deckTop(X1)),
        {
          ...grain,
          stroke: i % 2 === 0 ? "#6e5060" : "#d8a585",
        },
      );
    }
    const seam: Style = {
      stroke: WOOD.plank,
      brush: { preset: "pencil", opacity: 0.8 },
      gesture: { pressure: "even", wobble: 0.4 },
    };
    for (let x = X0 + 8; x < X1; x += 5 + 16 * depth(x)) {
      v.line(x, deckTop(x) - 2, x + 6 * depth(x), deckFront(x) + 2, {
        ...seam,
        weight: 1.5 + 1.5 * depth(x),
      });
    }
  });
}

export function drawLantern(v: View, lamp: Lamp, main: boolean): void {
  const { x, hx, hy, k } = lamp;
  const base = deckTop(x);
  const top = base - lamp.height;
  // Reflection of the light in the water.
  v.line(hx, deckFront(x) + 24 * k, hx + 2, deckFront(x) + 170 * k, {
    stroke: "#ffcf7a",
    weight: 26 * k,
    brush: { preset: "wash", opacity: 0.5 },
    gesture: { pressure: "taper-out", wobble: 4 },
  });
  // Glow, and a pool of light on the deck below.
  const r = (main ? 230 : 150) * k;
  v.circle(hx, hy + 26 * k, r, {
    fill: v.radialGradient(hx, hy + 26 * k, r, [
      [0, "rgba(255,222,140,0.85)"],
      [0.18, "rgba(255,196,112,0.45)"],
      [0.55, "rgba(255,170,100,0.12)"],
      [1, "rgba(255,170,100,0)"],
    ]),
  });
  if (main) {
    v.circle(hx, hy + 28 * k, (92 * k) / 2, {
      fill: v.radialGradient(hx, hy + 28 * k, 46 * k, [
        [0, "rgba(255,246,210,0.95)"],
        [0.5, "rgba(255,226,150,0.5)"],
        [1, "rgba(255,210,130,0)"],
      ]),
    });
  }
  v.ellipse(hx, (deckTop(x) + deckFront(x)) / 2, (220 * k) / 2, (50 * k) / 2, {
    fill: v.ellipseGradient(
      hx,
      (deckTop(x) + deckFront(x)) / 2,
      (220 * k) / 2,
      (50 * k) / 2,
      [
        [0, "rgba(255,210,140,0.6)"],
        [1, "rgba(255,190,120,0)"],
      ],
    ),
  });
  // Post and arm.
  const pole: Style = {
    stroke: WOOD.post,
    brush: "ink",
    gesture: { pressure: "even", wobble: 0.5 },
  };
  v.line(x, base + 2, x, top, { ...pole, weight: 8 * k });
  v.line(x + 3 * k, top + 2 * k, hx - 4 * k, top + 2 * k, {
    ...pole,
    weight: 4 * k,
  });
  v.line(hx, top + 2 * k, hx, hy + 6 * k, { ...pole, weight: 2 * k });
  // Lantern: cap, glass, base.
  v.polygon(
    [
      [hx - 11 * k, hy + 14 * k],
      [hx + 11 * k, hy + 14 * k],
      [hx + 9 * k, hy + 40 * k],
      [hx - 9 * k, hy + 40 * k],
    ],
    { fill: "#ffe2a0" },
  );
  v.ellipse(hx, hy + 30 * k, (8 * k) / 2, (14 * k) / 2, { fill: "#fff6d6" });
  v.triangle(
    hx - 15 * k,
    hy + 15 * k,
    hx + 15 * k,
    hy + 15 * k,
    hx,
    hy + 4 * k,
    { fill: "#2a1e2e" },
  );
  v.rect(hx - 11 * k, hy + 39 * k, 22 * k, 5 * k, { fill: "#2a1e2e" });
  v.line(hx, hy + 15 * k, hx, hy + 40 * k, {
    stroke: "#2a1e2e",
    weight: 1.6 * k,
  });
}
