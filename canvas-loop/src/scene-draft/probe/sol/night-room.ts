import type { View } from "../../scene-api.js";

export const canvas = { width: 520, height: 480 };

export interface Model {
  frame: number;
  cameraX: number;
}

const ROOM_WIDTH = 920;

function wallPanels(v: View): void {
  v.rect(0, 0, ROOM_WIDTH, 315, { fill: "#394554" });
  for (let x = 0; x < ROOM_WIDTH; x += 92) {
    v.line(x, 0, x + 8, 314, {
      stroke: "#536073", weight: 13, brush: { preset: "bristle", load: 0.35 },
      gesture: { seed: x + 1 },
    });
  }
  v.rect(0, 312, ROOM_WIDTH, 168, { fill: "#4c4148" });
  for (let y = 327; y < 480; y += 23) {
    v.curve([[0, y], [230, y + 3], [480, y - 2], [ROOM_WIDTH, y + 2]], false, {
      stroke: "#6d5052", weight: 3, brush: "pencil",
    });
  }
  v.rect(0, 304, ROOM_WIDTH, 13, { fill: "#756472", material: { relief: 0.2, bevel: 3 } });
}

function window(v: View): void {
  v.group({ name: "moon window", effects: { glow: { blur: 27, color: "#94bdec", strength: 2 } } }, () => {
    v.roundRect(142, 66, 155, 172, 13, {
      fill: v.linearGradient(142, 70, 297, 240, [[0, "#bfd4e9"], [1, "#526c91"]]),
      material: { emissive: 0.78 },
    });
  });
  v.circle(251, 108, 24, { fill: "#ebeff1", material: { emissive: 1 } });
  for (let i = 0; i < 5; i += 1) {
    v.circle(163 + i * 24, 170 - (i % 3) * 19, 2, { fill: "#e6e2dc", material: { emissive: 0.4 } });
  }
  v.roundRect(138, 61, 163, 183, 12, { stroke: "#8c6d67", weight: 12, material: { castsShadow: true } });
  v.line(218, 67, 218, 234, { stroke: "#715d60", weight: 9, material: { castsShadow: true } });
  v.line(145, 154, 294, 154, { stroke: "#715d60", weight: 8, material: { castsShadow: true } });
  v.light({ kind: "spot", at: [228, 143], direction: Math.PI / 3, cone: Math.PI / 2,
    height: 96, reach: 280, energy: 0.9, color: "#a7c9ee" });
}

function lamp(v: View, frame: number): void {
  const flicker = 0.83 + 0.12 * Math.sin(frame * 0.21) + 0.05 * Math.sin(frame * 1.37);
  v.line(572, 0, 572, 75, { stroke: "#272d36", weight: 4 });
  v.path([["move", 540, 79], ["quad", 572, 54, 604, 79], ["line", 594, 102],
    ["quad", 572, 113, 550, 102], ["close"]], {
    fill: "#927b70", stroke: "#352e34", weight: 3,
    material: { relief: 0.6, bevel: 5, castsShadow: true },
  });
  v.group({ name: "lamp glass", effects: { glow: { blur: 22, color: "#ffc88d", strength: 3 } } }, () => {
    v.ellipse(572, 105, 13, 9, { fill: "#ffe1a4", material: { emissive: 1 } });
  });
  v.light({ kind: "point", at: [572, 104], height: 87, reach: 390,
    energy: 1.45 * flicker, color: "#ffd5a3" });
}

function furniture(v: View): void {
  v.group({ name: "heavy furniture", effects: { shadow: { x: 19, y: 18, blur: 12, color: "#211e2a99" } } }, () => {
    v.roundRect(342, 277, 219, 65, 9, {
      fill: "#775d5a", stroke: "#362f3b", weight: 3,
      material: { bevel: 7, relief: 0.66, shine: 0.22, castsShadow: true },
    });
    v.rect(360, 333, 17, 101, { fill: "#584047", material: { castsShadow: true } });
    v.rect(526, 333, 17, 101, { fill: "#584047", material: { castsShadow: true } });
    v.ellipse(435, 279, 38, 10, { fill: "#ac8c72", material: { bevel: 5, shine: 0.35 } });
    v.rect(714, 157, 139, 197, { fill: "#695559", material: { castsShadow: true } });
    v.rect(702, 146, 157, 22, { fill: "#94776b", material: { castsShadow: true } });
    for (let shelf = 0; shelf < 3; shelf += 1) {
      const y = 191 + shelf * 52;
      v.rect(724, y, 119, 7, { fill: "#9d7d71", material: { castsShadow: true } });
      for (let book = 0; book < 6; book += 1) {
        v.rect(730 + book * 17, y - 29 + (book % 3) * 3, 12, 29 - (book % 3) * 3, {
          fill: book % 3 === 0 ? "#a27a76" : book % 3 === 1 ? "#687c81" : "#aa8a6d",
          material: { relief: 0.25, bevel: 2 },
        });
      }
    }
  });
}

function seatedReader(v: View, frame: number): void {
  const breath = Math.sin(frame / 24) * 2;
  v.group({ name: "reader", effects: { shadow: { x: 11, y: 13, blur: 9, color: "#22213688" } } }, () => {
    v.ellipse(621, 396, 54, 17, { fill: "#443b4b" });
    v.curve([[575, 309], [608, 269 + breath], [645, 309], [655, 394], [570, 393]], true, {
      fill: "#6b7582", stroke: "#313745", weight: 3, brush: "ink",
      material: { relief: 0.45, bevel: 9, castsShadow: true },
    });
    v.ellipse(609, 258 + breath, 22, 28, { fill: "#b48872", material: { relief: 0.4, bevel: 6, castsShadow: true } });
    v.curve([[586, 260], [588, 228], [615, 225], [630, 247]], false, {
      stroke: "#302c39", weight: 17, brush: "bristle", gesture: { seed: 113 },
    });
    v.path([["move", 597, 327], ["line", 632, 330], ["line", 644, 353], ["line", 607, 348], ["close"]], {
      fill: "#c7ad8a", stroke: "#685b59", weight: 1.5,
    });
    v.line(623, 333, 623, 349, { stroke: "#a58b76", weight: 1 });
  });
}

export function draw(v: View, model: Model): void {
  v.background("#202a3a");
  const cameraX = Math.max(0, Math.min(ROOM_WIDTH - v.width, model.cameraX));
  v.at({ translate: [-cameraX, 0] }, () => {
    v.group({ name: "watercolour room", lighting: { ambient: "#30374a", shadows: "soft" },
      effects: { wash: { granulate: 0.54, edges: 0.36, blotch: 0.3, bleed: 3 }, paper: 0.44 } }, () => {
      v.paper({ scale: 4.5, contrast: 0.72, seed: 47 });
      wallPanels(v);
      window(v);
      lamp(v, model.frame);
      furniture(v);
      seatedReader(v, model.frame);
      v.curve([[22, 430], [238, 443], [478, 432], [701, 445], [ROOM_WIDTH, 430]], false, {
        stroke: "#9b7182", weight: 30, brush: { preset: "wash", opacity: 0.2 },
        gesture: { seed: 91 },
      });
    });
  });
}
