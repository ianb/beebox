// Archive Console. From intra-game: "Archive Console: brightly lit, almost too
// bright, walls a bizarre pink and teal. In the centre the Archive Console with
// cheerful animated icons that blink and dance; it hums an upbeat tune. The
// Archivist AI waits cheerfully to assist."
// Exits (1): Archive Lounge (stairs-down).
import type { Drawing, Vec2, View } from "@ianbicking/canvas-loop";
import { INK, type RoomSpec, at, blob, glow, hash, mixHex, roundRectPts, stroke } from "./kit-tea.js";
import { cabinet, hueHex, lamps, notes, reel, screenFrame } from "./parts-a-tea.js";
import { amaEye, amaSpeaker, citizen, plant, shellChair, tubeGlow, tubeLight } from "./props-tea.js";
import { BACK_FOOT_Y, footY, m } from "./sizes-tea.js";

const WIDTH = 6.0;
const CONSOLE = { x: 3.95, depth: 0.45 };
const TOWERS = [3.0, 4.9] as const;
const TEAL = "#2ab8b0";

function screenRect(): { x: number; y: number; w: number; h: number } {
  const [cx, cy] = at(CONSOLE.x, 1.62, CONSOLE.depth);
  const w = m(0.86), h = m(0.6);
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}
function towerReels(x: number): [Vec2, Vec2] {
  const [px, py] = at(x, 1.95, CONSOLE.depth);
  return [[px - 18, py + 46], [px + 18, py + 46]];
}

/** The pink and teal: a 70s supergraphic, swooping bands across the wall. */
function supergraphic(v: View): Drawing {
  const out: Drawing[] = [];
  const w = m(WIDTH);
  const top = BACK_FOOT_Y - m(3);
  // Teal upper wall, then three swooping stripes down into the pink.
  out.push(v.polygon([[0, top], [w, top], [w, top + m(0.9)], [w * 0.6, top + m(0.75)], [w * 0.3, top + m(1.2)], [0, top + m(1.05)]], { fill: mixHex(TEAL, "#b8b8b0", 0.25) }));
  for (const [i, c] of ["#f8f0e0", "#f86aa8", TEAL].entries()) {
    const off = m(0.16) * (i + 1);
    const pts: Vec2[] = [[0, top + m(1.05) + off], [w * 0.3, top + m(1.2) + off], [w * 0.6, top + m(0.75) + off], [w, top + m(0.9) + off]];
    out.push(v.curve(pts, false, { stroke: mixHex(c, "#b0a8a8", 0.2), weight: m(0.11) }));
  }
  out.push(stroke(v, [[0, top + m(1.05)], [w * 0.3, top + m(1.2)], [w * 0.6, top + m(0.75)], [w, top + m(0.9)]], { seed: 7000, weight: 1.4, amp: 1 }));
  return out;
}

/** The card catalogue: the archive itself, a wall of small drawers. */
function catalogue(v: View): Drawing {
  const out: Drawing[] = [];
  const r = cabinet(v, 1.4, 1.5, 1.55, { colour: "#c89a5a", seed: 7010, depth: 0.3 });
  out.push(r.drawing);
  const cols = 6, rows = 6, cw = (r.w - 20) / cols, rh = (r.h - 60) / rows;
  for (let c = 0; c < cols; c++) for (let rr = 0; rr < rows; rr++) {
    const x = r.x + 10 + c * cw, y = r.y + 20 + rr * rh;
    const open = hash(c, rr, 7011) < 0.08;
    out.push(blob(v, roundRectPts(x + 2, y + 2, cw - 4, rh - 4, 2), { fill: open ? "#3a2a1a" : "#d8b070", seed: 7012 + c * 10 + rr, line: 1.2, amp: 0.3 }));
    if (!open) {
      out.push(v.rect(x + cw / 2 - 6, y + 5, 12, 6, { fill: "#f4f0e0", stroke: INK, weight: 0.6 }));
      out.push(v.circle(x + cw / 2, y + rh - 9, 2, { fill: "#8a8a8e" }));
    }
  }
  out.push(v.text("A–Z (MOSTLY)", { x: r.x + r.w / 2, y: r.y + 10 }, { size: 7, fill: "#3a2010", align: "center", valign: "middle", style: "bold" }));
  return out;
}

function console_(v: View): Drawing {
  const out: Drawing[] = [];
  const [cx, foot] = at(CONSOLE.x, 0, CONSOLE.depth);
  // Two tape towers either side.
  for (const [i, x] of TOWERS.entries()) {
    const r = cabinet(v, x, 0.52, 1.95, { colour: "#f0e4c8", seed: 7100 + i * 10, depth: CONSOLE.depth });
    out.push(r.drawing);
    out.push(blob(v, roundRectPts(r.x + 6, r.y + 18, r.w - 12, 60, 8), { fill: "#2a2430", seed: 7105 + i * 10, line: 1.4 }));
    for (let k = 0; k < 3; k++) out.push(blob(v, roundRectPts(r.x + 10, r.y + 92 + k * 26, r.w - 20, 18, 4), { fill: [TEAL, "#f86aa8", "#f8c840"][k] ?? TEAL, seed: 7106 + i * 10 + k, line: 1.2 }));
  }
  // The desk with its sloped keyboard.
  const w = m(1.25);
  out.push(blob(v, [[cx - w / 2, foot], [cx + w / 2, foot], [cx + w / 2 + 4, foot - m(0.72)], [cx - w / 2 - 4, foot - m(0.72)]], { fill: "#e87a3a", light: "#f8a868", dark: "#8a3a1a", seed: 7120, line: 2.4, shadeSide: "right" }));
  out.push(blob(v, [[cx - w / 2 - 8, foot - m(0.72)], [cx + w / 2 + 8, foot - m(0.72)], [cx + w / 2 - 6, foot - m(0.9)], [cx - w / 2 + 6, foot - m(0.9)]], { fill: "#f4ecd8", light: "#ffffff", seed: 7121, line: 2 }));
  for (let k = 0; k < 14; k++) for (let row = 0; row < 2; row++) out.push(v.rect(cx - w / 2 + 18 + k * 12 + row * 4, foot - m(0.86) + row * 9, 9, 6, { fill: k === 13 && row === 1 ? "#d84a3a" : "#5a5450", stroke: INK, weight: 0.6 }));
  out.push(v.text("FRIEND", { x: cx + w / 2 - 34, y: foot - m(0.72) + 10 }, { size: 6, fill: "#f8f0e0", align: "center", valign: "middle", style: "bold" }));
  // A label, and a clearance sticker smiled over in marker.
  out.push(v.at({ translate: [cx - 50, foot - m(0.4)], rotate: -0.04 }, [
    v.rect(-40, -12, 80, 24, { fill: "#f8f048", stroke: INK, weight: 1 }),
    v.text("CLEARANCE:", { x: 0, y: -5 }, { size: 6, fill: "#3a2010", align: "center", valign: "middle", style: "bold" }),
    v.text("ULTRAVIOLET", { x: 0, y: 4 }, { size: 7, fill: "#6a1aa8", align: "center", valign: "middle", style: "bold" }),
  ]));
  out.push(v.circle(cx - 20, foot - m(0.4) - 4, 9, { stroke: "#d82a6a", weight: 1.8 }));
  out.push(v.circle(cx - 23, foot - m(0.4) - 7, 1.2, { fill: "#d82a6a" }));
  out.push(v.circle(cx - 17, foot - m(0.4) - 7, 1.2, { fill: "#d82a6a" }));
  out.push(v.arc(cx - 20, foot - m(0.4) - 4, 5, 0.3, Math.PI - 0.3, { stroke: "#d82a6a", weight: 1.4 }));
  out.push(v.text("ARCHIVIST MK.IV", { x: cx + 40, y: foot - m(0.3) }, { size: 9, fill: "#f8f0e0", align: "center", valign: "middle", style: "bold", font: "Helvetica, Arial, sans-serif" }));
  // The big rounded screen housing, standing on the desk, with a grille for the tune.
  const s = screenRect();
  out.push(blob(v, roundRectPts(s.x - 22, s.y - 22, s.w + 44, s.h + 52, 30), { fill: "#f4ecd8", light: "#ffffff", dark: "#a89a80", seed: 7130, line: 2.6, shadeSide: "right" }));
  out.push(screenFrame(v, s.x, s.y, s.w, s.h, 7131, "#3a3440"));
  for (let k = 0; k < 7; k++) out.push(v.line(s.x + s.w / 2 - 30 + k * 10, s.y + s.h + 12, s.x + s.w / 2 - 30 + k * 10, s.y + s.h + 24, { stroke: "#6a6058", weight: 2.4 }));
  // Antennae, because it is the future.
  for (const dx of [-0.3, 0.3]) {
    const bx = s.x + s.w / 2 + m(dx) * 0.6, by = s.y - 20;
    out.push(stroke(v, [[bx, by], [bx + m(dx) * 0.4, by - 40]], { seed: 7140 + dx * 10, weight: 2, colour: "#a8a8ac" }));
    out.push(v.circle(bx + m(dx) * 0.4, by - 42, 5, { fill: "#f86aa8", stroke: INK, weight: 1.4 }));
  }
  return out;
}

function banner(v: View): Drawing {
  const out: Drawing[] = [];
  const [ax, ay] = at(2.5, 2.72, 0), [bx] = at(5.4, 2.72, 0);
  const pts: Vec2[] = [[ax, ay - 14], [bx, ay - 14], [bx - 12, ay], [bx, ay + 14], [ax, ay + 14], [ax + 12, ay]];
  out.push(blob(v, pts, { fill: "#f8f0e0", dark: "#c8b8a8", seed: 7200, line: 1.8, amp: 0.8 }));
  out.push(v.text("THE ARCHIVIST IS YOUR FRIEND!", { x: (ax + bx) / 2, y: ay + 1 }, { size: 14, fill: "#d82a6a", align: "center", valign: "middle", style: "bold", font: "Helvetica, Arial, sans-serif" }));
  for (const x of [ax + 4, bx - 4]) out.push(stroke(v, [[x, ay - 14], [x + (x < bx - 10 ? -6 : 6), ay - 40]], { seed: 7201 + x, weight: 1.4 }));
  return out;
}

function wallPieces(v: View): Drawing {
  const out: Drawing[] = [];
  out.push(supergraphic(v));
  out.push(catalogue(v));
  out.push(banner(v));
  out.push(tubeLight(v, 1.3, 2.55, 1.4));
  out.push(tubeLight(v, 5.0, 2.3, 0.9));
  out.push(amaSpeaker(v, 5.6, 1.85));
  // A small notice, by the stairs.
  const [nx, ny] = at(2.45, 1.85, 0);
  out.push(v.at({ translate: [nx, ny], rotate: 0.05 }, [
    v.rect(-26, -16, 52, 32, { fill: "#f0ece0", stroke: INK, weight: 1.2 }),
    v.text("PLEASE DO", { x: 0, y: -8 }, { size: 6, fill: "#8a1a1a", align: "center", valign: "middle", style: "bold" }),
    v.text("NOT ASK IT", { x: 0, y: 0 }, { size: 6, fill: "#8a1a1a", align: "center", valign: "middle", style: "bold" }),
    v.text("ABOUT 1999", { x: 0, y: 8 }, { size: 6, fill: "#8a1a1a", align: "center", valign: "middle", style: "bold" }),
  ]));
  return out;
}
function furniture(v: View): Drawing {
  return [
    console_(v),
    shellChair(v, 3.45, 1.35, { colour: TEAL, facing: 1, seed: 7300 }),
    plant(v, 5.55, 0.6, { h: 1.0, leaf: "#f86aa8", pot: "#2ab8b0" }),
  ];
}

/** The icons that dance on the Archivist's screen. */
function icon(v: View, kind: number, x: number, y: number, s: number, c: string): Drawing {
  const out: Drawing[] = [];
  switch (kind % 5) {
    case 0: // a star
      out.push(v.polygon(Array.from({ length: 10 }, (_, i): Vec2 => [x + Math.cos(-Math.PI / 2 + (i * Math.PI) / 5) * s * (i % 2 === 0 ? 1 : 0.45), y + Math.sin(-Math.PI / 2 + (i * Math.PI) / 5) * s * (i % 2 === 0 ? 1 : 0.45)]), { fill: c }));
      break;
    case 1: // a heart
      out.push(v.circle(x - s * 0.4, y - s * 0.2, s * 0.45, { fill: c }));
      out.push(v.circle(x + s * 0.4, y - s * 0.2, s * 0.45, { fill: c }));
      out.push(v.polygon([[x - s * 0.85, y], [x + s * 0.85, y], [x, y + s * 0.9]], { fill: c }));
      break;
    case 2: // a floppy disk
      out.push(v.rect(x - s * 0.7, y - s * 0.7, s * 1.4, s * 1.4, { fill: c }));
      out.push(v.rect(x - s * 0.35, y - s * 0.7, s * 0.7, s * 0.45, { fill: "#0e1412" }));
      break;
    case 3: // a note
      out.push(v.circle(x - s * 0.3, y + s * 0.5, s * 0.35, { fill: c }));
      out.push(v.line(x, y + s * 0.5, x, y - s * 0.8, { stroke: c, weight: 2 }));
      out.push(v.line(x, y - s * 0.8, x + s * 0.6, y - s * 0.4, { stroke: c, weight: 2 }));
      break;
    default: // a smiling face
      out.push(v.circle(x, y, s * 0.8, { stroke: c, weight: 2 }));
      out.push(v.circle(x - s * 0.3, y - s * 0.2, 1.4, { fill: c }));
      out.push(v.circle(x + s * 0.3, y - s * 0.2, 1.4, { fill: c }));
      out.push(v.arc(x, y + s * 0.05, s * 0.45, 0.3, Math.PI - 0.3, { stroke: c, weight: 1.6 }));
  }
  return out;
}

function screenLive(v: View, t: number): Drawing {
  const out: Drawing[] = [];
  const s = screenRect();
  out.push(v.rect(s.x + 2, s.y + 2, s.w - 4, s.h - 4, { fill: "rgba(40,20,60,0.6)" }));
  // The Archivist's face in the middle: big eyes that blink, a wide smile.
  const fx = s.x + s.w / 2, fy = s.y + s.h * 0.42;
  const blink = t % 70 < 4;
  for (const dx of [-16, 16]) {
    if (blink) out.push(v.line(fx + dx - 6, fy - 6, fx + dx + 6, fy - 6, { stroke: "#9affe0", weight: 2.4 }));
    else out.push(v.ellipse(fx + dx, fy - 6, 5, 8, { fill: "#9affe0" }));
  }
  out.push(v.arc(fx, fy + 2, 18, 0.25, Math.PI - 0.25, { stroke: "#9affe0", weight: 3 }));
  // Icons dancing round it in a ring, bouncing to the beat.
  for (let i = 0; i < 7; i++) {
    const a = t * 0.04 + (i / 7) * Math.PI * 2;
    const beat = Math.abs(Math.sin(t * 0.25 + i)) * 5;
    const x = fx + Math.cos(a) * s.w * 0.38, y = fy + 4 + Math.sin(a) * s.h * 0.3 - beat;
    if (hash(i, Math.floor(t / 8), 7400) < 0.12) continue;
    out.push(icon(v, i, x, y, 6, hueHex((i * 51 + t * 3) % 360, 0.9, 0.65)));
  }
  const cursor = Math.floor(t / 12) % 2 === 0 ? "_" : " ";
  out.push(v.text(`> HOW MAY I HELP? :)${cursor}`, { x: s.x + 10, y: s.y + s.h - 10 }, { size: 8, fill: "#9affe0", align: "left", valign: "middle", style: "bold", font: "Courier, monospace" }));
  for (let y = s.y + 2; y < s.y + s.h - 2; y += 3) out.push(v.line(s.x + 2, y, s.x + s.w - 2, y, { stroke: "rgba(0,0,0,0.15)", weight: 1 }));
  out.push(glow(v, fx, fy, { rx: s.w * 0.9, ry: s.h * 0.9, colour: "#9affe0", alpha: 0.28 }));
  return out;
}

function live(v: View, t: number): Drawing {
  const out: Drawing[] = [];
  // Almost too bright: a white wash over everything, and the tubes blazing.
  out.push(v.rect(0, BACK_FOOT_Y - m(3), m(WIDTH), m(3) + footY(3.4) - BACK_FOOT_Y + 8, { fill: "rgba(255,240,250,0.16)", blend: "screen" }));
  out.push(tubeGlow(v, 1.3, 2.55, t, { w: 1.4, colour: "#fff0f8" }));
  out.push(tubeGlow(v, 5.0, 2.3, t, { w: 0.9, colour: "#f0fff8" }));
  out.push(screenLive(v, t));
  for (const [i, x] of TOWERS.entries()) {
    const [a, b] = towerReels(x);
    out.push(reel(v, a[0], a[1], 15, t * (0.1 + i * 0.03), 0.6));
    out.push(reel(v, b[0], b[1], 15, -t * (0.12 - i * 0.02), 0.4));
    const [px, py] = at(x, 1.95, CONSOLE.depth);
    out.push(lamps(v, px - 18, py + 92 + 85, 5, t, { seed: 7410 + i, gap: 9, colours: ["#f86aa8", TEAL, "#f8e040"], rate: 6 }));
  }
  // It hums: notes from the grille, swaying.
  const s = screenRect();
  out.push(notes(v, s.x + s.w + 30, s.y + s.h, t, { colour: "#d82a6a", seed: 7420, n: 4, rise: 120 }));
  out.push(notes(v, s.x - 30, s.y + s.h, t + 40, { colour: "#1a8a84", seed: 7421, n: 3, rise: 100 }));
  out.push(amaEye(v, 5.6, 1.85, t));
  // A citizen in front of the console, waiting their turn to ask.
  out.push(citizen(v, { x: 2.6, facing: 1, pose: "stand", suit: "#6a5aa8", collar: "#ec4899", hair: "#2a1a10", skin: "#c58a62" }, t));
  return out;
}

export const ARCHIVE_CONSOLE: RoomSpec = {
  id: "archive-console",
  name: "Archive Console",
  width: WIDTH,
  wall: "#ec4899",
  trim: TEAL,
  sky: "cheerful",
  floor: "carpet",
  floorColour: "#2a9a94",
  ambient: "#f4ecf0",
  exits: [
    { to: "Archive Lounge", kind: "stairs-down", x: 0.6, label: "Archive Lounge", glow: "#3b82f6" },
  ],
  paintWall: wallPieces,
  paintFurniture: furniture,
  live,
  rim: { x: m(CONSOLE.x), y: 330, colour: "#c8fff0", reach: 420 },
};
