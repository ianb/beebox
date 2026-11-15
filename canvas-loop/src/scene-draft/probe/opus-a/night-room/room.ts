// A room at night, wider than the canvas, painted as a watercolour. The camera
// pans with model.cameraX. A flickering ceiling lamp and moonlight through the
// window light it; the furniture and a person (the market vendor) cast shadows.
import type { DeepReadonly, Msg } from "../../../../core/tea.js";
import type { Material, Style, Vec2, View } from "../../../scene-api.js";
import { drawArm, FIGURE_H, FIGURE_W, vendorPicture } from "./market.js";

export const canvas = { width: 600, height: 360 };

const ROOM_W = 1400;
const ROOM_H = 360;
const FLOOR_Y = 290;

export interface Model {
  readonly frame: number;
  readonly cameraX: number;
}

export function init(): Model {
  return { frame: 0, cameraX: 0 };
}

export function update(model: DeepReadonly<Model>, msg: Msg): Model {
  if (msg.type !== "tick") return model;
  // Drift slowly from one end of the room to the other and back.
  const span = ROOM_W - canvas.width;
  return { frame: msg.frame, cameraX: span * (0.5 - 0.5 * Math.cos(msg.frame * 0.006)) };
}

/** Lamp brightness at a frame: a few incommensurate sines stand in for a flicker (draw has no randomness). */
function flicker(frame: number): number {
  const dip = Math.max(0, Math.sin(frame * 0.37) * Math.sin(frame * 0.11 + 1)) ** 8;
  return 0.95 + 0.05 * Math.sin(frame * 1.3) + 0.04 * Math.sin(frame * 2.9 + 0.7) - 0.5 * dip;
}

const WOOD: Material = { castsShadow: true, bevel: 3, relief: 0.4, shine: 0.15 };
const OUTLINE: Style = { stroke: "#2c2220", weight: 2, brush: "ink", gesture: { pressure: "even", wobble: 0.8 } };
const PIGMENT: Style = { weight: 40, brush: { preset: "wash", opacity: 0.35 }, gesture: { faint: true } };

function walls(v: View): void {
  v.rect(0, 0, ROOM_W, FLOOR_Y, { fill: "#c9b48f" });
  // Wallpaper stripes as loose washes, each its own colour so the wash effect has tone to work with.
  for (let x = 20; x < ROOM_W; x += 70) {
    v.line(x, 10, x + 6, FLOOR_Y - 10, { ...PIGMENT, stroke: "#9c7f5a", weight: 22 });
  }
  v.rect(0, FLOOR_Y, ROOM_W, ROOM_H - FLOOR_Y, { fill: "#7a5236" });
  for (let x = 0; x < ROOM_W; x += 90) {
    v.line(x, FLOOR_Y + 4, x + 140, ROOM_H, { stroke: "rgba(40,24,14,0.5)", weight: 2, brush: "pencil" });
  }
  v.rect(0, FLOOR_Y - 12, ROOM_W, 12, { fill: "#5d3a24", material: { relief: 0.5, bevel: 2 } });
}

const WINDOW = { x: 960, y: 60, w: 170, h: 150 };

function window(v: View): void {
  const { x, y, w, h } = WINDOW;
  const sky = v.linearGradient(x, y, x, y + h, [[0, "#20305a"], [1, "#5b77b0"]]);
  v.rect(x, y, w, h, { fill: sky, material: { emissive: 0.9 }, effects: { glow: { blur: 22, color: "#7f9be0", strength: 2 } } });
  v.circle(x + 120, y + 40, 14, { fill: "#f4f1dc", material: { emissive: 1 } });
  // Glazing bars cast the moonlight's cross onto the floor.
  const bar: Style = { fill: "#3a2a20", material: { castsShadow: true } };
  v.rect(x + w / 2 - 4, y, 8, h, bar);
  v.rect(x, y + h / 2 - 4, w, 8, bar);
  v.rect(x - 8, y - 8, w + 16, h + 16, { ...OUTLINE, stroke: "#3a2a20", weight: 10 });
}

function lamp(v: View, frame: number): void {
  const [lx, ly] = [420, 96];
  v.line(lx, 0, lx, ly - 30, { stroke: "#222", weight: 1.5 });
  v.light({ kind: "point", at: [lx, ly + 6], height: 140, color: "#ffd59a", energy: 1.1 * flicker(frame), reach: 560 });
  v.circle(lx, ly, 8, { fill: "#fff3c4", material: { emissive: flicker(frame) }, effects: { glow: { blur: 18, color: "#ffc36b", strength: 3 } } });
  const shade: Vec2[] = [[lx - 14, ly - 32], [lx + 14, ly - 32], [lx + 40, ly], [lx - 40, ly]];
  v.polygon(shade, { fill: "#8a3b2c", stroke: "#4a1e16", weight: 3, brush: "bristle", material: { castsShadow: true, shine: 0.3, bevel: 3 } });
}

function table(v: View, x: number): void {
  const wood: Style = { fill: "#6b3f22", material: WOOD };
  v.rect(x, 200, 180, 12, { ...wood, ...OUTLINE });
  v.rect(x + 12, 212, 10, FLOOR_Y - 212, wood);
  v.rect(x + 158, 212, 10, FLOOR_Y - 212, wood);
  v.roundRect(x + 60, 176, 26, 24, 4, { fill: "#d9d2c0", material: { shine: 0.6, bevel: 4 } }); // a mug
  v.ellipse(x + 130, 196, 26, 5, { fill: "#e9e4d6", material: { shine: 0.3 } }); // a plate
}

function chair(v: View, x: number): void {
  const wood: Style = { fill: "#5a3420", material: WOOD };
  v.rect(x, 120, 10, FLOOR_Y - 120, wood);
  v.rect(x, 220, 60, 10, { ...wood, ...OUTLINE });
  v.rect(x + 50, 230, 10, FLOOR_Y - 230, wood);
  for (let y = 140; y < 210; y += 22) v.rect(x, y, 10, 8, { fill: "#4a2a18", material: WOOD });
}

function bookshelf(v: View, x: number): void {
  v.rect(x, 70, 150, FLOOR_Y - 70, { fill: "#4e2f1c", material: WOOD, ...OUTLINE });
  const colors = ["#8f2f2f", "#2f5a8f", "#c9a24a", "#3f7a4f", "#7a3f7a", "#d0c6aa"];
  for (let shelf = 0; shelf < 4; shelf += 1) {
    const y = 84 + shelf * 50;
    v.rect(x + 6, y + 40, 138, 6, { fill: "#3a2214", material: WOOD });
    for (let b = 0; b < 9; b += 1) {
      const h = 30 + ((b * 7 + shelf * 3) % 10);
      v.rect(x + 10 + b * 14, y + 40 - h, 12, h, { fill: colors[(b + shelf) % colors.length] ?? "#888", material: { relief: 0.3, bevel: 1.5 } });
    }
  }
}

function person(v: View, frame: number): void {
  const look = { coat: "#4a5d7a", apron: "#d8d0bc", skin: "#d9a882", hat: "#2a2a32" };
  const figure = vendorPicture(v, { look, castsShadow: true });
  const breath = 1 + 0.01 * Math.sin(frame * 0.06);
  v.at({ translate: [760, FLOOR_Y], scale: [1, breath] }, () => {
    v.at({ translate: [-FIGURE_W / 2, -FIGURE_H] }, () => {
      v.place(figure, 0, 0);
      drawArm(v, { look, angle: -0.5 + 0.05 * Math.sin(frame * 0.04) });
    });
  });
}

export function draw(v: View, model: DeepReadonly<Model>): void {
  v.background("#0e1220");
  // The camera outside the watercolour group: pigment and paper move with the room.
  v.at({ translate: [-model.cameraX, 0] }, () => {
    v.group(
      {
        name: "room",
        lighting: { ambient: "#262c44", shadows: "soft" },
        effects: { wash: { granulate: 0.6, edges: 0.7, blotch: 0.4, bleed: 2 }, paper: 0.5 },
      },
      () => {
        v.paper({ scale: 4, contrast: 0.8, seed: 3 });
        walls(v);
        window(v);
        // Moonlight falls from the window down and to the left.
        v.light({ kind: "spot", at: [WINDOW.x + WINDOW.w / 2, WINDOW.y + 20], height: 60, color: "#9fb4ff", energy: 0.55, direction: Math.PI * 0.72, cone: 0.6, reach: 700 });
        bookshelf(v, 80);
        lamp(v, model.frame);
        table(v, 330);
        chair(v, 540);
        person(v, model.frame);
        chair(v, 1180);
      },
    );
  });
  // A vignette in screen space, after the camera, so it stays put.
  v.rect(0, 0, canvas.width, canvas.height, {
    fill: v.ellipseGradient(canvas.width / 2, canvas.height / 2, canvas.width * 0.7, canvas.height * 0.75, [[0.6, "rgba(0,0,0,0)"], [1, "rgba(5,8,20,0.55)"]]),
  });
}
