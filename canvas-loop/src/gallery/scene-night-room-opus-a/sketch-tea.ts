// A room at night, wider than the canvas. The camera pans slowly from the
// bookshelf past the flickering ceiling lamp to the window, where someone
// stands looking out. The whole room is washed like a watercolour.
import type { DeepReadonly, Msg, ParamsDecl, ParamValues, Style, View, Vec2 } from "@ianbicking/canvas-loop";

/** Draws with the scene View on the GPU renderer (`cli run` reads this). */
export const renderer = "scene";

export const canvas = { width: 640, height: 400 };
export const params = {
  speed: { type: "number", min: 0, max: 3, default: 1, step: 0.1, label: "pan speed" },
  flicker: { type: "number", min: 0, max: 1, default: 0.6, step: 0.05, label: "lamp flicker" },
} as const satisfies ParamsDecl;

export interface Model {
  frame: number;
}

export function init(): Model {
  return { frame: 0 };
}

export function update(model: DeepReadonly<Model>, msg: Msg): Model {
  switch (msg.type) {
    case "tick":
      return { frame: msg.frame };
    case "mousedown":
    case "mouseup":
    case "mousemove":
    case "keydown":
    case "keyup":
    case "param":
    case "trigger":
      return { frame: model.frame };
  }
}

const ROOM_W = 1300;
const FLOOR_Y = 318;
const LAMP: Vec2 = [560, 120];
const WINDOW = { x: 930, y: 70, w: 190, h: 170 };

const LINE: Style = { stroke: "#2b2230", weight: 2, brush: "ink", gesture: { wobble: 0.6 } };
const PAINT = (fill: string): Style => ({ ...LINE, fill });
const DAB = (color: string, weight: number): Style => ({ stroke: color, weight, brush: { preset: "bristle", lightJitter: 0.08, hueJitter: 6 } });

function walls(v: View): void {
  // The wall and floor run past every edge, so the wash has no edge to dry against.
  v.rect(-40, -40, ROOM_W + 80, FLOOR_Y + 40, { fill: "#c7b79a" });
  // Wallpaper: faint vertical stripes and a dado rail.
  for (let x = 20; x < ROOM_W; x += 46) v.line(x, 10, x, FLOOR_Y - 70, { stroke: "rgba(120,90,70,0.35)", weight: 10, brush: "wash", gesture: { faint: true } });
  v.rect(0, FLOOR_Y - 70, ROOM_W, 8, PAINT("#8a6a4c"));
  v.rect(-40, FLOOR_Y, ROOM_W + 80, 440 - FLOOR_Y, { fill: "#7d5636" });
  for (let y = FLOOR_Y + 14; y < 400; y += 18) v.line(0, y, ROOM_W, y, { stroke: "#4f3420", weight: 2, brush: "pencil" });
  v.rect(0, FLOOR_Y - 6, ROOM_W, 8, PAINT("#5a3d26"));
}

function bookshelf(v: View, x: number): void {
  v.rect(x, 70, 170, FLOOR_Y - 70, { ...PAINT("#6b4428"), material: { castsShadow: 60 } });
  const spines = ["#8b2f2f", "#2f5b7a", "#c9a24a", "#3f6b4a", "#7a4a7e", "#d07a3a", "#304050"] as const;
  for (let shelf = 0; shelf < 4; shelf += 1) {
    const sy = 84 + shelf * 58;
    v.rect(x + 8, sy + 46, 154, 6, PAINT("#4a2c18"));
    let bx = x + 12;
    for (let b = 0; bx < x + 150; b += 1) {
      const w = 9 + ((b * 7 + shelf * 3) % 6);
      const h = 34 + ((b * 5 + shelf) % 10);
      v.rect(bx, sy + 46 - h, w, h, { fill: spines[(b + shelf * 2) % spines.length] ?? "#555", stroke: "#2b2230", weight: 1 });
      bx += w + 1;
    }
  }
  v.rect(x, 70, 170, FLOOR_Y - 70, LINE);
}

function armchair(v: View, x: number): void {
  const chair = PAINT("#8c3b33");
  v.group({ name: "armchair" }, () => {
    v.roundRect(x, FLOOR_Y - 120, 120, 90, 18, { ...chair, material: { castsShadow: 50, bevel: 8, relief: 0.4 } });
    v.roundRect(x - 14, FLOOR_Y - 70, 40, 54, 12, { ...chair, material: { castsShadow: 50, bevel: 8, relief: 0.4 } });
    v.roundRect(x + 94, FLOOR_Y - 70, 40, 54, 12, { ...chair, material: { castsShadow: 50, bevel: 8, relief: 0.4 } });
    v.rect(x + 20, FLOOR_Y - 46, 80, 30, { ...PAINT("#a24a3e"), material: { castsShadow: 40, bevel: 6 } });
    v.curve([[x + 30, FLOOR_Y - 110], [x + 60, FLOOR_Y - 116], [x + 90, FLOOR_Y - 108]], false, DAB("#b85a48", 14));
  });
  for (const lx of [x - 4, x + 120]) v.line(lx, FLOOR_Y - 16, lx, FLOOR_Y + 2, { stroke: "#2b2230", weight: 5, cap: "round" });
}

function table(v: View, x: number): void {
  v.rect(x, FLOOR_Y - 84, 150, 10, { ...PAINT("#6a4a2e"), material: { castsShadow: 90 } });
  for (const lx of [x + 10, x + 132]) v.rect(lx, FLOOR_Y - 74, 8, 74, { ...PAINT("#5a3d26"), material: { castsShadow: 90 } });
  // A vase of flowers and a teacup.
  v.path([["move", x + 40, FLOOR_Y - 84], ["quad", x + 26, FLOOR_Y - 110, x + 42, FLOOR_Y - 128], ["line", x + 58, FLOOR_Y - 128], ["quad", x + 74, FLOOR_Y - 110, x + 60, FLOOR_Y - 84], ["close"]],
    { ...PAINT("#3d6f8a"), material: { shine: 0.7, bevel: 6, castsShadow: 120 } });
  const blooms: readonly [Vec2, string][] = [[[x + 36, FLOOR_Y - 160], "#e2c044"], [[x + 52, FLOOR_Y - 172], "#d9534f"], [[x + 66, FLOOR_Y - 156], "#f2e8d0"]];
  for (const [[fx, fy], col] of blooms) {
    v.curve([[x + 50, FLOOR_Y - 126], [(fx + x + 50) / 2, fy + 20], [fx, fy]], false, { stroke: "#4f7a3a", weight: 2.5, brush: "ink" });
    v.circle(fx, fy, 8, { fill: col, stroke: col, weight: 6, brush: { preset: "bristle", hueJitter: 10 } });
  }
  v.roundRect(x + 100, FLOOR_Y - 98, 22, 14, 4, PAINT("#efe6d8"));
}

function windowView(v: View): void {
  const { x, y, w, h } = WINDOW;
  // Night outside: deep blue, a moon, the glow of a street lamp below.
  v.rect(x, y, w, h, { fill: v.linearGradient(x, y, x, y + h, [[0, "#1d2a52"], [0.7, "#3a4f86"], [1, "#d8a35c"]]), material: { emissive: 0.85 } });
  v.circle(x + 140, y + 42, 16, { fill: "#f4ecc8", material: { emissive: 1 } });
  v.polygon([[x, y + h], [x + 30, y + 120], [x + 70, y + 132], [x + 100, y + 108], [x + 150, y + 126], [x + w, y + 116], [x + w, y + h]], { fill: "#151b33", material: { emissive: 0.6 } });
  v.group({ effects: { glow: { blur: 14, color: "#ffd890" } } }, () => v.circle(x + 60, y + 150, 5, { fill: "#ffe2a0", material: { emissive: 1 } }));
  // Frame and glazing bars.
  const frame = { ...PAINT("#efe6d8"), material: { castsShadow: 20 } };
  v.rect(x - 10, y - 10, w + 20, 10, frame);
  v.rect(x - 10, y + h, w + 20, 14, frame);
  v.rect(x - 10, y, 10, h, frame);
  v.rect(x + w, y, 10, h, frame);
  v.rect(x + w / 2 - 4, y, 8, h, frame);
  v.rect(x, y + h / 2 - 4, w, 8, frame);
  // Curtains, gathered at each side: a flat body, then folds brushed over it.
  for (const side of [-1, 1]) {
    const cx = side < 0 ? x - 30 : x + w + 30;
    const body: Vec2[] = [[cx - 26, y - 24], [cx + 26, y - 24], [cx + 8 - side * 6, y + 110], [cx + 24 + side * 10, FLOOR_Y - 14], [cx - 24 + side * 10, FLOOR_Y - 14], [cx - 10 - side * 6, y + 110]];
    v.polygon(body, { ...PAINT("#56704a"), material: { castsShadow: 30 } });
    for (const dx of [-14, 0, 14]) v.curve([[cx + dx, y - 20], [cx + dx * 0.4 - side * 4, y + 110], [cx + dx * 1.3 + side * 10, FLOOR_Y - 18]], false, DAB("#3e5636", 6));
  }
  v.rect(x - 70, y - 30, w + 140, 8, PAINT("#4a3a2a"));
}

function person(v: View): void {
  // Seen from behind, looking out of the window, one hand on the sill.
  const coat = { ...PAINT("#9a5a3c"), material: { castsShadow: 100, bevel: 6 } };
  v.path(v.tube([[-32, -114], [-40, -78], [-34, -40]], { width: 16 }), coat);
  v.path(v.tube([[30, -116], [50, -96], [66, -80]], { width: 15 }), coat);
  v.path([["move", -28, 4], ["quad", -34, -60, -36, -112], ["quad", -20, -128, 0, -128], ["quad", 20, -128, 36, -112], ["quad", 34, -60, 28, 4], ["close"]], coat);
  v.curve([[-18, -100], [-14, -60], [-18, -10]], false, DAB("#7a4430", 8));
  v.curve([[16, -104], [12, -60], [16, -12]], false, DAB("#b2704a", 6));
  v.rect(-22, 0, 18, 60, { ...PAINT("#2c2a30"), material: { castsShadow: 100 } });
  v.rect(4, 0, 18, 60, { ...PAINT("#2c2a30"), material: { castsShadow: 100 } });
  v.rect(-7, -136, 14, 12, PAINT("#c99a76"));
  v.ellipse(0, -152, 19, 22, { ...PAINT("#3a2418"), material: { castsShadow: 100, bevel: 6 } });
  v.curve([[-14, -168], [0, -172], [14, -166]], false, DAB("#5a3a24", 6));
}

function ceilingLamp(v: View, glow: number): void {
  const [lx, ly] = LAMP;
  v.line(lx, 0, lx, ly - 30, { stroke: "#2b2230", weight: 2 });
  v.group({ name: "lamp shade", effects: { glow: { blur: 26, color: "#ffcf7a", strength: 2 + glow * 2 } } }, () => {
    v.polygon([[lx - 20, ly - 30], [lx + 20, ly - 30], [lx + 44, ly], [lx - 44, ly]], { ...PAINT("#e09a48"), material: { emissive: 0.5 + glow * 0.4 } });
    v.ellipse(lx, ly + 2, 12, 6, { fill: "#fff4cc", material: { emissive: 1 } });
  });
}

export function draw(v: View, model: DeepReadonly<Model>, p: ParamValues<typeof params>): void {
  const t = (model.frame * p.speed) / 30;
  const pan = ((ROOM_W - v.width) * (1 - Math.cos(t * 1.05))) / 2;
  const n = v.noise(model.frame * 0.25, 3.1);
  const glow = 1 - p.flicker * (n < 0.35 ? 0.7 : 0.15 * n);
  v.background("#ece3d0");
  v.at({ translate: [-pan, 0] }, () => {
    v.group({
      name: "room",
      lighting: { ambient: "#33395a", shadows: "soft", toneCurve: 0.6 },
      effects: { wash: { granulate: 0.35, edges: 0.6, blotch: 0.25, bleed: 2 }, paper: 0.45 },
    }, () => {
      const room = v.picture({ key: "room", width: ROOM_W, height: 400 }, () => walls(v));
      v.place(room, 0, 0);
      v.rect(130, 40, 70, 90, PAINT("#d8c9a6"));
      v.rect(140, 50, 50, 70, PAINT("#6a8a9a"));
      bookshelf(v, 250);
      armchair(v, 470);
      table(v, 690);
      windowView(v);
      v.at({ translate: [1000, FLOOR_Y - 60] }, () => person(v));
      ceilingLamp(v, glow);
      v.light({ kind: "point", at: LAMP, height: 140, color: "#ffc67a", energy: 2.2 * glow, reach: 620 });
      v.light({ kind: "spot", at: [WINDOW.x + WINDOW.w / 2, WINDOW.y + 40], direction: Math.PI / 2, cone: 0.9, height: 60, color: "#7f9ad8", energy: 1.4, reach: 480 });
    });
  });
}
