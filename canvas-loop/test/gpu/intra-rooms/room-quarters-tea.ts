// The quarters off the Hallway: one room each, near-identical in shape (one door,
// back to the Hallway), each dressed by its occupant. From intra-game's quarters.ts.
//
// One shell for all twelve: a bed along the back wall with its headboard by the
// door, a desk and chair in the far corner, a wall shelf over the desk, a lamp,
// a nameplate. Each occupant's dressing adds to it (wall, furniture, live) and
// may put them in the room.
import type { Drawing, Vec2, View } from "@ianbicking/canvas-loop";
import { INK, type RoomSpec, at, blob, ellipsePts, glow, hash, mixHex, roundRectPts, stroke } from "./kit-tea.js";
import { frame, mascot, slab, stencil } from "./parts-c-tea.js";
import { type Citizen, amaEye, amaSpeaker, citizen, clock, crate, plant, poster, shellChair, tulipTable, vent } from "./props-tea.js";
import { PLANES, m } from "./sizes-tea.js";

// --- The shared shell ------------------------------------------------------------------------

const BED = { x0: 0.75, x1: 2.75, depth: 0.55 };
const DESK = { x0: 3.75, x1: 4.85 };
const SPEAKER: [number, number] = [3.15, 2.55];

interface Bed {
  blanket: string;
  /** 0 made tight, 1 slept in, 2 a heap. */
  mess: number;
}

function bed(v: View, b: Bed, seed: number): Drawing {
  const out: Drawing[] = [];
  const { x0, x1, depth } = BED;
  const [hx, fy] = at(x0, 0, depth);
  // Headboard by the door, a 70s rounded slab, and a low footboard.
  out.push(blob(v, roundRectPts(hx - 8, fy - m(0.95), 22, m(0.95), 9), { fill: "#8a6a42", light: "#a8885a", dark: "#4a3620", seed, line: 2.2 }));
  out.push(slab(v, { x0: x0 + 0.08, x1, h0: 0.12, h1: 0.32, depth }, { fill: "#6a5034", seed: seed + 1 }));
  for (const lx of [x0 + 0.12, x1 - 0.1]) out.push(slab(v, { x0: lx - 0.03, x1: lx + 0.03, h0: 0, h1: 0.13, depth }, { fill: "#3a2a1a", seed: seed + 2 + lx, line: 1.2 }));
  out.push(slab(v, { x0: x0 + 0.1, x1: x1 - 0.02, h0: 0.32, h1: 0.48, depth }, { fill: "#e8e4d8", seed: seed + 3 }));
  // Pillow, blanket.
  const [px, py] = at(x0 + 0.32, 0.5, depth);
  out.push(blob(v, roundRectPts(px - 26, py - 12, 52, 18, 8), { fill: "#f4f0e8", light: "#ffffff", seed: seed + 4, line: 1.6 }));
  const [bx0, by] = at(x0 + 0.62, 0.48, depth), [bx1] = at(x1 - 0.02, 0.48, depth);
  const c = b.blanket, hi = mixHex(c, "#ffffff", 0.3), lo = mixHex(c, "#000000", 0.3);
  if (b.mess === 0) {
    out.push(blob(v, [[bx0, by - 6], [bx1 + 2, by - 6], [bx1 + 2, by + 20], [bx0, by + 20]], { fill: c, light: hi, dark: lo, seed: seed + 5, line: 1.8, amp: 0.4 }));
    out.push(v.line(bx0 + 4, by + 2, bx1 - 2, by + 2, { stroke: "#f4f0e8", weight: 3 }));
  } else {
    const lump = b.mess === 2 ? 30 : 12;
    out.push(blob(v, [[bx0 - 20, by + 2], [bx0 + 30, by - lump], [bx0 + 90, by - 4], [bx0 + 150, by - lump * 0.8], [bx1 + 6, by - 2], [bx1 + 10, by + 30], [bx0 + 60, by + 26], [bx0 - 10, by + 22]], { fill: c, light: hi, dark: lo, seed: seed + 5, line: 1.8, shadeSide: "bottom" }));
  }
  return out;
}

function desk(v: View, colour: string, seed: number): Drawing {
  const out: Drawing[] = [];
  const { x0, x1 } = DESK;
  const d = PLANES.wall;
  out.push(slab(v, { x0, x1, h0: 0.7, h1: 0.76, depth: d }, { fill: colour, seed, line: 2 }));
  out.push(slab(v, { x0: x0 + 0.03, x1: x0 + 0.08, h0: 0, h1: 0.7, depth: d }, { fill: mixHex(colour, "#000000", 0.3), seed: seed + 1, line: 1.4 }));
  out.push(slab(v, { x0: x1 - 0.45, x1: x1 - 0.03, h0: 0, h1: 0.7, depth: d }, { fill: colour, seed: seed + 2, shade: true }));
  for (let k = 0; k < 3; k++) {
    const [kx, ky] = at(x1 - 0.24, 0.58 - k * 0.22, d);
    out.push(v.line(kx - 10, ky, kx + 10, ky, { stroke: "#c9a46a", weight: 3 }));
    out.push(v.line(at(x1 - 0.45, 0.7 - (k + 1) * 0.22, d)[0], at(0, 0.7 - (k + 1) * 0.22, d)[1], at(x1 - 0.03, 0, d)[0], at(0, 0.7 - (k + 1) * 0.22, d)[1], { stroke: INK, weight: 1.2 }));
  }
  return out;
}

/** A desk lamp: chrome dome on a stem. Its light is drawn per frame. */
function deskLamp(v: View, x: number, colour: string): Drawing {
  const [px, py] = at(x, 0.76, PLANES.wall);
  return [
    blob(v, ellipsePts(px, py - 3, 14, 4), { fill: "#4a4a4e", seed: 7000 + x, line: 1.4 }),
    stroke(v, [[px, py - 4], [px + 6, py - 50], [px + 22, py - 60]], { seed: 7001 + x, weight: 3, colour: "#8a8e94" }),
    blob(v, [[px + 10, py - 60], [px + 40, py - 66], [px + 46, py - 50], [px + 18, py - 46]], { fill: colour, light: mixHex(colour, "#ffffff", 0.4), seed: 7002 + x, line: 1.8 }),
  ];
}
function lampLight(v: View, x: number, colour: string, alpha: number): Drawing {
  const [px, py] = at(x, 0.76, PLANES.wall);
  return glow(v, px + 34, py - 20, { rx: 110, ry: 80, colour, alpha });
}

function nameplate(v: View, name: string, colour: string): Drawing {
  const [x, y] = at(3.15, 1.95, 0);
  return [
    blob(v, roundRectPts(x - 46, y - 12, 92, 24, 4), { fill: "#d8d0c0", seed: 7010, line: 1.6 }),
    v.rect(x - 42, y - 8, 8, 16, { fill: colour }),
    v.text(name.toUpperCase(), { x: x + 4, y }, { size: 9, fill: "#2a2018", align: "center", valign: "middle", style: "bold" }),
  ];
}

// --- Dressings --------------------------------------------------------------------------------

interface Dress {
  bed: Bed;
  deskColour?: string;
  lamp?: string;
  wall?: (v: View) => Drawing;
  furniture?: (v: View) => Drawing;
  live?: (v: View, t: number) => Drawing;
  /** The occupant, if home. */
  occupant?: Omit<Citizen, "collar">;
}

/** A label-maker strip: black tape, white raised letters. */
function label(v: View, text: string, p: Vec2, rotate = 0): Drawing {
  const w = text.length * 5.6 + 8;
  return v.at({ translate: p, rotate }, [
    v.rect(-w / 2, -6, w, 12, { fill: "#1a1a1e" }),
    v.text(text, { x: 0, y: 0 }, { size: 7, fill: "#f0f0f0", align: "center", valign: "middle", style: "bold", font: "Courier New, monospace" }),
  ]);
}

/** A stack of books or binders, standing (px, y the base). Colours cycle. */
function stack(v: View, x: number, y: number, n: number, a: { w: number; colours: readonly string[]; seed: number; askew?: number }): Drawing {
  const out: Drawing[] = [];
  let top = y;
  for (let i = 0; i < n; i++) {
    const h = 7 + hash(i, 0, a.seed) * 5, dx = a.askew === undefined ? 0 : (hash(i, 1, a.seed) - 0.5) * a.askew;
    out.push(blob(v, [[x + dx, top], [x + dx + a.w, top], [x + dx + a.w, top - h], [x + dx, top - h]], { fill: a.colours[i % a.colours.length] ?? "#c8c0a8", seed: a.seed + i, line: 1.2, amp: 0.3 }));
    top -= h;
  }
  return out;
}

/** A sheet of paper lying or pinned at p, tilted. */
function sheet(v: View, p: Vec2, a: { rotate: number; seed: number; w?: number; h?: number; colour?: string }): Drawing {
  const w = a.w ?? 18, h = a.h ?? 22;
  return v.at({ translate: p, rotate: a.rotate }, ((): Drawing => {
    const drawn: Drawing[] = [];
    drawn.push(blob(v, [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]], { fill: a.colour ?? "#f4f0e0", seed: a.seed, line: 1, amp: 0.3 }));
    for (let k = 0; k < 3; k++) drawn.push(v.line(-w / 2 + 3, -h / 2 + 5 + k * 5, w / 2 - 3 - hash(k, 0, a.seed) * 6, -h / 2 + 5 + k * 5, { stroke: "rgba(40,40,60,0.6)", weight: 0.8 }));
    return drawn;
  })());
}

/** A crumpled paper ball. */
function crumple(v: View, p: Vec2, seed: number, r = 7): Drawing {
  return [
    blob(v, ellipsePts(p[0], p[1], r, r * 0.85, 9), { fill: "#ece6d0", dark: "#a8a088", seed, line: 1.2, amp: 1.2 }),
    stroke(v, [[p[0] - r * 0.5, p[1] - 1], [p[0] + r * 0.3, p[1] + 2]], { seed: seed + 1, weight: 0.8 }),
  ];
}

/** A wall clock showing the frame's time (ticks once a second at 60 fps). */
function tickingClock(v: View, x: number, h: number, t: number): Drawing {
  const out: Drawing[] = [];
  out.push(clock(v, x, h, 3 + (Math.floor(t / 60) % 60) / 60));
  const [cx, cy] = at(x, h, 0);
  const a = ((Math.floor(t / 60) % 60) / 60) * Math.PI * 2 - Math.PI / 2;
  out.push(v.line(cx, cy, cx + Math.cos(a) * 15, cy + Math.sin(a) * 15, { stroke: "#c82a1a", weight: 1 }));
  return out;
}

const DOUG: Dress = {
  bed: { blanket: "#c86a3a", mess: 2 },
  wall: (v) => {
    const out: Drawing[] = [];
    out.push(poster(v, 1.7, "fresh", { h: 1.65, seed: 7100 }));
    out.push(frame(v, { x: 4.3, h: 1.65, w: 0.36, hh: 0.28, tilt: 0.2, seed: 7110 }, (w, h) => {
      return [
        blob(v, ellipsePts(0, 0, w * 0.3, h * 0.22), { fill: "#e8a03a", seed: 7111, line: 1.2 }),
        blob(v, [[w * 0.28, 0], [w * 0.42, -h * 0.18], [w * 0.42, h * 0.18]], { fill: "#e8a03a", seed: 7112, line: 1.2 }),
        v.circle(-w * 0.15, -h * 0.04, 1.6, { fill: INK }),
      ];
    }));
    // A hat on a nail, a rubber chicken on another.
    const [hx, hy] = at(2.95, 1.45, 0);
    out.push(blob(v, [[hx - 18, hy], [hx + 18, hy], [hx + 10, hy - 16], [hx - 10, hy - 16]], { fill: "#3a6a3a", seed: 7120, line: 1.6 }));
    out.push(blob(v, ellipsePts(hx, hy, 26, 4), { fill: "#3a6a3a", seed: 7121, line: 1.4 }));
    const [cx, cy] = at(3.55, 1.25, 0);
    out.push(blob(v, [[cx - 4, cy], [cx + 4, cy], [cx + 6, cy + 40], [cx - 6, cy + 40]], { fill: "#f0d040", seed: 7122, line: 1.4 }));
    out.push(blob(v, ellipsePts(cx, cy + 46, 9, 7), { fill: "#f0d040", seed: 7123, line: 1.4 }));
    out.push(blob(v, [[cx + 6, cy + 46], [cx + 14, cy + 48], [cx + 6, cy + 50]], { fill: "#e86a2a", seed: 7124, line: 1 }));
    return out;
  },
  furniture: (v) => {
    const out: Drawing[] = [];
    // Desk heaped: a globe, a toaster, a mug, a lava lamp (its blobs move per frame).
    const [dx, dy] = at(DESK.x0 + 0.12, 0.76, PLANES.wall);
    out.push(stack(v, dx, dy, 4, { w: 30, colours: ["#c84a3a", "#3a6ac8", "#e8c83a"], seed: 7130, askew: 12 }));
    out.push(blob(v, ellipsePts(dx + 60, dy - 22, 18, 18), { fill: "#4a8ac8", light: "#7ab0e8", seed: 7131, line: 1.6 }));
    out.push(blob(v, [[dx + 46, dy - 22], [dx + 76, dy - 30], [dx + 52, dy - 16]], { fill: "#5aa84a", seed: 7132, line: 1 }));
    out.push(blob(v, roundRectPts(dx + 112, dy - 30, 26, 30, 4), { fill: "#c8ccd0", light: "#ffffff", seed: 7133, line: 1.6 }));
    // The toaster, on the bed.
    const [tx, ty] = at(2.2, 0.5, BED.depth);
    out.push(blob(v, roundRectPts(tx - 18, ty - 24, 36, 24, 6), { fill: "#c8ccd0", light: "#ffffff", dark: "#6a6e74", seed: 7134, line: 1.8 }));
    out.push(v.rect(tx - 10, ty - 27, 6, 4, { fill: "#d8a050" }));
    out.push(v.rect(tx + 4, ty - 27, 6, 4, { fill: "#d8a050" }));
    // On the floor: a traffic cone, a bowling pin, crates, a sock.
    const [cx, cy] = at(3.35, 0, 1.6);
    out.push(blob(v, [[cx - 20, cy], [cx + 20, cy], [cx + 4, cy - 58], [cx - 4, cy - 58]], { fill: "#f86a2a", seed: 7140, line: 2 }));
    out.push(v.line(cx - 12, cy - 22, cx + 12, cy - 22, { stroke: "#f8f0e0", weight: 5 }));
    out.push(blob(v, roundRectPts(cx - 26, cy - 6, 52, 6, 2), { fill: "#2a2a2a", seed: 7141, line: 1.2 }));
    const [px, py] = at(1.25, 0, 2.2);
    out.push(v.at({ translate: [px, py - 6], rotate: 1.35 }, blob(v, [[-6, 20], [6, 20], [8, 4], [4, -6], [5, -16], [0, -22], [-5, -16], [-4, -6], [-8, 4]], { fill: "#f4f0e8", seed: 7142, line: 1.6 })));
    out.push(crate(v, 5.0, 0.9, { w: 0.35, h: 0.3, seed: 7143 }));
    // A bicycle wheel leaning on the wall (there are no bicycles in Intra).
    const [wx, wy] = at(3.3, 0.36, 0.4);
    out.push(v.circle(wx, wy, 50, { stroke: "#2a2a2a", weight: 5 }));
    for (let k = 0; k < 8; k++) out.push(v.line(wx, wy, wx + Math.cos(k * 0.785) * 48, wy + Math.sin(k * 0.785) * 48, { stroke: "#a8acb0", weight: 1 }));
    out.push(v.circle(wx, wy, 5, { fill: "#8a8e94" }));
    const [sx, sy] = at(2.4, 0, 2.0);
    out.push(blob(v, [[sx, sy], [sx + 24, sy - 2], [sx + 30, sy - 10], [sx + 22, sy - 12], [sx + 18, sy - 6], [sx, sy - 8]], { fill: "#e8e0d0", seed: 7145, line: 1.2 }));
    return out;
  },
  live: (v, t) => {
    const out: Drawing[] = [];
    // The lava lamp on the desk.
    const [lx, ly] = at(DESK.x0 + 0.62, 0.76, PLANES.wall);
    out.push(blob(v, [[lx - 10, ly], [lx + 10, ly], [lx + 6, ly - 12], [lx - 6, ly - 12]], { fill: "#5a5a60", seed: 7150, line: 1.4 }));
    out.push(v.polygon([[lx - 6, ly - 12], [lx + 6, ly - 12], [lx + 10, ly - 44], [lx + 4, ly - 60], [lx - 4, ly - 60], [lx - 10, ly - 44]], { fill: "rgba(255,120,60,0.55)" }));
    for (let k = 0; k < 3; k++) out.push(v.ellipse(lx + Math.sin(t * 0.03 + k) * 2, ly - 18 - (((t * 0.3 + k * 15) % 40)), 4, 5 + Math.sin(t * 0.05 + k), { fill: "#ff4a8a" }));
    out.push(glow(v, lx, ly - 36, { rx: 60, colour: "#ff6a8a", alpha: 0.3 }));
    return out;
  },
  occupant: { x: 1.6, depth: 0.95, facing: 1, pose: "sit", suit: "#a84a5a", number: "08", hair: "#c87a3a", skin: "#e8b090" },
};

const MARTA: Dress = {
  bed: { blanket: "#d86a9a", mess: 0 },
  deskColour: "#e8e0d0",
  wall: (v) => {
    const out: Drawing[] = [];
    out.push(frame(v, { x: 1.75, h: 1.6, w: 0.5, hh: 0.34, seed: 7200, colour: "#c8a040" }, (w, h) => {
      return [
        v.text("TIDINESS", { x: 0, y: -h * 0.25 }, { size: 8, fill: "#3a2a40", align: "center", valign: "middle", style: "bold" }),
        v.text("CITATION", { x: 0, y: -h * 0.05 }, { size: 8, fill: "#3a2a40", align: "center", valign: "middle", style: "bold" }),
        v.text("x 12", { x: 0, y: h * 0.25 }, { size: 10, fill: "#c83a6a", align: "center", valign: "middle", style: "bold" }),
        v.line(-w * 0.4, h * 0.42, w * 0.4, h * 0.42, { stroke: "#c8a040", weight: 1 }),
      ];
    }));
    // A wall shelf of labelled boxes, edges flush.
    const [sx, sy] = at(DESK.x0 + 0.05, 1.45, 0);
    out.push(v.rect(sx, sy, m(1.0), 6, { fill: "#e8e0d0", stroke: INK, weight: 1.4 }));
    for (const [i, l] of ["SOCKS L", "SOCKS R", "LABELS"].entries()) {
      out.push(blob(v, [[sx + 6 + i * 48, sy], [sx + 46 + i * 48, sy], [sx + 46 + i * 48, sy - 32], [sx + 6 + i * 48, sy - 32]], { fill: "#f0c8d8", seed: 7210 + i, line: 1.4, amp: 0.2 }));
      out.push(label(v, l, [sx + 26 + i * 48, sy - 16]));
    }
    out.push(label(v, "WALL", at(2.4, 1.15, 0)));
    out.push(label(v, "AMA (LISTENING)", [at(SPEAKER[0], SPEAKER[1], 0)[0], at(SPEAKER[0], SPEAKER[1], 0)[1] - 34]));
    return out;
  },
  furniture: (v) => {
    const out: Drawing[] = [];
    out.push(label(v, "BED", at(1.7, 0.22, BED.depth)));
    out.push(label(v, "DESK", at(DESK.x1 - 0.24, 0.66, PLANES.wall)));
    // Three objects in a row, a ruler laid parallel to the desk's edge.
    const [dx, dy] = at(DESK.x0 + 0.12, 0.76, PLANES.wall);
    out.push(v.rect(dx, dy - 3, m(0.5), 3, { fill: "#e8c83a", stroke: INK, weight: 0.8 }));
    for (let k = 0; k < 3; k++) out.push(blob(v, roundRectPts(dx + 6 + k * 24, dy - 24, 14, 20, 3), { fill: ["#f0c8d8", "#c8d8f0", "#d8f0c8"][k] ?? "#fff", seed: 7220 + k, line: 1.2, amp: 0.2 }));
    // A square taped on the floor where the chair belongs, and the chair in it.
    const [qx, qy] = at(3.35, 0, 1.0);
    out.push(v.polygon([[qx - 30, qy - 6], [qx + 30, qy - 6], [qx + 34, qy + 8], [qx - 34, qy + 8]], { stroke: "#f8f048", weight: 2 }));
    out.push(shellChair(v, 3.35, 1.0, { colour: "#d86a9a", facing: 1, seed: 7230 }));
    return out;
  },
  live: (v, t) => tickingClock(v, 2.6, 2.3, t),
  occupant: { x: 2.0, depth: 2.2, facing: 1, pose: "stand", suit: "#d8c8d0", number: "03", hair: "#1a1a1a", skin: "#c88a60" },
};

const FRIDA_NOTES: readonly [number, number][] = [[0.3, 1.75], [0.55, 1.5], [0.3, 1.25], [0.6, 1.95], [0.85, 1.7], [0.9, 1.3]];
const FRIDA: Dress = {
  bed: { blanket: "#c8a83a", mess: 1 },
  wall: (v) => {
    const out: Drawing[] = [];
    // A cork board crammed with notes and red string.
    const [bx, by] = at(1.15, 1.25, 0), [ex, ey] = at(2.75, 2.15, 0);
    out.push(blob(v, [[bx, by], [ex, by], [ex, ey], [bx, ey]], { fill: "#b88a58", dark: "#7a5a30", seed: 7300, line: 2.2 }));
    const pins: Vec2[] = FRIDA_NOTES.map(([u, h]) => at(1.15 + u * 1.6, h, 0));
    for (const [i, p] of pins.entries()) out.push(sheet(v, p, { rotate: (hash(i, 0, 7301) - 0.5) * 0.4, seed: 7302 + i, colour: i % 3 === 0 ? "#f8f0a0" : "#f4f0e0" }));
    for (let i = 0; i + 1 < pins.length; i++) {
      const p = pins[i] ?? [0, 0], q = pins[(i + 3) % pins.length] ?? p;
      out.push(v.line(p[0], p[1] - 8, q[0], q[1] - 8, { stroke: "#c82a2a", weight: 1.2 }));
    }
    for (const p of pins) out.push(v.circle(p[0], p[1] - 8, 2.4, { fill: "#c82a2a" }));
    // More notes, escaping across the wall.
    for (let i = 0; i < 9; i++) out.push(sheet(v, at(2.9 + hash(i, 0, 7320) * 2.0, 1.2 + hash(i, 1, 7320) * 1.0, 0), { rotate: (hash(i, 2, 7320) - 0.5) * 0.6, seed: 7321 + i, w: 14, h: 16, colour: i % 2 === 0 ? "#f8f0a0" : "#f4f0e0" }));
    return out;
  },
  furniture: (v) => {
    const out: Drawing[] = [];
    const [dx, dy] = at(DESK.x0 + 0.06, 0.76, PLANES.wall);
    out.push(stack(v, dx, dy, 9, { w: 34, colours: ["#f4f0e0", "#f8f0a0", "#e8e4d8"], seed: 7330, askew: 8 }));
    out.push(stack(v, dx + 110, dy, 6, { w: 30, colours: ["#f4f0e0", "#e8e4d8"], seed: 7340, askew: 10 }));
    // A typewriter.
    out.push(blob(v, [[dx + 44, dy], [dx + 100, dy], [dx + 96, dy - 20], [dx + 48, dy - 22]], { fill: "#3a5a4a", light: "#5a7a6a", seed: 7350, line: 1.8 }));
    out.push(blob(v, roundRectPts(dx + 46, dy - 30, 52, 8, 3), { fill: "#2a2a2a", seed: 7351, line: 1.2 }));
    out.push(sheet(v, [dx + 72, dy - 40], { rotate: 0, seed: 7352, w: 26, h: 22 }));
    // Papers across the bed and the floor, piles leaning, pens.
    for (let i = 0; i < 8; i++) out.push(sheet(v, at(1.0 + hash(i, 0, 7360) * 1.6, 0.5, BED.depth + hash(i, 1, 7360) * 0.2), { rotate: (hash(i, 2, 7360) - 0.5) * 1.2, seed: 7361 + i, w: 22, h: 10 }));
    for (const [k, [x, d]] of ([[3.05, 1.2], [3.45, 1.9], [1.3, 2.3], [4.9, 1.5]] as const).entries()) {
      const [px, py] = at(x, 0, d);
      out.push(stack(v, px - 18, py, 4 + k * 2, { w: 36, colours: ["#f4f0e0", "#f8f0a0", "#e8e4d8"], seed: 7370 + k * 10, askew: 6 }));
    }
    for (let i = 0; i < 6; i++) {
      const [px, py] = at(0.9 + hash(i, 0, 7390) * 4.0, 0, 1.5 + hash(i, 1, 7390) * 1.2);
      out.push(v.at({ translate: [px, py], rotate: hash(i, 2, 7390) * 3 }, v.rect(-10, -1.5, 20, 3, { fill: ["#2a4ac8", "#c82a2a", "#1a1a1a"][i % 3] ?? "#000" })));
    }
    return out;
  },
  live: (v, t) => {
    // A sheet drifting down from the cork board, again and again.
    const u = (t % 120) / 120;
    const [sx, sy] = at(2.3, 1.9, 0.3);
    const [, fy] = at(2.3, 0, 1.6);
    return sheet(v, [sx + Math.sin(u * 9) * 26 + u * 40, sy + (fy - sy) * u], { rotate: Math.sin(u * 9) * 0.6, seed: 7395, w: 16, h: 18, colour: "#f8f0a0" });
  },
  occupant: { x: 3.4, depth: 1.05, facing: 1, pose: "sit", suit: "#a88a3a", number: "21", hair: "#8a4a2a", skin: "#e8b898" },
};

const JUNE: Dress = {
  bed: { blanket: "#5aa8a0", mess: 0 },
  deskColour: "#d8d0c0",
  wall: (v) => {
    const out: Drawing[] = [];
    // A scroll: the brush stroke says BREATHE; a smaller hand adds the rest.
    const [sx, sy] = at(4.3, 1.75, 0);
    out.push(blob(v, [[sx - 22, sy - 60], [sx + 22, sy - 60], [sx + 22, sy + 60], [sx - 22, sy + 60]], { fill: "#f4f0e4", seed: 7400, line: 1.4 }));
    for (const y of [sy - 62, sy + 62]) out.push(blob(v, roundRectPts(sx - 28, y - 4, 56, 8, 4), { fill: "#5a3a2a", seed: 7401 + y, line: 1.2 }));
    for (const [i, l] of ["B", "R", "E", "A", "T", "H", "E"].entries()) out.push(v.text(l, { x: sx, y: sy - 48 + i * 13 }, { size: 12, fill: "#1a1a1a", align: "center", valign: "middle", style: "bold", font: "Georgia, serif" }));
    out.push(v.text("(mandatory)", { x: sx, y: sy + 52 }, { size: 6, fill: "#8a1a1a", align: "center", valign: "middle", style: "italic" }));
    return out;
  },
  furniture: (v) => {
    const out: Drawing[] = [];
    // A plastic bonsai, a sand tray with raked lines, one sock where it should not be.
    const [bx, by] = at(DESK.x0 + 0.3, 0.76, PLANES.wall);
    out.push(blob(v, roundRectPts(bx - 18, by - 10, 36, 10, 3), { fill: "#3a5a5a", seed: 7410, line: 1.4 }));
    out.push(stroke(v, [[bx, by - 10], [bx - 4, by - 26], [bx + 6, by - 36]], { seed: 7411, weight: 3, colour: "#5a3a2a" }));
    for (const [dx, dy, r] of [[-8, -30, 12], [10, -40, 10], [2, -48, 8]] as const) out.push(blob(v, ellipsePts(bx + dx, by + dy, r, r * 0.6), { fill: "#3ac85a", seed: 7412 + dx, line: 1.2 }));
    const [tx, ty] = at(3.4, 0, 1.6);
    out.push(blob(v, [[tx - 50, ty], [tx + 50, ty], [tx + 46, ty - 12], [tx - 46, ty - 12]], { fill: "#e8d8b0", dark: "#a8987a", seed: 7420, line: 1.8 }));
    for (let k = 0; k < 4; k++) out.push(v.curve([[tx - 40, ty - 10 + k * 3], [tx, ty - 8 + k * 3 + Math.sin(k) * 2], [tx + 40, ty - 10 + k * 3]], false, { stroke: "#a8987a", weight: 0.8 }));
    out.push(blob(v, ellipsePts(tx + 20, ty - 18, 8, 6), { fill: "#8a8a8e", seed: 7421, line: 1.2 }));
    const [sx, sy] = at(2.0, 0, 2.4);
    out.push(blob(v, [[sx, sy], [sx + 22, sy - 2], [sx + 28, sy - 10], [sx + 20, sy - 12], [sx + 16, sy - 6], [sx, sy - 8]], { fill: "#e84a8a", seed: 7430, line: 1.2 }));
    out.push(plant(v, 4.95, 0.6, { h: 0.6, seed: 7440 }));
    return out;
  },
  live: (v, t) => {
    const out: Drawing[] = [];
    // The picture over the bed will not hang straight.
    const tilt = 0.06 + Math.sin(t * 0.02) * 0.05;
    out.push(frame(v, { x: 1.75, h: 1.6, w: 0.5, hh: 0.34, tilt, seed: 7450, colour: "#5a3a2a" }, (w, h) => {
      return [
        v.rect(-w / 2, -h / 2, w, h, { fill: "#a8d8d0" }),
        v.circle(0, -h * 0.05, h * 0.22, { fill: "#f8f0e0" }),
        v.line(-w / 2, h * 0.25, w / 2, h * 0.25, { stroke: "#3a6a6a", weight: 2 }),
      ];
    }));
    // Incense smoke from the tray's stone.
    const [ix, iy] = at(3.55, 0.12, 1.6);
    for (let k = 0; k < 6; k++) {
      const u = ((t * 0.6 + k * 20) % 120) / 120;
      out.push(v.circle(ix + Math.sin(u * 8 + k) * 10 * u, iy - u * 160, 3 + u * 8, { fill: `rgba(220,230,230,${((1 - u) * 0.35).toFixed(3)})` }));
    }
    return out;
  },
  occupant: { x: 2.8, depth: 2.3, facing: -1, pose: "stand", suit: "#3a8a8a", number: "17", hair: "#1a1a1a", skin: "#d8a878" },
};

const LANA: Dress = {
  bed: { blanket: "#5ac87a", mess: 0 },
  wall: (v) => {
    const out: Drawing[] = [];
    // The mood dial (its needle moves per frame) and speakers on a shelf.
    const [cx, cy] = at(1.75, 1.65, 0);
    out.push(blob(v, roundRectPts(cx - 60, cy - 44, 120, 74, 8), { fill: "#e8e4d8", seed: 7500, line: 2 }));
    const bands = ["#5a8ae8", "#5ac8a8", "#8ae85a", "#e8c83a", "#e86a3a"];
    for (const [i, c] of bands.entries()) out.push(v.arc(cx, cy + 14, 44, Math.PI + (i * Math.PI) / 5, Math.PI + ((i + 1) * Math.PI) / 5, { stroke: c, weight: 10 }));
    out.push(v.text("MOOD", { x: cx, y: cy + 22 }, { size: 8, fill: "#2a2a2e", align: "center", valign: "middle", style: "bold" }));
    const [sx, sy] = at(DESK.x0 + 0.05, 1.5, 0);
    out.push(v.rect(sx, sy, m(1.0), 6, { fill: "#4a4a4e", stroke: INK, weight: 1.4 }));
    for (const dx of [10, m(1.0) - 50]) {
      out.push(blob(v, roundRectPts(sx + dx, sy - 50, 40, 50, 6), { fill: "#3a3a3e", seed: 7510 + dx, line: 1.6 }));
      out.push(blob(v, ellipsePts(sx + dx + 20, sy - 30, 13, 13), { fill: "#5a5a60", seed: 7511 + dx, line: 1.4 }));
    }
    return out;
  },
  furniture: (v) => {
    return [
      shellChair(v, 3.35, 1.0, { colour: "#5ac87a", facing: 1, seed: 7520 }),
      plant(v, 4.95, 0.7, { h: 0.7, seed: 7530 }),
    ];
  },
  live: (v, t) => {
    const out: Drawing[] = [];
    // The light shifts through the day's planned moods.
    const hues = ["#ff9a8a", "#ffd08a", "#9affb0", "#8ad0ff", "#c89aff"];
    const p = (t / 90) % hues.length, i = Math.floor(p), f = p - i;
    const c = mixHex(hues[i] ?? "#fff", hues[(i + 1) % hues.length] ?? "#fff", f);
    out.push(glow(v, m(2.6), at(0, 1.6, 1)[1], { rx: m(3.2), ry: 300, colour: c, alpha: 0.42 }));
    const [cx, cy] = at(1.75, 1.65, 0);
    const a = Math.PI + (0.4 + 0.15 * Math.sin(t * 0.03)) * Math.PI;
    out.push(v.line(cx, cy + 14, cx + Math.cos(a) * 38, cy + 14 + Math.sin(a) * 38, { stroke: "#1a1a1a", weight: 2 }));
    out.push(v.text("OPTIMAL", { x: cx, y: cy + 4 }, { size: 7, fill: "#2a8a4a", align: "center", valign: "middle", style: "bold" }));
    // Soft music: notes floating from the speakers.
    const [sx, sy] = at(DESK.x0 + 0.05, 1.5, 0);
    for (let k = 0; k < 4; k++) {
      const u = ((t + k * 25) % 100) / 100;
      const nx = sx + 30 + (k % 2) * m(0.7) + Math.sin(u * 6 + k) * 10, ny = sy - 60 - u * 120;
      const al = (1 - u) * 0.8;
      out.push(v.ellipse(nx, ny, 4, 3, { fill: `rgba(40,40,50,${al.toFixed(3)})` }));
      out.push(v.line(nx + 4, ny, nx + 4, ny - 14, { stroke: `rgba(40,40,50,${al.toFixed(3)})`, weight: 1.4 }));
    }
    return out;
  },
  occupant: { x: 3.2, depth: 1.0, facing: 1, pose: "sit", suit: "#3a8a5a", number: "11", hair: "#e8c870", skin: "#e8c0a0" },
};

const HAROLD: Dress = {
  bed: { blanket: "#6a72c8", mess: 0 },
  deskColour: "#5a4a3a",
  wall: (v) => {
    const out: Drawing[] = [];
    out.push(frame(v, { x: 1.75, h: 1.65, w: 0.6, hh: 0.36, seed: 7600, colour: "#3a2a1a" }, (w, h) => {
      return [
        v.text("RULE 1: FOLLOW", { x: 0, y: -h * 0.28 }, { size: 8, fill: "#1a1a3a", align: "center", valign: "middle", style: "bold" }),
        v.text("THE RULES.", { x: 0, y: -h * 0.08 }, { size: 8, fill: "#1a1a3a", align: "center", valign: "middle", style: "bold" }),
        v.text("RULE 2: SEE RULE 1.", { x: 0, y: h * 0.22 }, { size: 7, fill: "#8a1a1a", align: "center", valign: "middle", style: "bold" }),
        v.line(-w * 0.4, h * 0.05, w * 0.4, h * 0.05, { stroke: "#1a1a3a", weight: 0.8 }),
      ];
    }));
    // Binders, volume I to XII, on a wall shelf.
    const [sx, sy] = at(DESK.x0 + 0.02, 1.45, 0);
    out.push(v.rect(sx, sy, m(1.05), 6, { fill: "#5a4a3a", stroke: INK, weight: 1.4 }));
    const vols = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];
    for (const [i, vol] of vols.entries()) {
      out.push(blob(v, [[sx + 2 + i * 12.5, sy], [sx + 13 + i * 12.5, sy], [sx + 13 + i * 12.5, sy - 44], [sx + 2 + i * 12.5, sy - 44]], { fill: i % 2 === 0 ? "#3a4a8a" : "#4a5aa0", seed: 7610 + i, line: 1, amp: 0.2 }));
      out.push(v.at({ translate: [sx + 7.5 + i * 12.5, sy - 22], rotate: -Math.PI / 2 }, v.text(vol, { x: 0, y: 0 }, { size: 7, fill: "#f0e8d0", align: "center", valign: "middle", style: "bold" })));
    }
    return out;
  },
  furniture: (v) => {
    const out: Drawing[] = [];
    // Rulebooks in square towers: on the desk, at the bed's foot, by the chair.
    const [dx, dy] = at(DESK.x0 + 0.08, 0.76, PLANES.wall);
    out.push(stack(v, dx, dy, 8, { w: 34, colours: ["#3a4a8a", "#8a2a2a", "#2a2a2a"], seed: 7620 }));
    out.push(stack(v, dx + 44, dy, 6, { w: 34, colours: ["#8a2a2a", "#2a2a2a", "#3a4a8a"], seed: 7630 }));
    for (const [k, [x, d, n]] of ([[3.1, 0.9, 12], [3.45, 0.9, 9], [3.1, 1.8, 6], [0.5, 2.0, 7]] as const).entries()) {
      const [px, py] = at(x, 0, d);
      out.push(stack(v, px - 20, py, n, { w: 40, colours: ["#3a4a8a", "#8a2a2a", "#2a2a2a", "#5a6a3a"], seed: 7640 + k * 20 }));
    }
    const [gx, gy] = at(DESK.x1 - 0.2, 0.76, PLANES.wall);
    out.push(blob(v, roundRectPts(gx - 18, gy - 8, 36, 8, 2), { fill: "#5a3a1a", seed: 7690, line: 1.2 }));
    out.push(v.at({ translate: [gx, gy - 14], rotate: -0.3 }, [
      blob(v, roundRectPts(-12, -7, 24, 14, 4), { fill: "#7a4a2a", seed: 7691, line: 1.4 }),
      v.rect(-2, 6, 4, 18, { fill: "#7a4a2a" }),
    ]));
    return out;
  },
  live: (v, t) => {
    const out: Drawing[] = [];
    // A metronome on the desk, keeping order.
    const [mx, my] = at(DESK.x0 + 0.7, 0.76, PLANES.wall);
    out.push(blob(v, [[mx - 14, my], [mx + 14, my], [mx + 6, my - 44], [mx - 6, my - 44]], { fill: "#3a2a1a", seed: 7695, line: 1.6 }));
    const a = Math.sin(t * 0.21) * 0.45;
    out.push(v.line(mx, my - 6, mx + Math.sin(a) * 40, my - 6 - Math.cos(a) * 40, { stroke: "#c8ccd0", weight: 2 }));
    out.push(v.circle(mx + Math.sin(a) * 30, my - 6 - Math.cos(a) * 30, 3, { fill: "#c8a040" }));
    return out;
  },
  occupant: { x: 2.2, depth: 2.2, facing: 1, pose: "stand", suit: "#3a4a7a", number: "01", hair: "#8a8a8a", skin: "#d8a888" },
};

const GREG: Dress = {
  bed: { blanket: "#7a8494", mess: 0 },
  deskColour: "#8a8a8a",
  wall: (v) => {
    const out: Drawing[] = [];
    // A jumpsuit on a hook, a towel on another; a poster that just says POSTER.
    const [hx, hy] = at(4.95, 1.75, 0);
    out.push(v.circle(hx, hy - 36, 3, { fill: "#8a8a8e" }));
    out.push(blob(v, [[hx - 18, hy - 34], [hx + 18, hy - 34], [hx + 16, hy + 50], [hx - 16, hy + 50]], { fill: "#7a8494", light: "#9aa4b4", seed: 7700, line: 1.6 }));
    const [px, py] = at(1.75, 1.65, 0);
    out.push(blob(v, [[px - 38, py - 50], [px + 38, py - 50], [px + 38, py + 50], [px - 38, py + 50]], { fill: "#e8e4d8", seed: 7710, line: 1.6 }));
    out.push(v.text("POSTER", { x: px, y: py }, { size: 12, fill: "#2a2a2e", align: "center", valign: "middle", style: "bold", font: "Helvetica, Arial, sans-serif" }));
    return out;
  },
  furniture: (v) => {
    const out: Drawing[] = [];
    // One mug. One toolbox. One pair of boots, aligned.
    const [mx, my] = at(DESK.x0 + 0.3, 0.76, PLANES.wall);
    out.push(blob(v, roundRectPts(mx - 9, my - 20, 18, 20, 3), { fill: "#e8e4d8", seed: 7720, line: 1.4 }));
    out.push(v.arc(mx + 10, my - 10, 5, -1.4, 1.4, { stroke: INK, weight: 1.6 }));
    out.push(crate(v, 3.3, 0.8, { w: 0.45, h: 0.22, colour: "#c83a2a", seed: 7730 }));
    for (const dx of [0, 0.16]) {
      const [bx, by] = at(1.3 + dx, 0, 1.3);
      out.push(blob(v, [[bx, by], [bx + 22, by], [bx + 22, by - 8], [bx + 8, by - 10], [bx + 8, by - 28], [bx, by - 28]], { fill: "#3a2a1a", seed: 7740 + dx * 100, line: 1.4 }));
    }
    return out;
  },
  live: (v, t) => tickingClock(v, 2.55, 2.3, t),
  occupant: { x: 4.0, depth: 2.1, facing: -1, pose: "stand", suit: "#5a6474", number: "05", hair: "#3a2a1a", skin: "#b07a52" },
};

const MILTON: Dress = {
  bed: { blanket: "#a83a3a", mess: 1 },
  wall: (v) => {
    const out: Drawing[] = [];
    // A tally of grievances on the wall; a dartboard with Ama's poster pinned to it.
    const [tx, ty] = at(1.3, 2.05, 0);
    for (let g = 0; g < 9; g++) {
      const gx = tx + (g % 5) * 30, gy = ty + Math.floor(g / 5) * 30;
      for (let k = 0; k < 4; k++) out.push(v.line(gx + k * 5, gy, gx + k * 5, gy + 20, { stroke: "#2a1a1a", weight: 1.6 }));
      out.push(v.line(gx - 3, gy + 16, gx + 19, gy + 4, { stroke: "#2a1a1a", weight: 1.6 }));
    }
    const [dx, dy] = at(4.4, 1.7, 0);
    for (const [i, r] of [30, 22, 14, 6].entries()) out.push(v.circle(dx, dy, r, { fill: i % 2 === 0 ? "#2a2a2a" : "#e8d8b0" }));
    out.push(v.circle(dx, dy, 30, { stroke: INK, weight: 2 }));
    out.push(mascot(v, [dx - 4, dy], 11, 7800));
    for (const [ax, ay] of [[-8, -8], [10, 4], [-2, 14]] as const) out.push(v.line(dx + ax, dy + ay, dx + ax + 12, dy + ay - 8, { stroke: "#c82a2a", weight: 2 }));
    return out;
  },
  furniture: (v) => {
    const out: Drawing[] = [];
    // IN tray overflowing, OUT tray empty.
    const [ix, iy] = at(DESK.x0 + 0.1, 0.76, PLANES.wall);
    for (const [k, l] of ["IN", "OUT"].entries()) {
      const x = ix + k * 58;
      out.push(blob(v, [[x, iy], [x + 50, iy], [x + 50, iy - 12], [x, iy - 12]], { fill: "#8a8e94", seed: 7810 + k, line: 1.4 }));
      out.push(stencil(v, l, { x: x + 25, y: iy - 6 }, { size: 7, colour: "#1a1a1a" }));
    }
    out.push(stack(v, ix + 2, iy - 12, 9, { w: 46, colours: ["#f4f0e0", "#f8e0d0"], seed: 7820, askew: 10 }));
    for (let i = 0; i < 14; i++) out.push(crumple(v, at(0.6 + hash(i, 0, 7830) * 4.4, 0.07, 0.9 + hash(i, 1, 7830) * 1.8), 7831 + i, 10 + hash(i, 2, 7830) * 4));
    // The bin, empty.
    const [bx, by] = at(4.95, 0, 1.2);
    out.push(blob(v, [[bx - 16, by], [bx + 16, by], [bx + 20, by - 40], [bx - 20, by - 40]], { fill: "#5a5e64", dark: "#2a2e34", seed: 7850, line: 1.8, shadeSide: "right" }));
    out.push(shellChair(v, 3.35, 1.0, { colour: "#a83a3a", facing: 1, seed: 7860 }));
    return out;
  },
  live: (v, t) => {
    // Another complaint, thrown at the bin; it misses.
    const u = (t % 75) / 75;
    const [ax, ay] = at(3.5, 1.3, 1.1), [bx, by] = at(5.05, 0.05, 1.5);
    return crumple(v, [ax + (bx - ax) * u, ay + (by - ay) * u - Math.sin(u * Math.PI) * 90], 7870, 10);
  },
  occupant: { x: 3.3, depth: 1.05, facing: 1, pose: "sit", suit: "#7a3a3a", number: "09", hair: "#4a3a2a", skin: "#d89a78" },
};

const GLORIA_WALL = 5.05;
const GLORIA: Dress = {
  bed: { blanket: "#e87a7a", mess: 0 },
  deskColour: "#c8a878",
  wall: (v) => {
    const out: Drawing[] = [];
    out.push(frame(v, { x: 1.75, h: 1.65, w: 0.5, hh: 0.3, seed: 7900, colour: "#e8b8a8" }, (_w, h) => {
      return [
        v.text("WELCOME,", { x: 0, y: -h * 0.18 }, { size: 9, fill: "#a83a4a", align: "center", valign: "middle", style: "italic", font: "Georgia, serif" }),
        v.text("FRIEND", { x: 0, y: h * 0.16 }, { size: 9, fill: "#a83a4a", align: "center", valign: "middle", style: "italic", font: "Georgia, serif" }),
      ];
    }));
    // A glass pressed to the wall at ear height, on a stool.
    const [gx, gy] = at(GLORIA_WALL, 1.45, 0);
    out.push(blob(v, [[gx - 4, gy - 16], [gx + 4, gy - 16], [gx - 14, gy + 14], [gx - 22, gy + 14]], { fill: "rgba(210,230,240,0.6)", seed: 7910, line: 1.4 }));
    return out;
  },
  furniture: (v) => {
    const out: Drawing[] = [];
    out.push(shellChair(v, 3.1, 1.3, { colour: "#e87a7a", facing: 1, seed: 7920 }));
    out.push(tulipTable(v, 3.75, 1.35, { w: 0.5, h: 0.55, seed: 7930 }));
    out.push(shellChair(v, 4.4, 1.3, { colour: "#e8a07a", facing: -1, seed: 7940 }));
    const [tx, ty] = at(3.75, 0.55, 1.35);
    out.push(blob(v, [[tx - 14, ty - 2], [tx + 14, ty - 2], [tx + 16, ty - 20], [tx + 4, ty - 26], [tx - 4, ty - 26], [tx - 16, ty - 20]], { fill: "#f4f0e8", light: "#ffffff", seed: 7950, line: 1.4 }));
    out.push(stroke(v, [[tx + 16, ty - 16], [tx + 26, ty - 22]], { seed: 7951, weight: 2.4, colour: "#f4f0e8" }));
    for (const dx of [-30, 26]) out.push(blob(v, roundRectPts(tx + dx - 5, ty - 10, 10, 9, 2), { fill: "#f4f0e8", seed: 7952 + dx, line: 1 }));
    // The stool under the glass.
    const [sx, sy] = at(GLORIA_WALL - 0.1, 0, 0.45);
    out.push(blob(v, ellipsePts(sx, sy - m(0.6), 20, 5), { fill: "#c8a878", seed: 7960, line: 1.4 }));
    for (const dx of [-14, 14]) out.push(stroke(v, [[sx + dx * 0.6, sy - m(0.6)], [sx + dx, sy]], { seed: 7961 + dx, weight: 3, colour: "#7a5a3a" }));
    return out;
  },
  live: (v, t) => {
    const out: Drawing[] = [];
    const [tx, ty] = at(3.75, 0.55, 1.35);
    for (let k = 0; k < 3; k++) {
      const u = ((t * 0.8 + k * 25) % 75) / 75;
      out.push(v.circle(tx + 26 + Math.sin(u * 6 + k) * 4, ty - 24 - u * 50, 3 + u * 4, { fill: `rgba(240,240,240,${((1 - u) * 0.4).toFixed(3)})` }));
    }
    // Voices through the wall, gathered by the glass.
    const [gx, gy] = at(GLORIA_WALL, 1.45, 0);
    for (let k = 0; k < 3; k++) {
      const u = ((t + k * 16) % 48) / 48;
      out.push(v.arc(gx + 30 - u * 30, gy, 10 + (1 - u) * 18, Math.PI * 0.65, Math.PI * 1.35, { stroke: `rgba(255,220,200,${(u * 0.7).toFixed(3)})`, weight: 1.6 }));
    }
    return out;
  },
  occupant: { x: 4.8, depth: 0.75, facing: 1, pose: "stand", suit: "#c85a5a", number: "14", hair: "#c8c8c8", skin: "#e8b898" },
};

const LILY_PLANTS: readonly (readonly [number, number, number, string])[] = [[0.45, 1.1, 0.8, "#3ac85a"], [3.05, 0.8, 1.0, "#5ae08a"], [3.5, 1.6, 0.7, "#2ab84a"], [4.95, 0.7, 1.2, "#4ad86a"], [2.0, 2.3, 0.6, "#3ac85a"], [3.95, 2.2, 0.9, "#6ae89a"]];
const LILY: Dress = {
  bed: { blanket: "#7ad88a", mess: 0 },
  wall: (v) => {
    const out: Drawing[] = [];
    // A shelf of potted cuttings, each named.
    const [sx, sy] = at(DESK.x0 + 0.02, 1.45, 0);
    out.push(v.rect(sx, sy, m(1.05), 6, { fill: "#e8e0d0", stroke: INK, weight: 1.4 }));
    for (const [i, n] of ["BERNARD", "ELSIE", "MR. FERN"].entries()) {
      const px = sx + 22 + i * 50;
      out.push(blob(v, [[px - 10, sy], [px + 10, sy], [px + 13, sy - 16], [px - 13, sy - 16]], { fill: "#d87a4a", seed: 8000 + i, line: 1.2 }));
      for (let k = 0; k < 5; k++) out.push(blob(v, [[px - 2, sy - 16], [px + 2, sy - 16], [px + (k - 2) * 7, sy - 36 - (k % 2) * 6]], { fill: "#3ac85a", seed: 8010 + i * 5 + k, line: 1, amp: 0.3 }));
      out.push(v.text(n, { x: px, y: sy + 13 }, { size: 6, fill: "#2a2a2a", align: "center", valign: "middle", style: "bold" }));
    }
    out.push(poster(v, 1.75, "calm", { h: 1.7, seed: 8020 }));
    return out;
  },
  furniture: (v) => {
    const out: Drawing[] = [];
    for (const [i, [x, d, h, c]] of LILY_PLANTS.entries()) {
      out.push(plant(v, x, d, { h, leaf: c, seed: 8030 + i * 10 }));
      const [lx, ly] = at(x + 0.12, 0.08, d);
      out.push(v.rect(lx, ly - 10, 4, 14, { fill: "#f4f0e0" }));
    }
    // A watering can, a mister, on the floor by the bed.
    const [wx, wy] = at(1.25, 0, 1.9);
    out.push(blob(v, [[wx - 18, wy], [wx + 18, wy], [wx + 16, wy - 28], [wx - 16, wy - 28]], { fill: "#5a9ad8", light: "#8ac0f0", seed: 8100, line: 1.8 }));
    out.push(stroke(v, [[wx + 16, wy - 10], [wx + 40, wy - 34]], { seed: 8101, weight: 4, colour: "#5a9ad8" }));
    return out;
  },
  live: (v, t) => {
    const out: Drawing[] = [];
    // The grow lamp over the plants, pulsing purple; drops from Lily's can.
    const [gx, gy] = at(2.6, 2.6, 0.8);
    const [, top] = at(2.6, 3.0, 0);
    for (const dx of [-60, 60]) out.push(v.line(gx + dx, top, gx + dx, gy, { stroke: "#2a2a2e", weight: 1.2 }));
    out.push(blob(v, roundRectPts(gx - 70, gy - 6, 140, 12, 5), { fill: "#5a5a60", seed: 8110, line: 1.6 }));
    out.push(glow(v, gx, gy + 120, { rx: 360, ry: 200, colour: "#c86aff", alpha: 0.18 + 0.06 * Math.sin(t * 0.04) }));
    const [cx, cy] = at(3.35, 0.85, 2.0);
    out.push(v.at({ translate: [cx, cy], rotate: 0.3 }, [
      blob(v, [[-14, 0], [14, 0], [12, -20], [-12, -20]], { fill: "#e8c83a", seed: 8120, line: 1.4 }),
      stroke(v, [[12, -8], [30, -24]], { seed: 8121, weight: 3, colour: "#e8c83a" }),
    ]));
    for (let k = 0; k < 4; k++) {
      const u = ((t + k * 8) % 32) / 32;
      out.push(v.circle(cx + 32 + u * 10, cy - 18 + u * 60, 2, { fill: "rgba(150,210,255,0.8)" }));
    }
    return out;
  },
  occupant: { x: 3.15, depth: 2.0, facing: 1, pose: "stand", suit: "#4a9a5a", number: "16", hair: "#e8a8c8", skin: "#f0c8a8" },
};

const HENRY: Dress = {
  bed: { blanket: "#4a7ad8", mess: 0 },
  wall: (v) => {
    const drawn: Drawing[] = [];
    // A calendar with every day crossed out.
    const [cx, cy] = at(1.75, 1.6, 0);
    drawn.push(blob(v, [[cx - 40, cy - 46], [cx + 40, cy - 46], [cx + 40, cy + 46], [cx - 40, cy + 46]], { fill: "#f4f0e4", seed: 8200, line: 1.6 }));
    drawn.push(v.rect(cx - 40, cy - 46, 80, 14, { fill: "#4a7ad8" }));
    drawn.push(v.text("SOON", { x: cx, y: cy - 39 }, { size: 8, fill: "#ffffff", align: "center", valign: "middle", style: "bold" }));
    for (let d = 0; d < 30; d++) {
      const x = cx - 34 + (d % 6) * 12, y = cy - 26 + Math.floor(d / 6) * 13;
      drawn.push(v.line(x, y, x + 8, y + 8, { stroke: "#c82a2a", weight: 1.2 }));
      drawn.push(v.line(x + 8, y, x, y + 8, { stroke: "#c82a2a", weight: 1.2 }));
    }
    // A coat and a hat on the hooks by the door, ready.
    const [hx, hy] = at(0.5, 1.75, 0);
    drawn.push(blob(v, [[hx - 16, hy - 30], [hx + 16, hy - 30], [hx + 20, hy + 60], [hx - 20, hy + 60]], { fill: "#6a5a3a", light: "#8a7a5a", seed: 8210, line: 1.6 }));
    drawn.push(blob(v, ellipsePts(hx, hy - 44, 22, 5), { fill: "#3a3a3a", seed: 8211, line: 1.4 }));
    drawn.push(blob(v, roundRectPts(hx - 13, hy - 62, 26, 18, 5), { fill: "#3a3a3a", seed: 8212, line: 1.4 }));
    return drawn;
  },
  furniture: (v) => {
    const drawn: Drawing[] = [];
    // Packed: a suitcase and a bag by the door, labels on.
    const [sx, sy] = at(0.75, 0, 1.6);
    drawn.push(blob(v, roundRectPts(sx - 34, sy - 50, 68, 50, 6), { fill: "#8a5a3a", light: "#a87a5a", dark: "#4a2a1a", seed: 8220, line: 2, shadeSide: "right" }));
    drawn.push(v.rect(sx - 34, sy - 30, 68, 4, { fill: "#4a2a1a" }));
    drawn.push(stroke(v, [[sx - 10, sy - 50], [sx - 8, sy - 60], [sx + 8, sy - 60], [sx + 10, sy - 50]], { seed: 8221, weight: 3, colour: "#2a1a10" }));
    drawn.push(v.at({ translate: [sx + 20, sy - 20], rotate: 0.2 }, v.rect(-8, -5, 16, 10, { fill: "#f4f0e0", stroke: INK, weight: 0.8 })));
    const [bx, by] = at(1.25, 0, 1.75);
    drawn.push(blob(v, [[bx - 22, by], [bx + 22, by], [bx + 18, by - 30], [bx - 18, by - 30]], { fill: "#3a5a3a", seed: 8230, line: 1.8 }));
    return drawn;
  },
  live: (v, t) => tickingClock(v, 2.55, 2.3, t),
  occupant: { x: 0.85, depth: 1.62, facing: 1, pose: "sit", suit: "#3a5a9a", number: "12", hair: "#6a6a6a", skin: "#c89070" },
};

const YOURS: Dress = {
  bed: { blanket: "#d8dce0", mess: 0 },
  deskColour: "#c8ccd0",
  wall: (v) => {
    const out: Drawing[] = [];
    out.push(vent(v, 4.3, 2.3, 0.5));
    // A clean, paler patch where something used to hang.
    const [px, py] = at(1.75, 1.65, 0);
    out.push(v.rect(px - 36, py - 48, 72, 96, { fill: "rgba(255,255,255,0.12)" }));
    out.push(v.circle(px, py - 58, 2, { fill: "#6a6a6e" }));
    return out;
  },
  furniture: (v) => {
    const out: Drawing[] = [];
    // A towel, folded; a card on the pillow; a tag; the wet floor sign.
    const [tx, ty] = at(1.6, 0.5, BED.depth);
    out.push(blob(v, roundRectPts(tx - 22, ty - 12, 44, 12, 3), { fill: "#f4f0e8", seed: 8300, line: 1.4 }));
    out.push(v.at({ translate: at(1.07, 0.6, BED.depth), rotate: -0.1 }, [
      blob(v, [[-20, -10], [20, -10], [20, 6], [-20, 6]], { fill: "#ffffff", seed: 8301, line: 1.2 }),
      v.text("WELCOME,", { x: 0, y: -4 }, { size: 5.5, fill: "#2a2a2e", align: "center", valign: "middle", style: "bold" }),
      v.text("CITIZEN", { x: 0, y: 2 }, { size: 5.5, fill: "#2a2a2e", align: "center", valign: "middle", style: "bold" }),
    ]));
    const [gx, gy] = at(2.7, 0.3, BED.depth + 0.1);
    out.push(stroke(v, [[gx, gy - 14], [gx + 4, gy]], { seed: 8302, weight: 1 }));
    out.push(v.at({ translate: [gx + 6, gy + 18], rotate: 0.1 }, [
      blob(v, [[-30, -14], [30, -14], [30, 14], [-30, 14]], { fill: "#f8f048", seed: 8303, line: 1.2, amp: 0.3 }),
      v.text("SANITISED FOR YOU", { x: 0, y: -6 }, { size: 5.5, fill: "#2a2a2e", align: "center", valign: "middle", style: "bold" }),
      v.text("PREV. OCCUPANT:", { x: -6, y: 4 }, { size: 5, fill: "#2a2a2e", align: "center", valign: "middle" }),
      v.rect(16, 0, 12, 7, { fill: "#1a1a1a" }),
    ]));
    const [wx, wy] = at(3.4, 0, 2.0);
    out.push(blob(v, [[wx - 24, wy], [wx - 4, wy - 62], [wx + 4, wy - 62], [wx + 24, wy]], { fill: "#f8d838", light: "#fff080", seed: 8310, line: 2 }));
    out.push(v.text("WET", { x: wx, y: wy - 30 }, { size: 8, fill: "#1a1a1a", align: "center", valign: "middle", style: "bold" }));
    out.push(v.text("FLOOR", { x: wx, y: wy - 20 }, { size: 7, fill: "#1a1a1a", align: "center", valign: "middle", style: "bold" }));
    return out;
  },
  live: (v, t) => {
    const out: Drawing[] = [];
    // The floor still shines; the vent hums.
    for (let i = 0; i < 7; i++) {
      const k = (Math.sin(t * 0.06 + i * 1.7) + 1) / 2;
      if (k < 0.75) continue;
      const [sx, sy] = at(0.8 + hash(i, 0, 8320) * 4.2, 0, 1.2 + hash(i, 1, 8320) * 1.8);
      const r = (k - 0.75) * 40;
      out.push(v.line(sx - r, sy, sx + r, sy, { stroke: "rgba(255,255,255,0.8)", weight: 1.4 }));
      out.push(v.line(sx, sy - r, sx, sy + r, { stroke: "rgba(255,255,255,0.8)", weight: 1.4 }));
    }
    const [vx, vy] = at(4.3, 2.3, 0);
    for (let k = 0; k < 3; k++) {
      const u = ((t + k * 12) % 36) / 36;
      out.push(v.curve([[vx - 30, vy + 24 + u * 40], [vx, vy + 28 + u * 40], [vx + 30, vy + 24 + u * 40]], false, { stroke: `rgba(220,230,240,${((1 - u) * 0.4).toFixed(3)})`, weight: 1.4 }));
    }
    return out;
  },
};

// --- The rooms ---------------------------------------------------------------------------------

function quarters(name: string, colour: string, dress: Dress): RoomSpec {
  const lamp = dress.lamp ?? "#e8a040";
  return {
    id: `quarters-${name.toLowerCase()}`,
    name: `Quarters: ${name}`,
    width: 5.2,
    wall: colour,
    sky: "calm-static",
    dead: name === "Yours" ? [] : [1],
    floor: "carpet",
    ambient: "#a8a8b8",
    exits: [{ to: "Hallway", kind: "edge-left", label: "Hallway", glow: "#34d399" }],
    paintWall: (v) => {
      return [
        nameplate(v, name, colour),
        amaSpeaker(v, SPEAKER[0], SPEAKER[1]),
        dress.wall?.(v),
      ];
    },
    paintFurniture: (v) => {
      return [
        bed(v, dress.bed, 7020),
        desk(v, dress.deskColour ?? "#8a6a4a", 7030),
        deskLamp(v, DESK.x1 - 0.2, lamp),
        dress.furniture?.(v),
      ];
    },
    live: (v, t) => {
      const out: Drawing[] = [];
      out.push(lampLight(v, DESK.x1 - 0.2, "#ffc880", name === "Yours" ? 0.12 : 0.3));
      out.push(dress.live?.(v, t));
      out.push(amaEye(v, SPEAKER[0], SPEAKER[1], t));
      if (dress.occupant !== undefined) out.push(citizen(v, { ...dress.occupant, collar: colour }, t));
      return out;
    },
  };
}

export const QUARTERS: readonly RoomSpec[] = [
  quarters("Doug", "#fb7185", DOUG),
  quarters("Marta", "#f472b6", MARTA),
  quarters("Frida", "#eab308", FRIDA),
  quarters("June", "#14b8a6", JUNE),
  quarters("Lana", "#4ade80", LANA),
  quarters("Harold", "#818cf8", HAROLD),
  quarters("Greg", "#94a3b8", GREG),
  quarters("Milton", "#ef4444", MILTON),
  quarters("Gloria", "#f87171", GLORIA),
  quarters("Lily", "#4ade80", LILY),
  quarters("Henry", "#3b82f6", HENRY),
  quarters("Yours", "#d1d5db", YOURS),
];
