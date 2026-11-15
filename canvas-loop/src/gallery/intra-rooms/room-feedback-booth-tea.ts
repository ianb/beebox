// Feedback Booth. From intra-game: "Feedback Booth: a cozy, narrow booth where citizens submit complaints or suggestions via a glowing terminal. Many stop by to vent; an unexpected social hub. Ceiling: clear sky with paper airplanes drifting lazily in all directions."
// Exits (1): Quiet Plaza (edge-right).
// A low, warm booth: the glowing terminal that thanks you for your satisfaction, a
// brass SUGGESTIONS slot whose pipe runs down to the incinerator, a corkboard of
// complaints, a coffee urn, and people who came to complain and stayed to chat.
import type { SceneView as View } from "@ianbicking/canvas-loop";
import { type RoomSpec, at, blob, ellipsePts, glow, hash, roundRectPts } from "./kit-tea.js";
import { placard, pulse, speech } from "./parts-b-tea.js";
import { type Crt, amaEye, amaSpeaker, citizen, crate, crt, crtScreen, globeLamp, lampGlow, pipe } from "./props-tea.js";
import { m } from "./sizes-tea.js";

const W = 4.4, CEIL = 2.6;
const TERM: Crt = { x: 0.78, h: 0.92, w: 0.55, hh: 0.46, depth: 0.45, body: "#d8c8a0" };
const SLOT_X = 1.72;

const NOTES = ["MORE SPOONS", "TOO MUCH YELLOW", "CHAIRS TOO SMALL", "WHO PAUSED THE CLOUDS?", "LOST: CAT. ANSWERS TO AMA", "I LIKE IT HERE :)", "SEE ABOVE", "WISH WAS LOGGED, NOT GRANTED"] as const;

function corkboard(v: View): void {
  const [cx, cy] = at(2.65, 1.55, 0);
  const w = m(1.0), h = m(0.7);
  blob(v, roundRectPts(cx - w / 2 - 6, cy - h / 2 - 6, w + 12, h + 12, 4), { fill: "#7a5a3a", seed: 7000, line: 2 });
  blob(v, [[cx - w / 2, cy - h / 2], [cx + w / 2, cy - h / 2], [cx + w / 2, cy + h / 2], [cx - w / 2, cy + h / 2]], { fill: "#c89a5a", light: "#d8b070", dark: "#9a7040", seed: 7001, line: 1.2 });
  for (const [i, note] of NOTES.entries()) {
    const col = i % 3, row = Math.floor(i / 3);
    const nx = cx - w / 2 + 26 + col * 48 + hash(i, 0, 7002) * 6, ny = cy - h / 2 + 20 + row * 32 + hash(i, 1, 7002) * 4;
    const bg = ["#f8f0c0", "#f8d0d8", "#d0e8f8", "#f0f0e8"][i % 4] ?? "#f8f0c0";
    v.at({ translate: [nx, ny], rotate: (hash(i, 2, 7002) - 0.5) * 0.3 }, () => {
      v.rect(-22, -13, 44, 26, { fill: bg, stroke: "#8a7a60", weight: 0.6 });
      v.text(note, { x: -20, y: -11, w: 40 }, { size: 6, fill: "#3a2a20", align: "center", lineHeight: 1.1 });
      v.circle(0, -11, 2.2, { fill: "#d03a2a" });
    });
  }
}

function paintWall(v: View): void {
  corkboard(v);
  // DAYS SINCE LAST COMPLAINT: 0.
  const [dx, dy] = at(2.65, 2.25, 0);
  blob(v, roundRectPts(dx - 80, dy - 14, 160, 28, 4), { fill: "#2a5a3a", seed: 7010, line: 1.8 });
  v.text("DAYS SINCE LAST COMPLAINT:", { x: dx - 14, y: dy }, { size: 8, fill: "#e8f0d8", align: "center", valign: "middle", style: "bold" });
  v.rect(dx + 54, dy - 9, 20, 18, { fill: "#f0ead8" });
  v.text("0", { x: dx + 64, y: dy + 1 }, { size: 13, fill: "#2a2a2a", align: "center", valign: "middle", style: "bold" });
  // The SUGGESTIONS slot: brass, polished by use, its pipe running down to the floor.
  const [sx, sy] = at(SLOT_X, 1.3, 0);
  blob(v, roundRectPts(sx - 34, sy - 22, 68, 44, 8), { fill: "#c8a050", light: "#f0d080", dark: "#8a6a2a", seed: 7020, line: 2.2, shadeSide: "right" });
  v.rect(sx - 22, sy - 3, 44, 6, { fill: "#1a1210" });
  v.text("SUGGESTIONS", { x: sx, y: sy - 12 }, { size: 7, fill: "#3a2a10", align: "center", valign: "middle", style: "bold" });
  v.text("all considered", { x: sx, y: sy + 13 }, { size: 6, fill: "#3a2a10", align: "center", valign: "middle", style: "italic" });
  pipe(v, [[SLOT_X, 1.12], [SLOT_X, 0.5], [SLOT_X + 0.25, 0.25], [SLOT_X + 0.25, -0.1]], { colour: "#8a6a4a", width: 0.14, seed: 7030 });
  amaSpeaker(v, 1.2, 2.05);
  // The terminal's label.
  const [lx, ly] = at(TERM.x, 1.62, 0);
  placard(v, lx, ly, ["YOUR VOICE MATTERS*"], { w: 120, size: 9, bg: "#e8e0c8", ink: "#2a3a5a", seed: 7040, rot: -0.02 });
  v.text("*to Ama", { x: lx + 46, y: ly + 16 }, { size: 8, fill: "#1a1a20", align: "center", valign: "middle", style: "italic" });
}

function furniture(v: View): void {
  // The terminal on its moulded desk, with a keyboard.
  crate(v, TERM.x, 0.45, { w: 0.7, h: 0.92, colour: "#e8783a", seed: 7100 });
  crt(v, TERM, 7101);
  const [kx, ky] = at(TERM.x + 0.05, 0.92, 0.75);
  blob(v, [[kx - 34, ky], [kx + 34, ky], [kx + 30, ky - 8], [kx - 30, ky - 8]], { fill: "#c8b898", seed: 7110, line: 1.6 });
  for (let i = 0; i < 7; i++) v.rect(kx - 26 + i * 8, ky - 6, 5, 3, { fill: "#6a5a4a" });
  // The incinerator hatch the suggestion pipe feeds.
  const [ix, iy] = at(SLOT_X + 0.25, 0, 0.55);
  blob(v, ellipsePts(ix, iy, 30, 8), { fill: "#3a3a3e", light: "#5a5a60", seed: 7120, line: 2 });
  v.text("INCINERATOR", { x: ix, y: iy + 16 }, { size: 6, fill: "#e8b83a", align: "center", valign: "middle", style: "bold" });
  // A coffee urn on a cabinet: the real reason people come.
  crate(v, 3.42, 0.45, { w: 0.55, h: 0.8, colour: "#7a5a3a", seed: 7130 });
  const [ux, uy] = at(3.42, 0.8, 0.45);
  blob(v, roundRectPts(ux - 18, uy - m(0.42), 36, m(0.42), 8), { fill: "#c8c8cc", light: "#f0f0f4", dark: "#7a7a80", seed: 7131, line: 2, shadeSide: "right" });
  v.rect(ux - 4, uy - 10, 8, 6, { fill: "#2a2a2e" });
  for (const dx of [26, 38]) blob(v, [[ux + dx - 5, uy], [ux + dx + 5, uy], [ux + dx + 6, uy - 12], [ux + dx - 6, uy - 12]], { fill: "#f0ead8", seed: 7132 + dx, line: 1.2 });
  placard(v, ux, uy - m(0.56), ["COFFEE", "(ALLEGED)"], { w: 60, size: 7, bg: "#f0ead8", ink: "#5a2a1a", seed: 7140, rot: 0.04 });
  globeLamp(v, 2.0, 2.15, CEIL, "#f0a040");
}

/** The terminal's replies, typed out a letter at a time. */
const REPLIES = ["COMPLAINT #88,213", "RECEIVED.", "THANK YOU FOR", "YOUR SATISFACTION."] as const;
const CHAT: readonly [string, number][] = [["did you hear about cube 7?", 0], ["I complained about the queue", 1], ["...for the queue?", 0], ["it's a good queue though", 1], ["same time tomorrow?", 0]];

export const FEEDBACK_BOOTH: RoomSpec = {
  id: "feedback-booth",
  name: "Feedback Booth",
  width: W,
  ceiling: CEIL,
  wall: "#6b7280",
  trim: "#7a4a2a",
  sky: "paper-planes",
  floor: "carpet",
  floorColour: "#7a3a2a",
  ambient: "#c8b8a8",
  exits: [
    { to: "Quiet Plaza", kind: "edge-right", label: "Quiet Plaza", glow: "#a855f7" },
  ],
  paintWall,
  paintFurniture: furniture,
  live: (v, t) => {
    lampGlow(v, 2.0, 2.15, "#ffb060", 0.4);
    // The terminal: green text typed out, a block cursor, its glow on the wall.
    const s = crtScreen(TERM);
    const n = Math.floor((t % 180) * 0.6);
    let left = n;
    for (const [i, line] of REPLIES.entries()) {
      const shown = line.slice(0, Math.max(0, Math.min(line.length, left)));
      left -= line.length;
      v.text(shown, { x: s.x + 4, y: s.y + 6 + i * 8 }, { size: 6, fill: "#70ff90", style: "bold", font: "Courier New, monospace" });
    }
    if (Math.floor(t / 10) % 2 === 0) v.rect(s.x + 4, s.y + 36, 4, 6, { fill: "#70ff90" });
    glow(v, s.x + s.w / 2, s.y + s.h / 2, { rx: 90, ry: 70, colour: "#60ff90", alpha: 0.28 + 0.04 * Math.sin(t * 0.3) });
    // The incinerator glows when the pipe swallows a suggestion.
    const [ix, iy] = at(SLOT_X + 0.25, 0, 0.55);
    glow(v, ix, iy, { rx: 40, ry: 14, colour: "#ff7a20", alpha: 0.25 + 0.35 * pulse(t, 90, 30, 20) });
    // At the terminal, typing.
    citizen(v, { x: TERM.x + 0.55, depth: 1.0, facing: -1, pose: "stand", suit: "#5a5a8a", collar: "#6b7280", number: "88" }, t);
    // The chat by the corkboard.
    citizen(v, { x: 2.25, depth: 2.1, facing: 1, pose: "stand", suit: "#8a5a3a", collar: "#6b7280", number: "12", hair: "#c87a3a" }, t);
    citizen(v, { x: 3.1, depth: 2.2, facing: -1, pose: "stand", suit: "#3a7a6a", collar: "#6b7280", number: "11", hair: "#e8d8b0" }, t);
    const line = CHAT[Math.floor(t / 60) % CHAT.length] ?? ["...", 0];
    const a = Math.min(1, (t % 60) / 6, (60 - (t % 60)) / 6);
    const [px, py] = line[1] === 0 ? at(2.3, 1.75, 2.1) : at(3.05, 1.75, 2.2);
    speech(v, px, py, line[0], a, { size: 10, side: line[1] === 0 ? 1 : -1 });
    // A complaint, folded into a plane, making a slow lap of the booth.
    const u = (t % 240) / 240;
    const fx = m(0.3) + u * m(3.8), fy = at(0, 1.95 + Math.sin(u * Math.PI * 2) * 0.25, 1.5)[1];
    v.at({ translate: [fx, fy], rotate: Math.cos(u * Math.PI * 2) * -0.3 }, () => {
      v.polygon([[14, 0], [-10, -7], [-5, 0], [-10, 7]], { fill: "#f8f4e8", stroke: "#241c17", weight: 1.2 });
      v.line(-5, 0, 14, 0, { stroke: "#8a8070", weight: 0.8 });
    });
    amaEye(v, 1.2, 2.05, t);
  },
  rim: { x: 200, y: 330, colour: "#a0ffb0", reach: 300 },
};
