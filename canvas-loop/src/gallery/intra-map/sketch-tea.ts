// Part of Intra, the bunker in intra-game, drawn as a floor plan from explicit data
// (plan-tea.ts). Every piece belongs to a depth layer, and standing pieces sort by
// where they meet the floor, so people pass behind statues and under door lintels.
// The same pieces also draw the depth map an engine would use, and the walk map.
import type { DeepReadonly, Msg, ParamsDecl, ParamValues, Util, View } from "@ianbicking/canvas-loop";
import { MAP_H, MAP_W, type Room, T, VISITED, WALKERS, type Walker } from "./plan-tea.js";
import { STATIC_PIECES, WALK, WALK_GRID, WALK_W, type Piece, ceilingPieces, roomLabels } from "./pieces-tea.js";
import { paintPerson } from "./props-tea.js";

/** Draws with the scene View on the GPU renderer (`cli run` reads this). */
export const renderer = "scene";

export const params = {
  view: {
    type: "select",
    options: ["picture", "depth map", "walk map"] as const,
    default: "picture",
    label: "View",
    hint: "Depth map: dark is far (north), light is near (south); black is floor, white is overhead.",
  },
  ceilings: {
    type: "select",
    options: ["lifted", "fog of war", "all on"] as const,
    default: "lifted",
    label: "Sky-screen ceilings",
    hint: "Fog of war lifts the ceilings of rooms you have visited.",
  },
  people: { type: "boolean", default: true, label: "People" },
  labels: { type: "boolean", default: true, label: "Room names" },
} as const satisfies ParamsDecl;

const ZOOM = 2;
const MARGIN = 40;
export const canvas = { width: (MAP_W * T + MARGIN * 2) * ZOOM, height: (MAP_H * T + MARGIN * 2) * ZOOM };

export interface Model {
  frame: number;
}
export function init(): Model {
  return { frame: 0 };
}
export function update(model: DeepReadonly<Model>, msg: Msg, _u: Util<typeof params>): Model {
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
      return model;
  }
}

/** Where a walker's feet are at frame t: along their loop at their speed. */
function walkerAt(w: Walker, t: number): { x: number; y: number; moving: boolean } {
  const pts = w.route.map(([x, y]) => [x * T, y * T] as const);
  const first = pts[0] ?? [0, 0];
  if (pts.length < 2 || w.speed === 0) return { x: first[0], y: first[1], moving: false };
  const segs = pts.map((p, i) => {
    const q = pts[(i + 1) % pts.length] ?? p;
    return { p, q, len: Math.hypot(q[0] - p[0], q[1] - p[1]) };
  });
  const total = segs.reduce((s, g) => s + g.len, 0);
  let d = (t * w.speed) % total;
  for (const g of segs) {
    if (d <= g.len) {
      const u = g.len === 0 ? 0 : d / g.len;
      return { x: g.p[0] + (g.q[0] - g.p[0]) * u, y: g.p[1] + (g.q[1] - g.p[1]) * u, moving: true };
    }
    d -= g.len;
  }
  return { x: first[0], y: first[1], moving: true };
}

function peoplePieces(t: number): Piece[] {
  return WALKERS.map((w, k): Piece => {
    const at = walkerAt(w, t);
    const pose = w.pose ?? (at.moving ? "walking" : "standing");
    return { layer: "standing", baseY: at.y, paint: (v) => paintPerson(v, { x: at.x, y: at.y, shirt: w.shirt, t, pose, k }) };
  });
}

const ORDER: Record<Piece["layer"], number> = { floor: 0, standing: 1, over: 2, ceiling: 3 };
function sorted(pieces: readonly Piece[]): Piece[] {
  return pieces.toSorted((a, b) => ORDER[a.layer] - ORDER[b.layer] || (a.layer === "standing" ? a.baseY - b.baseY : 0));
}

/** A piece's colour in the depth map: black floor, grey by base y for standing
 * pieces (darker is further north), white overhead. */
function depthColour(p: Piece): string {
  if (p.layer === "floor") return "#000000";
  if (p.layer !== "standing") return "#ffffff";
  const g = Math.round(40 + (p.baseY / (MAP_H * T)) * 190);
  return `rgb(${g},${g},${g})`;
}

const WALK_COLOUR: Record<string, string> = { floor: "rgba(74,222,128,0.55)", door: "rgba(96,165,250,0.85)", blocked: "rgba(248,113,113,0.6)" };

export function draw(v: View, model: DeepReadonly<Model>, p: ParamValues<typeof params>): void {
  const t = model.frame;
  v.background("#17191f");
  v.at({ scale: ZOOM }, () => v.at({ translate: [MARGIN, MARGIN] }, () => {
    // Bedrock around the rooms.
    v.place(v.picture({ key: "rock", width: v.width, height: v.height }, () => {
      for (let i = 0; i < 260; i++) {
        const s = Math.sin(i * 91.7) * 43758.5;
        const r = Math.sin(i * 12.3) * 9631.1;
        v.circle((s - Math.floor(s)) * MAP_W * T, (r - Math.floor(r)) * MAP_H * T, 3 + ((i * 7) % 9), { fill: i % 2 === 0 ? "#1d2027" : "#14161b" });
      }
    }), 0, 0);
    const ceilingShown = (room: Room): boolean => (p.ceilings === "all on" ? true : p.ceilings === "fog of war" ? !VISITED.includes(room.id) : false);
    const people = p.people ? peoplePieces(t) : [];
    const all = sorted([...STATIC_PIECES, ...people, ...(p.view === "picture" ? ceilingPieces(ceilingShown) : [])]);
    if (p.view === "depth map") {
      for (const piece of all) v.mask(() => piece.paint(v, t), () => v.rect(-MARGIN, -MARGIN, MAP_W * T + MARGIN * 2, MAP_H * T + MARGIN * 2, { fill: depthColour(piece) }));
      return;
    }
    for (const piece of all) piece.paint(v, t);
    if (p.view === "walk map") {
      v.rect(-MARGIN, -MARGIN, MAP_W * T + MARGIN * 2, MAP_H * T + MARGIN * 2, { fill: "rgba(10,12,16,0.55)" });
      for (const [k, cell] of WALK_GRID.entries()) {
        const fill = WALK_COLOUR[cell];
        if (fill !== undefined) v.rect((k % WALK_W) * WALK, Math.floor(k / WALK_W) * WALK, WALK, WALK, { fill });
      }
    }
    if (p.labels && p.view !== "walk map") roomLabels(v);
  }));
}
