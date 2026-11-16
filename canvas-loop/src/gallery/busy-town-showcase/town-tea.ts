// The still parts of Thimble Quay, painted once into pictures: the sky, the far
// hills with the windmill's tower, the row of shops, the street and the canal.
import type { BrushPreset, Drawing, PathCommand, Style, TextOptions, Vec2, View } from "@ianbicking/canvas-loop";
import { INK, blob, hash, ink, rectPts, shade, stroke } from "./ink-tea.js";
import { BASE, BUILDINGS, type Building, CANAL_TOP, CLOCK, H, HALL, LAMPS, LAMP_H, LEDGE_Y, MILL, RAIL_Y, ROAD_BOT, ROAD_TOP, SHOP_H, TOWER, W, WINDOWS, WIRE_Y, type Win } from "./layout-tea.js";

const PENCIL: BrushPreset = { preset: "pencil", opacity: 0.55 };
const SIGN_FONT = "Georgia, 'Times New Roman', serif";

// --- Sky and hills ---------------------------------------------------------------

export function paintSky(v: View): Drawing {
  return [
    v.rect(0, 0, W, 360, { fill: v.linearGradient(0, 0, 0, 340, [[0, "#7fb3d8"], [0.55, "#b9d6e6"], [1, "#f1e6cf"]]) }),
    // Broad wet strokes of blue, so the sky looks painted, not printed.
    [0, 1, 2, 3, 4, 5].map((i) => v.line(-30, 30 + i * 46, W + 30, 20 + i * 48 + hash(i, 1, 3) * 20, { stroke: i < 3 ? "#6aa2cc" : "#d9e6ea", weight: 50, brush: { preset: "wash", opacity: 0.32 }, gesture: { seed: 40 + i, wobble: 8, faint: true } })),
  ];
}

/** A soft cumulus: a few overlapping airbrushed lobes with a shaded belly. */
export function paintCloud(v: View, seed: number, w: number): Drawing {
  const lobes = 5;
  return [
    Array.from({ length: lobes }, (_, i) => {
      const x = w * (0.15 + (i / (lobes - 1)) * 0.7);
      const r = w * (0.13 + hash(seed, i, 1) * 0.09) * (i === 2 ? 1.3 : 1);
      return v.circle(x, w * 0.32 - r * 0.4 + hash(seed, i, 2) * 6, r, { fill: "#fbfaf4" });
    }),
    v.ellipse(w * 0.5, w * 0.36, w * 0.42, w * 0.08, { fill: "#fbfaf4" }),
    v.line(w * 0.12, w * 0.4, w * 0.88, w * 0.4, { stroke: "#b7c6d6", weight: w * 0.08, brush: { preset: "wash", opacity: 0.55 }, gesture: { seed, faint: true } }),
  ];
}

export function paintHills(v: View): Drawing {
  const far: Vec2[] = [[0, 250], [120, 214], [260, 236], [420, 206], [560, 222], [640, 200], [760, 226], [900, 204], [W, 222], [W, 440], [0, 440]];
  const near: Vec2[] = [[0, 290], [160, 268], [340, 286], [520, 262], [700, 280], [880, 262], [W, 272], [W, 440], [0, 440]];
  const roofs = Array.from({ length: 26 }, (_, i) => {
    const x = 20 + i * 36 + hash(i, 2, 7) * 20;
    const y = 266 + hash(i, 3, 7) * 22;
    return [
      v.rect(x, y, 10, 8, { fill: hash(i, 4, 7) < 0.5 ? "#e8dccb" : "#d9c2b0" }),
      v.triangle(x - 2, y, x + 5, y - 6, x + 12, y, { fill: hash(i, 5, 7) < 0.6 ? "#b86a52" : "#6f7d93" }),
    ];
  });
  const trees = Array.from({ length: 40 }, (_, i): Drawing => {
    const x = hash(i, 9, 2) * W, y = 250 + hash(i, 8, 2) * 40;
    return v.circle(x, y, 4 + hash(i, 7, 2) * 4, { fill: hash(i, 6, 2) < 0.5 ? "#7f9e6a" : "#6b8c5e" });
  });
  return [
    v.group({ effects: { wash: { edges: 0.4, blotch: 0.3, granulate: 0.5 }, blur: 0.6 } }, [
      v.curve(far, false, { fill: "#a9bfa7" }),
      v.curve(near, false, { fill: "#8fae86" }),
      trees,
      roofs,
    ]),
    // The windmill's tower; its sails turn in the live layer.
    blob(v, [[MILL.x - 13, MILL.y + 44], [MILL.x - 8, MILL.y - 2], [MILL.x + 8, MILL.y - 2], [MILL.x + 13, MILL.y + 44]], { fill: "#efe3cf", dark: "#c9b79c", seed: 61, line: 1.6 }),
    blob(v, [[MILL.x - 11, MILL.y], [MILL.x, MILL.y - 14], [MILL.x + 11, MILL.y]], { fill: "#8a4a3a", seed: 62, line: 1.4 }),
    v.rect(MILL.x - 3, MILL.y + 30, 6, 14, { fill: "#5b4636" }),
  ];
}

// --- The row of shops ----------------------------------------------------------

function brickHints(v: View, b: Building): Drawing {
  const cmds: PathCommand[] = [];
  for (let k = 0; k < 9; k++) {
    const x = b.x + 8 + hash(b.x, k, 11) * (b.w - 30), y = b.top + 30 + hash(b.x, k, 12) * (BASE - b.top - 140);
    for (let r = 0; r < 3; r++) {
      const off = r % 2 === 0 ? 0 : 5;
      cmds.push(["move", x + off, y + r * 5], ["line", x + off + 9, y + r * 5]);
    }
  }
  return v.path(cmds, { stroke: shade(b.wall, -0.35), weight: 1, brush: PENCIL, gesture: { seed: b.x, faint: true } });
}

function wallOutline(b: Building): Vec2[] {
  const { x, w, top } = b;
  if (b.roof === "step") {
    const s = w / 6;
    return [[x, BASE], [x, top + 30], [x + s, top + 30], [x + s, top + 14], [x + 2 * s, top + 14], [x + 2 * s, top - 2], [x + 4 * s, top - 2], [x + 4 * s, top + 14], [x + 5 * s, top + 14], [x + 5 * s, top + 30], [x + w, top + 30], [x + w, BASE]];
  }
  return rectPts(x, top, w, BASE - top);
}

function roof(v: View, b: Building, seed: number): Drawing {
  const { x, w, top } = b;
  switch (b.roof) {
    case "gable":
    case "steep": {
      const peak = b.roof === "gable" ? top - 54 : top - 78;
      const tri: Vec2[] = [[x - 8, top + 2], [x + w / 2, peak], [x + w + 8, top + 2]];
      const rows = Array.from({ length: 6 }, (_, r) => {
        const t = (r + 0.6) / 6;
        const y = peak + (top - peak) * t;
        const half = (w / 2 + 8) * t;
        return v.line(x + w / 2 - half + 4, y, x + w / 2 + half - 4, y, { stroke: shade(b.roofColour, -0.3), weight: 4, brush: { preset: "bristle", load: 0.6, lightJitter: 0.06 }, gesture: { seed: seed + r, wobble: 1 } });
      });
      const chim = b.roof === "gable" && [
        blob(v, rectPts(x + w * 0.7, peak + 4, 16, 38), { fill: "#a85a44", dark: "#7a3a2a", seed: seed + 9, line: 1.6 }),
        v.rect(x + w * 0.7 - 3, peak, 22, 6, { fill: "#6b3a2c" }),
      ];
      const roundel = b.roof === "steep" && [
        v.circle(x + w / 2, top - 32, 9, { fill: "#2f3a4e" }),
        v.circle(x + w / 2, top - 32, 9, ink(seed + 4, 1.6)),
      ];
      return [chim, blob(v, tri, { fill: b.roofColour, light: shade(b.roofColour, 0.25), seed, line: 2 }), v.clip(tri, rows), roundel];
    }
    case "flat":
      return [
        blob(v, rectPts(x - 6, top - 10, w + 12, 14), { fill: b.trim, dark: shade(b.trim, -0.15), seed, line: 1.8 }),
        v.line(x - 4, top + 6, x + w + 4, top + 6, { stroke: shade(b.wall, -0.4), weight: 3, brush: { preset: "wash", opacity: 0.5 }, gesture: { seed: seed + 1, faint: true } }),
      ];
    case "mansard": {
      const shape: Vec2[] = [[x - 4, top + 34], [x + 10, top - 16], [x + w - 10, top - 16], [x + w + 4, top + 34]];
      const dormers = [0.28, 0.72].map((f, i) => {
        const cx = x + w * f;
        return [
          blob(v, [[cx - 14, top + 28], [cx - 14, top - 2], [cx, top - 14], [cx + 14, top - 2], [cx + 14, top + 28]], { fill: b.trim, seed: seed + 3 + i, line: 1.6 }),
          v.rect(cx - 8, top + 2, 16, 22, { fill: "#2f3a4e" }),
        ];
      });
      return [blob(v, shape, { fill: b.roofColour, light: shade(b.roofColour, 0.2), seed, line: 2 }), dormers];
    }
    case "step":
      return blob(v, rectPts(x + w / 3, top - 8, w / 3, 8), { fill: b.roofColour, seed, line: 1.4 });
  }
}

export function windowPane(v: View, w: Win, trim: string): Drawing {
  const seed = 300 + w.i;
  const glass = blob(v, rectPts(w.x, w.y, w.w, w.h), { fill: "#33405a", dark: "#232c40", seed, line: 1.6, amp: 0.7 });
  return [
    blob(v, rectPts(w.x - 3, w.y - 3, w.w + 6, w.h + 6), { fill: trim, seed: seed + 1000, line: 0, amp: 0.6 }),
    glass,
    v.line(w.x + 3, w.y + w.h * 0.65, w.x + w.w * 0.6, w.y + 3, { stroke: "rgba(255,255,255,0.35)", weight: 2.5, brush: "chalk", gesture: { seed, faint: true } }),
  ];
}

export function windowBars(v: View, w: Win, trim: string): Drawing {
  const seed = 300 + w.i;
  const shutters = hash(w.i, 1, 21) < 0.35;
  const box = hash(w.i, 2, 21) < 0.45;
  return [
    v.line(w.x + w.w / 2, w.y + 1, w.x + w.w / 2, w.y + w.h - 1, { stroke: trim, weight: 2.2 }),
    v.line(w.x + 1, w.y + w.h * 0.45, w.x + w.w - 1, w.y + w.h * 0.45, { stroke: trim, weight: 2.2 }),
    blob(v, rectPts(w.x - 5, w.y + w.h, w.w + 10, 4), { fill: trim, seed: seed + 2000, line: 1.2, amp: 0.4 }),
    shutters && [-1, 1].map((s) => blob(v, rectPts(s < 0 ? w.x - 13 : w.x + w.w + 3, w.y - 1, 10, w.h + 2), { fill: hash(w.b, 3, 21) < 0.5 ? "#4f7f6a" : "#3f5f8f", dark: "#2c3b48", seed: seed + 3000 + s, line: 1.2, amp: 0.5 })),
    box && [
      blob(v, rectPts(w.x - 3, w.y + w.h + 3, w.w + 6, 6), { fill: "#8a5a3a", seed: seed + 4000, line: 1.2, amp: 0.4 }),
      Array.from({ length: 6 }, (_, k) => v.circle(w.x - 1 + k * ((w.w + 2) / 5), w.y + w.h + 1 + hash(w.i, k, 23) * 3, 2.6, { fill: ["#e2504a", "#f2c14e", "#f08fb0", "#ffffff"][k % 4] ?? "#e2504a" })),
      v.line(w.x - 2, w.y + w.h + 3, w.x + w.w + 2, w.y + w.h + 3, { stroke: "#4c7a3a", weight: 3, brush: { preset: "chalk", opacity: 0.8 }, gesture: { seed: seed + 5000 } }),
    ],
  ];
}

const SIGN_TEXT = (b: Building, size: number): TextOptions => ({ size, font: SIGN_FONT, style: "bold italic", fill: b.signInk, align: "center", valign: "middle" });

function goods(v: View, b: Building, x: number, y: number, w: number, h: number): Drawing {
  const n = 5;
  const items = Array.from({ length: n }, (_, i) => [x + (w / n) * (i + 0.5), y + h * 0.72] as const);
  switch (b.id) {
    case "bakery":
      return items.map(([cx, cy], i) => [
        v.ellipse(cx, cy, 8, 5, { fill: i % 2 === 0 ? "#c98a4a" : "#e0aa5e", stroke: "#6b3d1e", weight: 1 }),
        v.ellipse(cx, cy - 12, 6, 4, { fill: "#d9a05a", stroke: "#6b3d1e", weight: 1 }),
      ]);
    case "books":
      return Array.from({ length: 14 }, (_, i) => v.rect(x + 4 + i * ((w - 8) / 14), y + h - 22 - hash(i, 1, 31) * 8, (w - 8) / 14 - 1.5, 22 + hash(i, 1, 31) * 8, { fill: ["#b4473f", "#3f6fa0", "#d9a94a", "#4f8a5a", "#7a4a8a"][i % 5] ?? "#b4473f" }));
    case "cafe":
      return items.map(([cx, cy]) => [v.roundRect(cx - 5, cy - 6, 10, 9, 2, { fill: "#fbf3e3", stroke: "#6b4a3a", weight: 1 }), v.circle(cx, cy - 16, 3, { fill: "#c74f4f" })]);
    case "fish":
      return items.map(([cx, cy], i) => v.ellipse(cx, cy - (i % 2) * 10, 9, 3.5, { fill: i % 2 === 0 ? "#9fb4c4" : "#d88a6a", stroke: "#2c3b48", weight: 1 }));
    case "florist":
      return Array.from({ length: 16 }, (_, i) => v.circle(x + 6 + hash(i, 2, 33) * (w - 12), y + 10 + hash(i, 3, 33) * (h - 20), 3.5, { fill: ["#e2504a", "#f2c14e", "#f08fb0", "#ffffff", "#9b6fd0"][i % 5] ?? "#fff" }));
    default:
      return null;
  }
}

/** A shop's striped awning. With `cut`, every piece is drawn in that style instead
 * (the light layer uses it to cut the awning's shape out of window light). */
function awning(v: View, b: Building, seed: number, cut?: Style): Drawing {
  const colours: Record<string, readonly [string, string]> = { cafe: ["#c9413a", "#fbefdf"], fish: ["#2f6d8a", "#eaf3f6"], florist: ["#4f7f3a", "#f6f1dc"] };
  const pair = colours[b.id];
  if (!pair) return null;
  const y = BASE - SHOP_H + 2, x = b.x + 4, w = b.w - 8, drop = 26;
  const stripes = 8;
  const fill = (i: number): Style => cut ?? { fill: i % 2 === 0 ? pair[0] : pair[1] };
  return [
    Array.from({ length: stripes }, (_, i) => {
      const x0 = x + (w / stripes) * i, x1 = x0 + w / stripes;
      return v.polygon([[x0 - 1, y - 1], [x1 + 1, y - 1], [x1 + 5, y + drop], [x0 + 3, y + drop]], fill(i));
    }),
    Array.from({ length: stripes }, (_, i) => v.arc(x + 4 + (w / stripes) * (i + 0.5), y + drop, w / stripes / 2 + (cut ? 1 : 0), 0, Math.PI, fill(i))),
    !cut && stroke(v, [[x, y], [x + w, y]], { seed, weight: 1.6 }),
    !cut && stroke(v, [[x + 4, y + drop], [x + w + 4, y + drop]], { seed: seed + 1, weight: 1.2 }),
  ];
}

function shopFront(v: View, b: Building, seed: number): Drawing {
  const y0 = BASE - SHOP_H;
  const doorW = 26, doorX = b.id === "house" ? b.x + b.w / 2 - doorW / 2 : b.x + b.w - doorW - 12;
  const winX = b.x + 10, winW = b.id === "house" ? 0 : doorX - winX - 10;
  const signY = y0 - 24;
  return [
    b.sign !== "" && [
      blob(v, rectPts(b.x + 6, signY, b.w - 12, 20), { fill: b.signFill, light: shade(b.signFill, 0.2), seed: seed + 1, line: 1.6 }),
      v.text(b.sign, { x: b.x + b.w / 2, y: signY + 10.5 }, SIGN_TEXT(b, 13)),
    ],
    winW > 0 && [
      blob(v, rectPts(winX - 3, y0 + 14, winW + 6, SHOP_H - 26), { fill: b.trim, seed: seed + 2, line: 1.4, amp: 0.6 }),
      blob(v, rectPts(winX, y0 + 17, winW, SHOP_H - 34), { fill: "#e9e2cf", light: "#fffaf0", dark: "#c9c0a8", seed: seed + 3, line: 1.6, amp: 0.6 }),
      goods(v, b, winX, y0 + 17, winW, SHOP_H - 34),
      v.line(winX + 4, y0 + 46, winX + winW * 0.45, y0 + 20, { stroke: "rgba(255,255,255,0.6)", weight: 4, brush: "chalk", gesture: { seed: seed + 4, faint: true } }),
    ],
    blob(v, [[doorX, BASE], [doorX, y0 + 22], [doorX + doorW / 2, y0 + 12], [doorX + doorW, y0 + 22], [doorX + doorW, BASE]], { fill: shade(b.roofColour, 0.05), dark: shade(b.roofColour, -0.3), seed: seed + 5, line: 1.8, amp: 0.5 }),
    v.circle(doorX + doorW - 6, BASE - 34, 1.8, { fill: "#e8c060" }),
    v.rect(doorX - 3, BASE - 4, doorW + 6, 4, { fill: "#8a7f72" }),
    awning(v, b, seed + 6),
  ];
}

function building(v: View, b: Building, bi: number): Drawing {
  const seed = 100 + bi * 37;
  const wins = WINDOWS.filter((w) => w.b === bi);
  return [
    roof(v, b, seed + 20),
    blob(v, wallOutline(b), { fill: b.wall, light: shade(b.wall, 0.25), dark: shade(b.wall, -0.18), seed, line: 2.2 }),
    brickHints(v, b),
    // A band of shade under the eaves and a plinth at the foot.
    v.line(b.x + 2, BASE - SHOP_H - 6, b.x + b.w - 2, BASE - SHOP_H - 6, { stroke: shade(b.wall, -0.3), weight: 5, brush: { preset: "wash", opacity: 0.6 }, gesture: { seed: seed + 3, faint: true } }),
    v.rect(b.x, BASE - 8, b.w, 8, { fill: shade(b.wall, -0.45) }),
    wins.map((w) => windowPane(v, w, b.trim)),
    wins.map((w) => windowBars(v, w, b.trim)),
    shopFront(v, b, seed + 40),
  ];
}

function hallAndTower(v: View): Drawing {
  const t = TOWER, hl = HALL;
  const stone = "#ddd0b6";
  const blocks: PathCommand[] = [];
  for (let y = t.top + 20; y < hl.top; y += 12) {
    blocks.push(["move", t.x + 3, y], ["line", t.x + t.w - 3, y]);
    const off = (y / 12) % 2 < 1 ? 0 : 10;
    for (let x = t.x + 10 + off; x < t.x + t.w - 4; x += 20) blocks.push(["move", x, y], ["line", x, y + 12]);
  }
  const spire: Vec2[] = [[t.x - 6, t.top + 2], [t.x + t.w / 2, t.top - t.spire - 40], [t.x + t.w + 6, t.top + 2]];
  return [
    // The hall: a stone front with columns and a wide door.
    blob(v, rectPts(hl.x, hl.top, hl.w, BASE - hl.top), { fill: stone, light: "#efe6d2", dark: "#c2b291", seed: 501, line: 2.2 }),
    blob(v, [[hl.x - 6, hl.top + 4], [hl.x + hl.w / 2, hl.top - 22], [hl.x + hl.w + 6, hl.top + 4]], { fill: "#e9dfca", dark: "#bfae8c", seed: 502, line: 2 }),
    [0, 1, 2, 3].map((i) => blob(v, rectPts(hl.x + 10 + i * 24, hl.top + 30, 9, BASE - hl.top - 40), { fill: "#f1e9d8", dark: "#c9b99a", seed: 510 + i, line: 1.4, amp: 0.5 })),
    blob(v, [[hl.x + 38, BASE], [hl.x + 38, BASE - 50], [hl.x + 50, BASE - 62], [hl.x + 62, BASE - 50], [hl.x + 62, BASE]], { fill: "#5a3a2e", dark: "#3a241c", seed: 520, line: 1.8 }),
    v.text("TOWN HALL", { x: hl.x + hl.w / 2, y: hl.top + 18 }, { size: 9, font: SIGN_FONT, style: "bold", fill: "#5a4a36", align: "center", valign: "middle" }),
    // The tower.
    blob(v, rectPts(t.x, t.top, t.w, hl.top - t.top), { fill: stone, light: "#f3ecdc", dark: "#bcaa88", seed: 530, line: 2.2 }),
    v.clip(rectPts(t.x, t.top, t.w, hl.top - t.top), [v.path(blocks, { stroke: "#a8987a", weight: 1, brush: PENCIL, gesture: { seed: 531, faint: true } })]),
    // The belfry: an arch with the bell in it.
    blob(v, [[t.x + 16, t.top + 50], [t.x + 16, t.top + 22], [t.x + t.w / 2, t.top + 10], [t.x + t.w - 16, t.top + 22], [t.x + t.w - 16, t.top + 50]], { fill: "#2a2430", seed: 532, line: 1.8 }),
    // The ledge the pigeons sit on.
    blob(v, rectPts(t.x - 6, LEDGE_Y - 2, t.w + 12, 8), { fill: "#efe6d2", dark: "#bcaa88", seed: 533, line: 1.6 }),
    blob(v, spire, { fill: "#4f8078", light: "#6fa098", dark: "#355a54", seed: 534, line: 2.2 }),
    v.clip(spire, [1, 2, 3, 4, 5].map((r) => v.line(t.x - 6, t.top - r * 14, t.x + t.w + 6, t.top - r * 14 + 2, { stroke: "#355a54", weight: 2, brush: { preset: "bristle", load: 0.5 }, gesture: { seed: 540 + r } }))),
    stroke(v, [[t.x + t.w / 2, t.top - t.spire - 40], [t.x + t.w / 2, t.top - t.spire - 58]], { seed: 535, weight: 1.6 }),
    v.polygon([[t.x + t.w / 2, t.top - t.spire - 58], [t.x + t.w / 2 + 14, t.top - t.spire - 54], [t.x + t.w / 2, t.top - t.spire - 50]], { fill: "#d9a94a", stroke: INK, weight: 1 }),
    // The clock face.
    v.circle(CLOCK.x, CLOCK.y, CLOCK.r + 5, { fill: "#4a3a2a" }),
    v.circle(CLOCK.x, CLOCK.y, CLOCK.r, { fill: "#fbf3df" }),
    Array.from({ length: 12 }, (_, i) => {
      const a = (i / 12) * Math.PI * 2;
      const r0 = i % 3 === 0 ? CLOCK.r - 6 : CLOCK.r - 4;
      return v.line(CLOCK.x + Math.cos(a) * r0, CLOCK.y + Math.sin(a) * r0, CLOCK.x + Math.cos(a) * (CLOCK.r - 2), CLOCK.y + Math.sin(a) * (CLOCK.r - 2), { stroke: "#3a2a1a", weight: i % 3 === 0 ? 2 : 1 });
    }),
    v.circle(CLOCK.x, CLOCK.y, CLOCK.r + 5, ink(536, 2)),
  ];
}

// --- Street, quay and canal ----------------------------------------------------

function street(v: View): Drawing {
  const flags: PathCommand[] = [];
  for (let x = 0; x < W; x += 34) flags.push(["move", x + 6, BASE + 2], ["line", x, ROAD_TOP - 2]);
  for (let x = 0; x < W; x += 30) flags.push(["move", x + 3, ROAD_BOT + 4], ["line", x, CANAL_TOP - 6]);
  const cobbles = Array.from({ length: 220 }, (_, i): Drawing => {
    const x = hash(i, 1, 41) * W, y = ROAD_TOP + 6 + hash(i, 2, 41) * (ROAD_BOT - ROAD_TOP - 10);
    return v.ellipse(x, y, 5 + hash(i, 3, 41) * 3, 2.4, { fill: hash(i, 4, 41) < 0.5 ? "#9a9086" : "#8a8076" });
  });
  return [
    v.rect(0, BASE, W, ROAD_TOP - BASE, { fill: "#cfc3ae" }),
    v.rect(0, ROAD_TOP, W, ROAD_BOT - ROAD_TOP, { fill: "#a49a8e" }),
    v.group({ effects: { paper: 0.5 } }, cobbles),
    v.rect(0, ROAD_BOT, W, CANAL_TOP - ROAD_BOT, { fill: "#d6cbb6" }),
    v.path(flags, { stroke: "#9e917c", weight: 1.2, brush: PENCIL, gesture: { seed: 42, faint: true } }),
    // Kerbs.
    v.line(0, ROAD_TOP, W, ROAD_TOP, { stroke: "#7a6f62", weight: 4, brush: { preset: "chalk", opacity: 0.9 }, gesture: { seed: 43 } }),
    v.line(0, ROAD_BOT, W, ROAD_BOT, { stroke: "#7a6f62", weight: 4, brush: { preset: "chalk", opacity: 0.9 }, gesture: { seed: 44 } }),
    // Tram rails.
    [RAIL_Y - 4, RAIL_Y + 4].map((y, i) => v.line(0, y, W, y, { stroke: "#5c564f", weight: 1.6, brush: "ink", gesture: { seed: 45 + i, wobble: 0.4, pressure: "even" } })),
    // The tram's overhead wire, hung from the buildings.
    stroke(v, [[0, WIRE_Y + 4], [240, WIRE_Y], [480, WIRE_Y + 3], [720, WIRE_Y], [W, WIRE_Y + 4]], { seed: 46, weight: 1.1, amp: 0.3 }),
    // The quay edge.
    v.rect(0, CANAL_TOP - 6, W, 8, { fill: "#b5aa96" }),
    Array.from({ length: 24 }, (_, i) => v.line(i * 40 + 20, CANAL_TOP - 6, i * 40 + 20, CANAL_TOP + 2, { stroke: "#8d8270", weight: 1 })),
    stroke(v, [[0, CANAL_TOP + 2], [W, CANAL_TOP + 2]], { seed: 47, weight: 1.6 }),
  ];
}

export function paintCanal(v: View): Drawing {
  return [
    v.rect(0, CANAL_TOP + 2, W, H - CANAL_TOP, { fill: v.linearGradient(0, CANAL_TOP, 0, H, [[0, "#4f7f86"], [1, "#2e5560"]]) }),
    Array.from({ length: 10 }, (_, i) => v.line(-20, CANAL_TOP + 12 + i * 7, W + 20, CANAL_TOP + 10 + i * 7 + hash(i, 1, 51) * 4, { stroke: i % 2 === 0 ? "#6fa0a4" : "#28484f", weight: 8, brush: { preset: "wash", opacity: 0.35 }, gesture: { seed: 60 + i, wobble: 2, faint: true } })),
  ];
}

export function lampPost(v: View, i: number): Drawing {
  const l = LAMPS[i];
  if (!l) return null;
  const top = l.foot - LAMP_H;
  return [
    v.line(l.x, l.foot, l.x, top + 8, { stroke: "#2f3438", weight: 3.2, brush: "ink", gesture: { seed: 70 + i, pressure: "even", wobble: 0.3 } }),
    v.rect(l.x - 5, l.foot - 6, 10, 6, { fill: "#2f3438" }),
    v.polygon([[l.x - 7, top + 8], [l.x + 7, top + 8], [l.x + 5, top - 6], [l.x - 5, top - 6]], { fill: "#e8dfc4", stroke: "#2f3438", weight: 1.6 }),
    v.triangle(l.x - 8, top - 6, l.x, top - 14, l.x + 8, top - 6, { fill: "#2f3438" }),
  ];
}

const FLAGS = ["#d0443a", "#f2c14e", "#4f8acb", "#6aa04a", "#f6f1e6", "#9b6fd0"] as const;

/** Bunting strung between two points, sagging in the middle. */
function bunting(v: View, a: Vec2, b: Vec2, seed: number, cut?: Style): Drawing {
  const sag = 16;
  const at = (t: number): Vec2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t + Math.sin(Math.PI * t) * sag];
  const n = Math.floor(Math.hypot(b[0] - a[0], b[1] - a[1]) / 16);
  return [
    v.curve(Array.from({ length: 9 }, (_, i) => at(i / 8)), false, cut ? { stroke: "#000", weight: 2.5, erase: true } : ink(seed, 1.1)),
    Array.from({ length: n }, (_, i) => {
      const p = at((i + 0.5) / n), q = at((i + 1.3) / n);
      return v.polygon([p, [q[0], q[1]], [(p[0] + q[0]) / 2 + 1, (p[1] + q[1]) / 2 + 11]], cut ?? { fill: FLAGS[(i + seed) % FLAGS.length] ?? "#d0443a", stroke: INK, weight: 0.7 });
    }),
  ];
}

function buntings(v: View, cut?: Style): Drawing {
  return [0, 1].map((i) => {
    const a = LAMPS[i], b = LAMPS[i + 1];
    return a && b && bunting(v, [a.x, a.foot - LAMP_H + 4], [b.x, b.foot - LAMP_H + 4], 90 + i, cut);
  });
}

/** What hangs in front of the shop windows, drawn in `cut` (an erasing style). */
export function occluders(v: View, cut: Style): Drawing {
  return [BUILDINGS.map((b, bi) => awning(v, b, 0 + bi, cut)), buntings(v, cut), LAMPS.map((l, i) => i < 3 && v.rect(l.x - 7, l.foot - LAMP_H - 14, 14, LAMP_H + 14, cut))];
}

/** The whole still town, in one picture's coordinates (the canvas). */
export function paintTown(v: View): Drawing {
  return [
    v.group({ effects: { wash: { edges: 0.45, blotch: 0.22, granulate: 0.45 }, paper: 0.35 } }, [
      hallAndTower(v),
      BUILDINGS.map((b, bi) => building(v, b, bi)),
    ]),
    street(v),
    LAMPS.map((_, i) => i < 3 && lampPost(v, i)),
    buntings(v),
  ];
}

/** Lamps on the quay, in front of the people walking there. */
export function paintFront(v: View): Drawing {
  return LAMPS.map((_, i) => i >= 3 && lampPost(v, i));
}

