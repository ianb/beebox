// Turns the plan into pieces: each one a layer, a base y for sorting, and a painter.
// Walls are derived from the rooms (merged where rooms share a wall), doors from the
// exits, and the walkable floor from both plus the props' footprints.
import type { View } from "@ianbicking/canvas-loop";
import { MAP_H, MAP_W, OFF_PLAN, PROPS, QUARTERS, ROOMS, type Room, type Sky, T } from "./plan-tea.js";
import { onWall, paintProp } from "./props-tea.js";

export type Layer = "floor" | "standing" | "over" | "ceiling";

export interface Piece {
  layer: Layer;
  /** For standing pieces: where it meets the floor, in map px. Later is nearer. */
  baseY: number;
  room?: string;
  paint: (v: View, t: number) => void;
}

/** Wall height in px: how far a wall's top is drawn above its foot. */
export const WALL_H = 22;
const HALF_THICK = 3;
/** Height of a wall cut down because it faces the viewer from outside. */
const LOW_WALL = 7;
const DOOR_W = 26;
const CAP = "#2a2d36";

const byId = new Map(ROOMS.map((r) => [r.id, r]));
const px = (r: Room): { x0: number; y0: number; x1: number; y1: number } => ({
  x0: r.rect[0] * T, y0: r.rect[1] * T, x1: (r.rect[0] + r.rect[2]) * T, y1: (r.rect[1] + r.rect[3]) * T,
});

function shade(hex: string, k: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((ch) => Math.round(k < 1 ? ch * k : ch + (255 - ch) * (k - 1)));
  return `rgb(${c.join(",")})`;
}

// --- Doors -------------------------------------------------------------------------

/** A door: a gap in a wall, horizontal (in a wall running east-west) or vertical. */
export interface Door {
  dir: "h" | "v";
  /** The wall line, px. */
  at: number;
  /** The gap, px along the wall. */
  from: number;
  to: number;
  label?: string;
}

function overlap(a0: number, a1: number, b0: number, b1: number): [number, number] | null {
  const lo = Math.max(a0, b0), hi = Math.min(a1, b1);
  return hi > lo ? [lo, hi] : null;
}

function doorsOf(): Door[] {
  const out: Door[] = [];
  const seen = new Set<string>();
  for (const a of ROOMS) {
    const pa = px(a);
    for (const exit of a.exits) {
      const b = byId.get(exit);
      if (b) {
        const key = [a.id, b.id].toSorted().join("|");
        if (seen.has(key)) continue;
        seen.add(key);
        const pb = px(b);
        // A shared east-west wall, or a shared north-south wall.
        const hy = pa.y1 === pb.y0 ? pa.y1 : pa.y0 === pb.y1 ? pa.y0 : null;
        const hs = hy === null ? null : overlap(pa.x0, pa.x1, pb.x0, pb.x1);
        if (hy !== null && hs) {
          const c = (hs[0] + hs[1]) / 2;
          out.push({ dir: "h", at: hy, from: c - DOOR_W / 2, to: c + DOOR_W / 2 });
          continue;
        }
        const vx = pa.x1 === pb.x0 ? pa.x1 : pa.x0 === pb.x1 ? pa.x0 : null;
        const vs = vx === null ? null : overlap(pa.y0, pa.y1, pb.y0, pb.y1);
        if (vx !== null && vs) {
          const c = (vs[0] + vs[1]) / 2 + WALL_H / 2;
          out.push({ dir: "v", at: vx, from: c - DOOR_W / 2, to: c + DOOR_W / 2 });
        }
        continue;
      }
      const off = OFF_PLAN[exit];
      if (!off) continue;
      if (off.side === "w") {
        const c = pa.y0 + (pa.y1 - pa.y0) * off.at + WALL_H / 2;
        out.push({ dir: "v", at: pa.x0, from: c - DOOR_W / 2, to: c + DOOR_W / 2, label: off.label });
      } else {
        const c = pa.x0 + (pa.x1 - pa.x0) * off.at;
        out.push({ dir: "h", at: off.side === "n" ? pa.y0 : pa.y1, from: c - DOOR_W / 2, to: c + DOOR_W / 2, label: off.label });
      }
    }
  }
  return out;
}
export const DOORS: readonly Door[] = doorsOf();

// --- Walls -------------------------------------------------------------------------

/** Merge intervals, then cut the door gaps out of them. */
function spans(intervals: [number, number][], gaps: [number, number][]): [number, number][] {
  const sorted = intervals.toSorted((p, q) => p[0] - q[0]);
  const merged: [number, number][] = [];
  for (const [a, b] of sorted) {
    const last = merged.at(-1);
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }
  let out = merged;
  for (const [g0, g1] of gaps) {
    out = out.flatMap(([a, b]): [number, number][] => {
      if (g1 <= a || g0 >= b) return [[a, b]];
      const parts: [number, number][] = [];
      if (g0 > a) parts.push([a, g0]);
      if (g1 < b) parts.push([g1, b]);
      return parts;
    });
  }
  return out;
}

function roomAt(x: number, y: number): Room | undefined {
  return ROOMS.find((r) => {
    const p = px(r);
    return x > p.x0 && x < p.x1 && y > p.y0 && y < p.y1;
  });
}

function wallPieces(): Piece[] {
  const out: Piece[] = [];
  const hLines = new Map<number, [number, number][]>();
  const vLines = new Map<number, [number, number][]>();
  for (const r of ROOMS) {
    const p = px(r);
    for (const y of [p.y0, p.y1]) hLines.set(y, [...(hLines.get(y) ?? []), [p.x0 - HALF_THICK, p.x1 + HALF_THICK]]);
    for (const x of [p.x0, p.x1]) vLines.set(x, [...(vLines.get(x) ?? []), [p.y0, p.y1]]);
  }
  for (const [y, list] of hLines) {
    const gaps = DOORS.filter((d) => d.dir === "h" && d.at === y).map((d): [number, number] => [d.from, d.to]);
    for (const [x0, x1] of spans(list, gaps)) {
      out.push({
        layer: "standing",
        baseY: y + HALF_THICK,
        paint: (v) => {
          // The face is seen from the room to the south, in that room's colour. A wall
          // with no room south of it faces the viewer from outside, so it is cut down
          // low, as cutaway maps do, to keep the room behind it in view.
          for (let x = x0; x < x1; x += T / 2) {
            const below = roomAt(Math.min(x + T / 4, x1 - 1), y + 4);
            const h = below ? WALL_H : LOW_WALL;
            const w = Math.min(T / 2, x1 - x);
            v.rect(x, y + HALF_THICK - h, w, h, { fill: below ? shade(below.color, 0.72) : "#3a3f4b" });
            v.rect(x, y + HALF_THICK - 4, w, 4, { fill: below ? shade(below.color, 0.5) : "#2f333d" });
            v.rect(x, y - HALF_THICK - h, w, HALF_THICK * 2, { fill: CAP });
          }
          v.rect(x0, y + HALF_THICK, x1 - x0, 5, { fill: v.linearGradient(0, y + HALF_THICK, 0, y + HALF_THICK + 5, [[0, "rgba(0,0,0,0.3)"], [1, "rgba(0,0,0,0)"]]) });
        },
      });
    }
  }
  for (const [x, list] of vLines) {
    const gaps = DOORS.filter((d) => d.dir === "v" && d.at === x).map((d): [number, number] => [d.from, d.to]);
    for (const [y0, y1] of spans(list, gaps)) {
      // Cut into short lengths so each sorts by its own foot: a person standing
      // halfway along the wall is in front of its north part and behind its south part.
      for (let a = y0; a < y1; a += T / 2) {
        const b = Math.min(y1, a + T / 2);
        const end = b === y1;
        out.push({
          layer: "standing",
          baseY: b,
          paint: (v) => {
            v.rect(x - HALF_THICK, a - WALL_H, HALF_THICK * 2, b - a + (end ? 0 : 0.5), { fill: CAP });
            if (end) v.rect(x - HALF_THICK, b - WALL_H, HALF_THICK * 2, WALL_H, { fill: "#4a4f5c" });
          },
        });
      }
    }
  }
  return out;
}

function doorPieces(): Piece[] {
  return DOORS.flatMap((d): Piece[] => {
    if (d.dir === "h") {
      const pieces: Piece[] = [
        {
          layer: "floor",
          baseY: d.at,
          paint: (v) => v.rect(d.from, d.at - 2, d.to - d.from, 4, { fill: "rgba(0,0,0,0.25)" }),
        },
        {
          // The lintel over the gap: people walk under it.
          layer: "over",
          baseY: d.at,
          paint: (v) => {
            v.rect(d.from, d.at - HALF_THICK - WALL_H, d.to - d.from, HALF_THICK * 2, { fill: CAP });
            v.rect(d.from, d.at + HALF_THICK - WALL_H, d.to - d.from, 4, { fill: "#4a4f5c" });
          },
        },
      ];
      if (d.label !== undefined) {
        const label = d.label;
        const north = roomAt((d.from + d.to) / 2, d.at + 4) !== undefined;
        pieces.push({
          layer: "over",
          baseY: d.at,
          paint: (v) => {
            const cx = (d.from + d.to) / 2;
            const ty = north ? d.at - WALL_H - 12 : d.at + 12;
            v.text(label, { x: cx, y: ty }, { size: 6, fill: "#e5e7eb", align: "center", valign: "middle", halo: "#15171c" });
          },
        });
      }
      return pieces;
    }
    const pieces: Piece[] = [
      { layer: "floor", baseY: d.at, paint: (v) => v.rect(d.at - 2, d.from, 4, d.to - d.from, { fill: "rgba(0,0,0,0.25)" }) },
      { layer: "over", baseY: d.to, paint: (v) => v.rect(d.at - HALF_THICK, d.from - WALL_H, HALF_THICK * 2, d.to - d.from, { fill: CAP }) },
    ];
    if (d.label !== undefined) {
      const label = d.label;
      pieces.push({ layer: "over", baseY: d.to, paint: (v) => v.text(label, { x: d.at - 6, y: (d.from + d.to) / 2 - 4 }, { size: 6, fill: "#e5e7eb", align: "right", valign: "middle", halo: "#15171c" }) });
    }
    return pieces;
  });
}

// --- Floors --------------------------------------------------------------------------

const SKY_LIGHT: Record<Sky, string> = {
  sunset: "rgba(255,140,40,0.28)", "static-blue": "rgba(80,140,255,0.18)", "pink-sunset": "rgba(255,90,170,0.24)",
  clouds: "rgba(255,255,255,0.12)", "clear-birds": "rgba(140,220,255,0.16)", "still-clouds": "rgba(160,200,255,0.12)",
  night: "rgba(40,50,140,0.3)", overcast: "rgba(60,60,70,0.25)", "calm-static": "rgba(180,230,255,0.1)", teal: "rgba(60,220,200,0.12)",
};

function floorPiece(r: Room): Piece {
  const p = px(r);
  const w = p.x1 - p.x0, h = p.y1 - p.y0;
  return {
    layer: "floor",
    baseY: p.y0,
    room: r.id,
    paint: (v) => {
      const tiles = (a: string, b: string, size: number): void => {
        v.rect(p.x0, p.y0, w, h, { fill: a });
        for (let y = p.y0; y < p.y1; y += size) for (let x = p.x0 + (((y - p.y0) / size) % 2) * size; x < p.x1; x += size * 2) v.rect(x, y, Math.min(size, p.x1 - x), Math.min(size, p.y1 - y), { fill: b });
      };
      const grout = (color: string, size: number): void => {
        for (let x = p.x0; x <= p.x1; x += size) v.line(x, p.y0, x, p.y1, { stroke: color, weight: 0.6 });
        for (let y = p.y0; y <= p.y1; y += size) v.line(p.x0, y, p.x1, y, { stroke: color, weight: 0.6 });
      };
      switch (r.floor) {
        case "terracotta": tiles("#b8642f", "#c4703a", T); grout("rgba(60,25,10,0.35)", T); break;
        case "green-tile": tiles("#8fd3b0", "#a3dcbe", T / 2); grout("rgba(20,80,60,0.25)", T / 2); break;
        case "linoleum": v.rect(p.x0, p.y0, w, h, { fill: "#cfdcd4" }); for (let x = p.x0; x < p.x1; x += 24) v.line(x, p.y0, x, p.y1, { stroke: "rgba(80,110,95,0.25)", weight: 0.6 }); break;
        case "carpet-blue": v.rect(p.x0, p.y0, w, h, { fill: "#2c4572" }); for (let y = p.y0 + 4; y < p.y1; y += 8) for (let x = p.x0 + 4 + ((y / 8) % 2) * 4; x < p.x1; x += 8) v.circle(x, y, 0.8, { fill: "#3a5890" }); break;
        case "pool-deck": {
          tiles("#eadcd2", "#e2d2c6", T / 2);
          const pool = { x: p.x0 + 3 * T, y: p.y0 + 3.6 * T, w: 6 * T, h: 2.6 * T };
          v.roundRect(pool.x - 3, pool.y - 3, pool.w + 6, pool.h + 6, 4, { fill: "#f8f1ea" });
          v.rect(pool.x, pool.y, pool.w, pool.h, { fill: v.linearGradient(0, pool.y, 0, pool.y + pool.h, [[0, "#ff8fc0"], [0.35, "#5fb6d6"], [1, "#2a7fa6"]]) });
          v.rect(pool.x, pool.y, pool.w, 4, { fill: "rgba(0,0,0,0.18)" });
          break;
        }
        case "rubber": v.rect(p.x0, p.y0, w, h, { fill: "#43525c" }); grout("rgba(0,0,0,0.25)", T * 2); break;
        case "cafe": v.rect(p.x0, p.y0, w, h, { fill: "#b9874f" }); for (let y = p.y0; y < p.y1; y += 6) v.line(p.x0, y, p.x1, y, { stroke: "rgba(90,50,20,0.35)", weight: 0.6 }); break;
        case "yellow": v.rect(p.x0, p.y0, w, h, { fill: "#facc15" }); break;
        case "grey-carpet": v.rect(p.x0, p.y0, w, h, { fill: "#5b6070" }); break;
        case "stone": tiles("#a8a29e", "#9c9590", T); grout("rgba(40,35,30,0.3)", T); break;
      }
      // The sky screen's light on the floor, brightest under its middle.
      const cx = p.x0 + w / 2, cy = p.y0 + h / 2, rad = Math.max(w, h) * 0.7;
      v.rect(p.x0, p.y0, w, h, { fill: v.radialGradient(cx, cy, rad, [[0, SKY_LIGHT[r.sky]], [1, "rgba(0,0,0,0.12)"]]) });
    },
  };
}

// --- Sky screens (ceilings) -------------------------------------------------------------

function paintSky(v: View, r: Room, t: number): void {
  const p = px(r);
  // The ceiling sits on top of the walls, so it is drawn raised by the wall height.
  const x = p.x0 - HALF_THICK, y = p.y0 - WALL_H - HALF_THICK, w = p.x1 - p.x0 + HALF_THICK * 2, h = p.y1 - p.y0 + HALF_THICK * 2;
  const grad = (stops: [number, string][]): void => v.rect(x, y, w, h, { fill: v.linearGradient(0, y, 0, y + h, stops) });
  const hash = (i: number): number => {
    const s = Math.sin(i * 127.1 + r.rect[0] * 311.7 + r.rect[1] * 74.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const clouds = (n: number, color: string, drift: number): void => {
    for (let i = 0; i < n; i++) {
      const cx = x + ((hash(i) * w + drift) % w), cy = y + 8 + hash(i + 50) * (h - 16);
      for (const [dx, dy, rr] of [[0, 0, 7], [7, 2, 5], [-7, 2, 5], [3, -4, 5]] as const) v.circle(cx + dx, cy + dy, rr, { fill: color });
    }
  };
  v.clip([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], () => {
    switch (r.sky) {
      case "sunset": {
        grad([[0, "#3b1d5a"], [0.45, "#d9480f"], [0.7, "#ff9b3d"], [1, "#ffd27a"]]);
        v.circle(x + w / 2, y + h * 0.78, 22, { fill: "#fff1b8" });
        break;
      }
      case "static-blue": {
        grad([[0, "#1e3a8a"], [1, "#3b82f6"]]);
        for (let i = 0; i < 40; i++) {
          const on = (Math.floor(t / 4) + i * 7) % 13 < 3;
          if (on) v.rect(x + Math.floor(hash(i) * (w / 8)) * 8, y + Math.floor(hash(i + 9) * (h / 8)) * 8, 8, 8, { fill: hash(i + 3) < 0.5 ? "#e5e7eb" : "#111827" });
        }
        if (Math.floor(t / 30) % 3 === 0) v.text("ERR 0x0F", { x: x + w / 2, y: y + h / 2 }, { size: 10, fill: "#fca5a5", align: "center", valign: "middle", style: "bold" });
        break;
      }
      case "pink-sunset": {
        grad([[0, "#831843"], [0.5, "#ec4899"], [0.62, "#fb923c"], [1, "#fde68a"]]);
        const flicker = Math.sin(t * 0.7) > 0.6 ? 2 : 0;
        v.rect(x, y + h * 0.62 + flicker, w, 1.5, { fill: "#fff7ed" });
        break;
      }
      case "clouds": grad([[0, "#60a5fa"], [1, "#bfdbfe"]]); clouds(5, "#ffffff", Math.floor(t / 20) % 3 === 0 ? 0 : t * 0.3); break;
      case "clear-birds": {
        grad([[0, "#38bdf8"], [1, "#e0f2fe"]]);
        for (let i = 0; i < 5; i++) {
          const back = i % 2 === 1;
          const bx = x + (((hash(i) * w) + (back ? -t : t) * 0.8) % w + w) % w, by = y + 10 + hash(i + 20) * (h - 20);
          v.path([["move", bx - 4, by - 2], ["line", bx, by], ["line", bx + 4, by - 2]], { stroke: "#1e293b", weight: 1 });
        }
        break;
      }
      case "still-clouds": grad([[0, "#3b82f6"], [1, "#93c5fd"]]); clouds(3, "#ffffff", 0); break;
      case "night": {
        grad([[0, "#020617"], [1, "#1e1b4b"]]);
        for (let i = 0; i < 40; i++) v.circle(x + hash(i) * w, y + hash(i + 70) * h, 0.6 + 0.6 * Math.abs(Math.sin(t * 0.05 + i)), { fill: "#f8fafc" });
        const s = (t % 120) / 120;
        if (s < 0.3) v.line(x + w * (0.2 + s), y + h * (0.2 + s * 0.5), x + w * (0.2 + s) - 10, y + h * (0.2 + s * 0.5) - 4, { stroke: "#fef9c3", weight: 1.2 });
        break;
      }
      case "overcast": grad([[0, "#374151"], [1, "#6b7280"]]); clouds(6, "#4b5563", t * 0.1); break;
      case "calm-static": {
        grad([[0, "#7dd3fc"], [1, "#e0f2fe"]]);
        const band = (t * 1.5) % (h + 20) - 10;
        v.rect(x, y + band, w, 3, { fill: "rgba(255,255,255,0.6)" });
        break;
      }
      case "teal": grad([[0, "#0f766e"], [1, "#5eead4"]]); break;
    }
  });
  v.rect(x, y, w, h, { stroke: "#15171c", weight: 2 });
}

// --- Assembly -----------------------------------------------------------------------

function propPieces(): Piece[] {
  return PROPS.flatMap((prop): Piece[] => {
    const r = byId.get(prop.room);
    if (!r) return [];
    const x = (r.rect[0] + prop.at[0]) * T, y = (r.rect[1] + prop.at[1]) * T;
    if (onWall(prop)) {
      // Hung on the room's north wall face: drawn with that wall.
      const wallY = r.rect[1] * T + HALF_THICK;
      const fy = wallY - WALL_H / 2;
      return [{ layer: "standing", baseY: wallY + 0.01, room: r.id, paint: (v, t) => paintProp(v, { prop, x, y: fy, t }) }];
    }
    const base = y + ((prop.size?.[1] ?? 0) * T) / 2;
    return [{ layer: "standing", baseY: base, room: r.id, paint: (v, t) => paintProp(v, { prop, x, y, t }) }];
  });
}

/** Doors to the quarters, hung along the Hallway's north wall. */
function quartersPieces(): Piece[] {
  const hall = byId.get("Hallway");
  if (!hall) return [];
  const p = px(hall);
  const wallY = p.y0 + HALF_THICK;
  return QUARTERS.map((name, i): Piece => ({
    layer: "standing",
    baseY: wallY + 0.01,
    room: hall.id,
    paint: (v) => {
      const dx = p.x0 + 14 + i * 26;
      v.rect(dx, wallY - 18, 14, 18, { fill: name === "Yours" ? "#fef3c7" : "#d1fae5" });
      v.rect(dx, wallY - 18, 14, 18, { stroke: "#065f46", weight: 1 });
      v.circle(dx + 11, wallY - 9, 1, { fill: "#065f46" });
      v.text(name, { x: dx + 7, y: wallY - 24 }, { size: 4.2, fill: "#ecfdf5", align: "center", valign: "middle" });
    },
  }));
}

export const STATIC_PIECES: readonly Piece[] = [
  ...ROOMS.map(floorPiece),
  ...wallPieces(),
  ...doorPieces(),
  ...propPieces(),
  ...quartersPieces(),
];

export function ceilingPieces(show: (room: Room) => boolean): Piece[] {
  return ROOMS.filter(show).map((r): Piece => ({ layer: "ceiling", baseY: 0, room: r.id, paint: (v, t) => paintSky(v, r, t) }));
}

export function roomLabels(v: View): void {
  for (const r of ROOMS) {
    const p = px(r);
    v.text(r.name, { x: (p.x0 + p.x1) / 2, y: p.y0 + HALF_THICK + 9 }, { size: 7, fill: "#f8fafc", align: "center", valign: "middle", halo: "#15171c", style: "bold" });
  }
}

// --- The walk map --------------------------------------------------------------------

/** Walk grid resolution, px. */
export const WALK = 4;
export const WALK_W = (MAP_W * T) / WALK, WALK_H = (MAP_H * T) / WALK;
export type WalkCell = "wall" | "floor" | "blocked" | "door";

/** Whether a foot at (x, y) can stand there: on a room's floor, clear of its walls'
 * footprints and of every prop's footprint; or in a doorway. */
function walkAt(x: number, y: number): WalkCell {
  for (const d of DOORS) {
    const along = d.dir === "h" ? x : y, across = d.dir === "h" ? y : x;
    if (along > d.from + 3 && along < d.to - 3 && Math.abs(across - d.at) <= HALF_THICK + 4) return "door";
  }
  const r = ROOMS.find((room) => {
    const p = px(room);
    return x > p.x0 + HALF_THICK + 2 && x < p.x1 - HALF_THICK - 2 && y > p.y0 + HALF_THICK + 2 && y < p.y1 - HALF_THICK - 2;
  });
  if (!r) return "wall";
  for (const prop of PROPS) {
    if (prop.room !== r.id || prop.size === undefined || onWall(prop)) continue;
    const cx = (r.rect[0] + prop.at[0]) * T, cy = (r.rect[1] + prop.at[1]) * T;
    if (Math.abs(x - cx) < (prop.size[0] * T) / 2 + 2 && Math.abs(y - cy) < (prop.size[1] * T) / 2 + 2) return "blocked";
  }
  return "floor";
}
export const WALK_GRID: readonly WalkCell[] = Array.from({ length: WALK_W * WALK_H }, (_, k) => walkAt((k % WALK_W) * WALK + WALK / 2, Math.floor(k / WALK_W) * WALK + WALK / 2));
