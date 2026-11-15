import type { View } from "../../scene-api.js";

export const canvas = { width: 540, height: 350 };

export interface Model {
  frame: number;
}

interface Vendor {
  x: number;
  apron: string;
  skin: string;
  canopy: string;
  name: string;
}

const VENDORS = [
  { x: 62, apron: "#a74446", skin: "#a97157", canopy: "#be714f", name: "PEARS" },
  { x: 221, apron: "#446d79", skin: "#c68e69", canopy: "#7b5e87", name: "FLOWERS" },
  { x: 380, apron: "#b68a3d", skin: "#785044", canopy: "#b0525b", name: "BREAD" },
] as const satisfies readonly Vendor[];

function drawVendor(v: View, look: { apron: string; skin: string }): void {
  const { apron, skin } = look;
  v.paper({ scale: 3.8, contrast: 0.64, seed: 20 });
  v.ellipse(39, 97, 34, 10, { fill: "#715c50" });
  v.path([["move", 18, 53], ["quad", 39, 43, 60, 53], ["line", 66, 102], ["line", 10, 102], ["close"]], {
    fill: apron, stroke: "#533b3e", weight: 2, brush: "ink",
  });
  v.curve([[14, 64], [24, 75], [29, 101]], false, {
    stroke: "#e4aa8b", weight: 11, brush: { preset: "bristle", load: 0.7 },
  });
  v.curve([[61, 64], [54, 77], [50, 101]], false, {
    stroke: "#e4aa8b", weight: 11, brush: { preset: "bristle", load: 0.7 },
  });
  v.ellipse(38, 30, 18, 23, { fill: skin, stroke: "#64443e", weight: 1.8, brush: "ink" });
  v.curve([[20, 27], [23, 12], [38, 9], [54, 20]], false, {
    stroke: "#342d33", weight: 12, brush: { preset: "bristle", load: 0.84 },
  });
  v.circle(32, 30, 1.4, { fill: "#2f282a" });
  v.circle(45, 30, 1.4, { fill: "#2f282a" });
  v.curve([[34, 42], [39, 44], [45, 41]], false, { stroke: "#673f43", weight: 1.4, brush: "ink" });
  v.curve([[23, 60], [36, 65], [51, 59]], false, {
    stroke: "#f2d9bc", weight: 3, brush: "chalk", gesture: { seed: 31 },
  });
}

function drawStall(v: View, stall: { vendor: Vendor; index: number }): void {
  const { vendor, index } = stall;
  const { x, canopy, name } = vendor;
  v.rect(x + 12, 91, 5, 173, { fill: "#5b4541" });
  v.rect(x + 126, 91, 5, 173, { fill: "#5b4541" });
  v.path([["move", x, 99], ["line", x + 145, 99], ["line", x + 130, 147], ["line", x + 15, 147], ["close"]], {
    fill: canopy, stroke: "#5c3b3d", weight: 2, brush: "ink",
  });
  for (let stripe = 0; stripe < 5; stripe += 1) {
    const sx = x + 17 + stripe * 23;
    v.line(sx, 105, sx + 6, 139, {
      stroke: "#f1d2a6", weight: 8, brush: { preset: "bristle", load: 0.56 },
      gesture: { seed: stripe + 12 },
    });
  }
  v.rect(x + 4, 241, 137, 15, { fill: "#684b3e", material: { relief: 0.3, bevel: 4, castsShadow: true } });
  v.rect(x + 11, 255, 123, 50, { fill: "#a57951", stroke: "#5b4039", weight: 2, brush: "ink" });
  for (let n = 0; n < 7; n += 1) {
    const px = x + 23 + n * 16;
    const color = index === 0 ? "#c9ab58" : index === 1 ? "#bf6872" : "#d4a66d";
    v.ellipse(px, 237 - (n % 2) * 7, 8, 10, { fill: color, stroke: "#846044", weight: 1, brush: "pencil" });
    if (index === 1) v.line(px, 231, px, 243, { stroke: "#627850", weight: 2, brush: "ink" });
  }
  v.text(name, { x: x + 72, y: 274 }, {
    align: "center", valign: "middle", size: 13, style: "bold", fill: "#f9e9c7",
  });
}

export function draw(v: View, model: Model): void {
  v.background("#e9d9bb");
  v.group({ name: "market watercolour", lighting: { ambient: "#9b91a1", shadows: "soft" }, effects: {
    wash: { granulate: 0.48, edges: 0.55, blotch: 0.25, bleed: 3 }, paper: 0.42,
  } }, () => {
    v.paper({ scale: 4.2, contrast: 0.74, seed: 8 });
    v.rect(0, 0, v.width, 197, { fill: "#d3b7a2" });
    for (let i = 0; i < 9; i += 1) {
      v.rect(i * 62 - 8, 18 + (i % 3) * 9, 42, 136, { fill: "#c7a894" });
      v.line(i * 62 + 8, 37, i * 62 + 30, 37, { stroke: "#ab827d", weight: 10, brush: "wash" });
    }
    v.rect(0, 195, v.width, v.height - 195, { fill: "#b7a393" });
    v.curve([[0, 193], [170, 201], [340, 190], [v.width, 199]], false, {
      stroke: "#927978", weight: 24, brush: { preset: "wash", opacity: 0.38 },
    });
    for (const [index, vendor] of VENDORS.entries()) {
      drawStall(v, { vendor, index });
      const person = v.picture({ key: "market-vendor", width: 78, height: 106,
        deps: [vendor.apron, vendor.skin] }, () => drawVendor(v, { apron: vendor.apron, skin: vendor.skin }));
      const breath = Math.sin(model.frame / 23 + index) * 1.8;
      v.at({ translate: [vendor.x + 35, 143 + breath], rotate: Math.sin(model.frame / 60 + index) * 0.015 }, () => {
        v.place(person, 0, 0);
      });
    }
    const wave = Math.sin(model.frame / 10) * 8;
    v.curve([[VENDORS[1].x + 92, 212], [VENDORS[1].x + 105, 191], [VENDORS[1].x + 112 + wave, 171]], false, {
      stroke: "#c68e69", weight: 11, brush: "bristle", gesture: { seed: 51 },
    });
    v.circle(VENDORS[1].x + 112 + wave, 168, 7, { fill: "#c68e69" });
    v.line(VENDORS[2].x + 107, 187, VENDORS[2].x + 109, 224, {
      stroke: "#684832", weight: 3, brush: "ink",
    });
    v.group({ name: "vendor lantern", effects: { glow: { blur: 18, color: "#ffb34f", strength: 3 } } }, () => {
      v.roundRect(VENDORS[2].x + 97, 203, 23, 34, 5, { fill: "#68483d", stroke: "#f4c16e", weight: 2 });
      v.path([["move", VENDORS[2].x + 105, 230], ["quad", VENDORS[2].x + 100, 217, VENDORS[2].x + 110, 209],
        ["quad", VENDORS[2].x + 119, 221, VENDORS[2].x + 110, 231], ["close"]], {
        fill: "#ffe49c", material: { emissive: 1 },
      });
    });
    v.light({ kind: "point", at: [VENDORS[2].x + 110, 221], height: 30, reach: 142,
      energy: 1.4, color: "#ffcb79" });
  });
}
