// A room at night, wider than the canvas, as a watercolour. The camera pans
// with `model.cameraX`. A flickering ceiling lamp, a glowing window, furniture
// that casts shadows, and a vendor from the market sitting in for a person.
// Scene API draft 2.1 probe (opus-b).
import type { BrushPreset } from "../../../../core/tea.js";
import type { Material, Style, Vec2, View } from "../../../scene-api.js";
import { VENDOR_H, VENDOR_W, vendorPicture, type Look } from "./market.js";

export interface Model {
  frame: number;
  /** Left edge of the view, in room coordinates (0..ROOM_W - canvas width). */
  cameraX: number;
}

export const ROOM_W = 1200;
const FLOOR_Y = 250;
const LAMP: Vec2 = [520, 40];
const WINDOW = { x: 860, y: 60, w: 150, h: 120 } as const;

const PENCIL: Style = { stroke: "#2c2a33", weight: 1.6, brush: "pencil", gesture: { wobble: 0.8 } };
const WASH: BrushPreset = { preset: "wash", opacity: 0.45 };
const SOLID: Material = { castsShadow: true, bevel: 4, relief: 0.4 };
const WOOD: Material = { ...SOLID, shine: 0.15 };
const SLEEPER: Look = { robe: "#5b6f8a", trim: "#c9b98f", hat: "#3d3a52", skin: "#c39274" };

/** Lamp brightness this frame: two slow waves and an occasional dip. */
function flicker(frame: number): number {
  const base = 0.85 + 0.08 * Math.sin(frame * 0.9) + 0.05 * Math.sin(frame * 2.3 + 1);
  return frame % 97 < 3 ? base * 0.4 : base;
}

/** Walls, floor and skirting: static, so a picture. Flat matte for the light. */
function roomShell(v: View): void {
  const shell = v.picture({ key: "room-shell", width: ROOM_W, height: 300 }, () => {
    v.rect(0, 0, ROOM_W, FLOOR_Y, { fill: "#c9b9a0" });
    // wallpaper stripes in a pale wash
    for (let x = 20; x < ROOM_W; x += 60) {
      v.line(x, 10, x, FLOOR_Y - 10, { stroke: "#b3a080", weight: 22, brush: WASH, gesture: { seed: x } });
    }
    v.rect(0, FLOOR_Y, ROOM_W, 300 - FLOOR_Y, { fill: "#7a5c43" });
    for (let x = 0; x < ROOM_W; x += 90) v.line(x, FLOOR_Y, x - 40, 300, PENCIL);
    v.rect(0, FLOOR_Y - 8, ROOM_W, 8, { fill: "#5c4433", stroke: "#2c2a33", weight: 1.5, brush: "pencil" });
  });
  v.place(shell, 0, 0);
}

function window(v: View): void {
  const { x, y, w, h } = WINDOW;
  // night sky through the glass: it gives light, so emissive, and glows past the frame
  v.rect(x, y, w, h, {
    fill: v.linearGradient(x, y, x, y + h, [[0, "#1d2a4a"], [1, "#4a5f8a"]]),
    material: { emissive: 0.9 },
    effects: { glow: { blur: 24, color: "#6f8fd0", strength: 2 } },
  });
  v.circle(x + 110, y + 30, 12, { fill: "#f4efd8", material: { emissive: 1 } });
  // frame and glazing bars cast shadows of the moonlight into the room
  const bar: Style = { fill: "#4a3a2e", material: SOLID };
  v.rect(x - 8, y - 8, w + 16, 8, bar);
  v.rect(x - 8, y + h, w + 16, 10, bar);
  v.rect(x - 8, y, 8, h, bar);
  v.rect(x + w, y, 8, h, bar);
  v.rect(x + w / 2 - 3, y, 6, h, bar);
  v.rect(x, y + h / 2 - 3, w, 6, bar);
  v.light({ kind: "spot", at: [x + w / 2, y + h / 2], height: 60, color: "#9fb4e0", energy: 0.5, direction: Math.PI * 0.7, cone: 0.6, reach: 500 });
}

function ceilingLamp(v: View, energy: number): void {
  const [lx, ly] = LAMP;
  v.line(lx, 0, lx, ly, { stroke: "#2c2a33", weight: 2 });
  v.path(
    [["move", lx - 30, ly + 22], ["line", lx - 12, ly], ["line", lx + 12, ly], ["line", lx + 30, ly + 22], ["close"]],
    { fill: "#d8c27a", stroke: "#2c2a33", weight: 1.5, brush: "ink", material: { shine: 0.6, bevel: 3 } },
  );
  v.circle(lx, ly + 24, 6, { fill: "#fff3c4", material: { emissive: energy }, effects: { glow: { blur: 16 * energy, color: "#ffd98a" } } });
  v.light({ kind: "point", at: [lx, ly + 26], height: 120, color: "#ffd9a0", energy, reach: 520 });
}

function table(v: View, x: number): void {
  const legs: Style = { fill: "#6b4a32", material: WOOD };
  v.rect(x, FLOOR_Y - 70, 160, 12, { fill: "#8a6040", stroke: "#2c2a33", weight: 1.5, brush: "pencil", material: WOOD });
  v.rect(x + 10, FLOOR_Y - 58, 10, 58, legs);
  v.rect(x + 140, FLOOR_Y - 58, 10, 58, legs);
  // a bowl on the table
  v.arc(x + 80, FLOOR_Y - 76, 18, 0, Math.PI, { fill: "#d6e2ea", stroke: "#2c2a33", weight: 1.2, brush: "ink", material: { shine: 0.7, bevel: 6, relief: 0.8, castsShadow: true } });
}

function armchair(v: View, x: number): void {
  const body: readonly Vec2[] = [[x, FLOOR_Y - 10], [x + 6, FLOOR_Y - 110], [x + 40, FLOOR_Y - 118], [x + 50, FLOOR_Y - 60], [x + 120, FLOOR_Y - 60], [x + 126, FLOOR_Y - 10]];
  v.curve(body, true, { fill: "#8a3f3f", material: { ...SOLID, bevel: 14, relief: 0.6 } });
  v.curve(body, true, { stroke: "#4a1f22", weight: 18, brush: { preset: "bristle", load: 0.5, lightJitter: 0.06 } });
  v.roundRect(x + 104, FLOOR_Y - 84, 26, 74, 10, { fill: "#7a3536", stroke: "#2c2a33", weight: 1.4, brush: "pencil", material: { ...SOLID, bevel: 8 } });
}

function bookshelf(v: View, x: number): void {
  v.rect(x, FLOOR_Y - 170, 90, 170, { fill: "#5a3e2b", stroke: "#2c2a33", weight: 1.5, brush: "pencil", material: WOOD });
  const spines = ["#7d2e2e", "#2e4f7d", "#3f6a3a", "#b08a3a", "#5a3a6a"];
  for (let shelf = 0; shelf < 3; shelf += 1) {
    const sy = FLOOR_Y - 160 + shelf * 52;
    for (let i = 0; i < 7; i += 1) {
      v.rect(x + 8 + i * 11, sy + 4 + (i % 3) * 3, 9, 40 - (i % 3) * 3, { fill: spines[(i + shelf) % spines.length] ?? "#777", material: { relief: 0.3, bevel: 2 } });
    }
    v.rect(x + 4, sy + 44, 82, 4, { fill: "#3a281c", material: SOLID });
  }
}

export function draw(v: View, model: Model): void {
  v.background("#1a1820");
  const energy = flicker(model.frame);
  const cameraX = Math.min(Math.max(model.cameraX, 0), ROOM_W - v.width);

  // Camera outside the group: pigment, hatching and paper move with the room.
  v.at({ translate: [-cameraX, 0] }, () => {
    v.group(
      {
        name: "room",
        lighting: { ambient: "#2a2838", shadows: "soft" },
        effects: { wash: { granulate: 0.6, edges: 0.7, blotch: 0.4, bleed: 3 }, paper: 0.5 },
      },
      () => {
        v.paper({ scale: 3, contrast: 0.8 });
        roomShell(v);
        window(v);
        ceilingLamp(v, energy);
        bookshelf(v, 120);
        armchair(v, 330);
        // the person, dozing in the chair, breathing slowly
        const breath = 1 + 0.01 * Math.sin(model.frame / 40);
        v.at({ translate: [360 + VENDOR_W / 2, FLOOR_Y - 20], scale: [0.9, 0.9 * breath] }, () => {
          v.place(vendorPicture(v, SLEEPER), -VENDOR_W / 2, -VENDOR_H);
        });
        table(v, 640);
        // a rug: flat, takes light, casts nothing
        v.ellipse(560, FLOOR_Y + 30, 150, 16, { fill: "#6a3a4a", stroke: "#3a1f2a", weight: 10, brush: { preset: "chalk", hueJitter: 8 } });
      },
    );
  });
}
