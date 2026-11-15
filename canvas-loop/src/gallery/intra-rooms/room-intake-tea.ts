// Intake. From intra-game: "Intake: a small room with a padded examination table.
// The walls are lined with inscrutable equipment and screens, many of them
// non-functioning." The player wakes here.
// Exits (1): Foyer (edge-right).
import type { Vec2, SceneView as View } from "@ianbicking/canvas-loop";
import { INK, type RoomSpec, at, blob, ellipsePts, glow, hash, mixHex, roundRectPts, stroke } from "./kit-tea.js";
import { cabinet, cable, crackedScreen, dial, lamps, reel, screenFrame, trace } from "./parts-a-tea.js";
import { amaEye, amaSpeaker, citizen, pacing } from "./props-tea.js";
import { m } from "./sizes-tea.js";

const TABLE = { x: 2.75, depth: 1.4, len: 1.9, top: 0.78 };
const LAMP = { x: 2.95, h: 2.0, depth: 1.4 };
/** The rack with the reels, and the screen cabinet. */
const RACK = { x: 0.6, w: 0.85, h: 1.95 };
const SCREENS = { x: 1.62, w: 0.95, h: 1.8 };
/** The little monitors on the shelf: [x m, kind]. */
const MONITORS = [[2.42, "calm"], [2.8, "dead"], [3.18, "clone"]] as const;

function rackScreenRects(): { ecg: { x: number; y: number; w: number; h: number }; broken: { x: number; y: number; w: number; h: number } } {
  const [px, py] = at(SCREENS.x, SCREENS.h, 0.3);
  const w = m(SCREENS.w);
  return { ecg: { x: px - w / 2 + 12, y: py + 26, w: w - 24, h: 52 }, broken: { x: px - w / 2 + 12, y: py + 90, w: w * 0.55, h: 46 } };
}
function reelCentres(): [Vec2, Vec2] {
  const [px, py] = at(RACK.x, RACK.h, 0.3);
  return [[px - 28, py + 50], [px + 28, py + 50]];
}
function monitorRect(x: number): { x: number; y: number; w: number; h: number } {
  const [px, py] = at(x, 2.08, 0);
  return { x: px - 20, y: py - 34, w: 40, h: 28 };
}

function equipment(v: View): void {
  // The reel-to-reel rack.
  const r = cabinet(v, RACK.x, RACK.w, RACK.h, { colour: "#c8bca0", seed: 2000 });
  blob(v, roundRectPts(r.x + 8, r.y + 18, r.w - 16, 66, 6), { fill: "#3a3430", seed: 2010, line: 1.6 });
  for (let i = 0; i < 3; i++) dial(v, r.x + 22 + i * 30, r.y + 104, 11, hash(i, 0, 2011), 2012 + i);
  for (let i = 0; i < 6; i++) {
    const sx = r.x + 14 + i * 16, sy = r.y + 136;
    v.rect(sx, sy, 6, 14, { fill: "#2a2420" });
    v.rect(sx - 1, sy + (i % 2 === 0 ? 0 : 8), 8, 6, { fill: "#d8d8dc", stroke: INK, weight: 1 });
  }
  v.text("CITIZEN", { x: r.x + r.w / 2, y: r.y + 170 }, { size: 8, fill: "#3a2a20", align: "center", valign: "middle", style: "bold" });
  v.text("RECONSTITUTION", { x: r.x + r.w / 2, y: r.y + 180 }, { size: 7, fill: "#3a2a20", align: "center", valign: "middle", style: "bold" });
  // A drawer that never shut, with a printout spilling from it.
  blob(v, roundRectPts(r.x + 10, r.y + 196, r.w - 20, 26, 3), { fill: "#b0a488", seed: 2020, line: 1.6 });
  blob(v, [[r.x + 30, r.y + 210], [r.x + 54, r.y + 210], [r.x + 60, r.y + 250], [r.x + 46, r.y + 256], [r.x + 36, r.y + 236]], { fill: "#f0ecdc", seed: 2021, line: 1.2, amp: 0.6 });
  for (let i = 0; i < 4; i++) v.line(r.x + 36, r.y + 216 + i * 8, r.x + 50, r.y + 216 + i * 8, { stroke: "#8a8a8a", weight: 1 });

  // The screen cabinet: a heart trace, a dead screen, a slot.
  const s = cabinet(v, SCREENS.x, SCREENS.w, SCREENS.h, { colour: "#a8b49a", seed: 2030 });
  const { ecg, broken } = rackScreenRects();
  screenFrame(v, ecg.x, ecg.y, ecg.w, ecg.h, 2031);
  screenFrame(v, broken.x, broken.y, broken.w, broken.h, 2033);
  crackedScreen(v, broken.x, broken.y, broken.w, broken.h, 2035);
  for (let i = 0; i < 2; i++) dial(v, s.x + s.w - 24, s.y + 100 + i * 28, 10, 0.2 + i * 0.6, 2040 + i);
  blob(v, roundRectPts(s.x + 16, s.y + 160, s.w - 32, 14, 3), { fill: "#1a1614", seed: 2045, line: 1.4 });
  v.text("INSERT CITIZEN", { x: s.x + s.w / 2, y: s.y + 186 }, { size: 8, fill: "#2a2a20", align: "center", valign: "middle", style: "bold" });
  v.text("FACE UP", { x: s.x + s.w / 2, y: s.y + 196 }, { size: 7, fill: "#2a2a20", align: "center", valign: "middle" });

  // A shelf of little monitors on brackets: one calm, one dead, one counting.
  const [ax, ay] = at(2.2, 2.08, 0), [bx] = at(3.4, 2.08, 0);
  blob(v, roundRectPts(ax, ay - 4, bx - ax, 9, 2), { fill: "#8a7a64", seed: 2050, line: 1.6 });
  for (const x of [ax + 12, bx - 12]) stroke(v, [[x, ay + 4], [x, ay + 26], [x - 18, ay + 4]], { seed: 2051 + x, weight: 2.4, colour: "#5a5048" });
  for (const [i, [x, kind]] of MONITORS.entries()) {
    const mr = monitorRect(x);
    const tilt = kind === "dead" ? 0.07 : 0;
    v.at({ translate: [mr.x + mr.w / 2, mr.y + mr.h + 6], rotate: tilt }, () => {
      blob(v, roundRectPts(-27, -mr.h - 14, 54, mr.h + 18, 7), { fill: ["#d8cca8", "#c8a070", "#b8c0b0"][i] ?? "#d8cca8", dark: "#5a5048", seed: 2060 + i * 4, line: 2, shadeSide: "right" });
      blob(v, roundRectPts(-20, -mr.h - 6, 40, mr.h, 6), { fill: "#0e1412", seed: 2061 + i * 4, line: 1.4, amp: 0.3 });
      if (kind === "dead") {
        v.rect(-8, -mr.h - 2, 16, 14, { fill: "#f0e070" });
        v.text("?", { x: 0, y: -mr.h + 5 }, { size: 10, fill: "#3a2a10", align: "center", valign: "middle", style: "bold" });
      }
    });
    cable(v, [mr.x + mr.w / 2, mr.y + mr.h + 10], [mr.x + mr.w / 2 + 10, at(0, 0, 0)[1] - m(0.5)], 6, 2070 + i, "#3a3a3e");
  }

  // The eye chart: read it top to bottom.
  const [ex, ey] = at(3.92, 1.36, 0);
  blob(v, [[ex - 30, ey - 46], [ex + 30, ey - 46], [ex + 30, ey + 46], [ex - 30, ey + 46]], { fill: "#f0ece0", dark: "#a8a090", seed: 2080, line: 1.6 });
  for (const [line, size, dy] of [["T", 22, 0], ["RU", 15, 21], ["ST", 12, 38], ["AMA", 9, 52], ["SHE SEES", 5, 63]] as const) {
    v.text(line, { x: ex, y: ey - 32 + dy },{ size, fill: INK, align: "center", valign: "middle", style: "bold", font: "Helvetica, Arial, sans-serif" });
  }
  v.text("YOU", { x: ex, y: ey + 38 }, { size: 4, fill: INK, align: "center", valign: "middle" });
}

function cables(v: View): void {
  const floor = at(0, 0, 0.3)[1];
  const [tx, ty] = at(TABLE.x - 0.4, 0.3, TABLE.depth);
  cable(v, [m(RACK.x + 0.3), floor - 20], [tx, ty], 34, 2090, "#2a2a2e");
  cable(v, [m(SCREENS.x + 0.2), floor - 20], [tx + 20, ty + 6], 26, 2091, "#8a2a1a");
  cable(v, [m(SCREENS.x - 0.1), floor - 30], [tx + 40, ty], 40, 2092, "#3a5a8a");
}

function table(v: View): void {
  const [cx, foot] = at(TABLE.x, 0, TABLE.depth);
  const half = m(TABLE.len) / 2, top = foot - m(TABLE.top);
  // Chrome base: two splayed legs and a crossbar.
  for (const dx of [-half + 30, half - 30]) {
    stroke(v, [[cx + dx - 14, foot], [cx + dx, top + 30]], { seed: 2100 + dx, weight: 6, colour: "#a8acb0" });
    stroke(v, [[cx + dx + 14, foot], [cx + dx, top + 30]], { seed: 2101 + dx, weight: 6, colour: "#a8acb0" });
    stroke(v, [[cx + dx - 14, foot], [cx + dx, top + 30], [cx + dx + 14, foot]], { seed: 2102 + dx, weight: 1.2, amp: 0.4 });
  }
  stroke(v, [[cx - half + 30, foot - 34], [cx + half - 30, foot - 34]], { seed: 2105, weight: 5, colour: "#a8acb0" });
  // A step stool tucked under.
  blob(v, roundRectPts(cx + 20, foot - m(0.24), m(0.42), m(0.24), 4), { fill: "#c8642a", seed: 2106, line: 1.8 });
  // The frame, then the padded top in orange vinyl, the head end raised.
  blob(v, roundRectPts(cx - half, top + 22, half * 2, 14, 3), { fill: "#d0d0d4", light: "#f0f0f4", seed: 2110, line: 2 });
  const pad: Vec2[] = [[cx - half + 4, top + 24], [cx + half - 2, top + 24], [cx + half + 4, top + 8], [cx + half - 4, top - 2], [cx - half + m(0.5), top - 2], [cx - half + 30, top - m(0.3)], [cx - half + 8, top - m(0.3) + 6], [cx - half - 6, top + 12]];
  const vinyl = "#c8642a";
  blob(v, pad, { fill: vinyl, light: mixHex(vinyl, "#ffffff", 0.35), dark: mixHex(vinyl, "#000000", 0.35), seed: 2111, line: 2.4, shadeSide: "bottom" });
  // Tufting buttons and the seams between them.
  for (let i = 0; i < 6; i++) {
    const bx = cx - half + m(0.6) + i * m(0.22), by = top + 10;
    v.circle(bx, by, 2.2, { fill: mixHex(vinyl, "#000000", 0.5) });
    if (i < 5) stroke(v, [[bx + 3, by], [bx + m(0.22) - 3, by]], { seed: 2120 + i, weight: 1, colour: mixHex(vinyl, "#000000", 0.4), amp: 1.2 });
  }
  // A split in the vinyl with the stuffing coming out, taped over (badly).
  stroke(v, [[cx + 30, top + 2], [cx + 46, top + 8], [cx + 58, top + 4]], { seed: 2130, weight: 1.6 });
  blob(v, ellipsePts(cx + 46, top + 2, 12, 6, 12), { fill: "#f0e0a0", seed: 2131, line: 1, amp: 1.5 });
  v.at({ translate: [cx + 70, top + 8], rotate: 0.3 }, () => v.rect(-12, -4, 24, 8, { fill: "rgba(200,200,190,0.8)" }));
  // The paper sheet, torn, with the dent of whoever just got up.
  const sheet: Vec2[] = [[cx - half + m(0.48), top - 4], [cx + half - 12, top - 4], [cx + half - 10, top + 6], [cx + half - 30, top + 10], [cx + half - 44, top + 6], [cx - half + m(0.5), top + 6]];
  blob(v, sheet, { fill: "#f4f0e4", seed: 2140, line: 1.2, amp: 0.8 });
  blob(v, ellipsePts(cx - 6, top - 2, 70, 4), { fill: "rgba(120,90,70,0.25)", seed: 2141, line: 0.1 });
  // The paper roll at the foot and a flat pillow at the head.
  blob(v, ellipsePts(cx + half + 4, top + 2, 10, 12), { fill: "#f4f0e4", seed: 2142, line: 1.6 });
  v.circle(cx + half + 4, top + 2, 3, { fill: "#8a7a64" });
  blob(v, [[cx - half + 10, top - m(0.3) + 2], [cx - half + 38, top - m(0.3) - 4], [cx - half + 52, top - m(0.3) + 14], [cx - half + 20, top - m(0.3) + 22]], { fill: "#e8e4f0", light: "#ffffff", seed: 2143, line: 1.6 });
  // A tag on the leg: the table's own number.
  v.rect(cx - half + 36, foot - 58, 18, 10, { fill: "#e8dcc0", stroke: INK, weight: 1 });
  v.text("#2", { x: cx - half + 45, y: foot - 53 }, { size: 7, fill: INK, align: "center", valign: "middle", style: "bold" });
}

function lamp(v: View): void {
  const [lx, ly] = at(LAMP.x, LAMP.h, LAMP.depth);
  const [, ceil] = at(LAMP.x, 3, 0);
  // Ceiling mount, a two-part arm with a spring, the dish.
  const mx = lx + 78;
  blob(v, roundRectPts(mx - 14, ceil - 4, 28, 14, 4), { fill: "#a8acb0", seed: 2150, line: 1.6 });
  const elbow: Vec2 = [lx + 96, ly - 76];
  stroke(v, [[mx, ceil + 8], elbow], { seed: 2151, weight: 6, colour: "#c8c8cc" });
  stroke(v, [elbow, [lx + 6, ly - 22]], { seed: 2152, weight: 6, colour: "#c8c8cc" });
  stroke(v, [[mx, ceil + 8], elbow, [lx + 6, ly - 22]], { seed: 2153, weight: 1.4, amp: 0.4 });
  for (let i = 0; i < 6; i++) v.circle(elbow[0] - 10 - i * 6, elbow[1] + 8 + i * 4, 3, { stroke: "#5a5a5e", weight: 1.2 });
  v.circle(elbow[0], elbow[1], 6, { fill: "#5a5a5e", stroke: INK, weight: 1.4 });
  const dish: Vec2[] = [[lx - 44, ly], [lx - 30, ly - 22], [lx, ly - 30], [lx + 30, ly - 22], [lx + 44, ly], [lx, ly + 6]];
  blob(v, dish, { fill: "#e8e0c8", light: "#ffffff", dark: "#8a8270", seed: 2154, line: 2.2, shadeSide: "right" });
  blob(v, ellipsePts(lx, ly + 1, 40, 6), { fill: "#fff8d8", seed: 2155, line: 1.6 });
}

function cart(v: View): void {
  const [cx, foot] = at(0.5, 0, 2.3);
  const w = m(0.55);
  for (const dx of [-w / 2 + 4, w / 2 - 4]) stroke(v, [[cx + dx, foot - 8], [cx + dx, foot - m(0.82)]], { seed: 2160 + dx, weight: 3, colour: "#b8bcc0" });
  for (const h of [0.3, 0.8]) blob(v, roundRectPts(cx - w / 2 - 4, foot - m(h) - 5, w + 8, 8, 2), { fill: "#d0d4d8", light: "#ffffff", seed: 2161 + h * 10, line: 1.6 });
  for (const dx of [-w / 2 + 4, w / 2 - 4]) blob(v, ellipsePts(cx + dx, foot - 4, 5, 5), { fill: "#2a2a2e", seed: 2170 + dx, line: 1.2 });
  const top = foot - m(0.8) - 5;
  // A kidney dish, a reflex hammer, a jar of lollipops for good citizens.
  blob(v, [[cx - 34, top], [cx - 4, top], [cx - 6, top - 7], [cx - 20, top - 4], [cx - 32, top - 7]], { fill: "#c8ccd0", seed: 2171, line: 1.4 });
  stroke(v, [[cx - 2, top - 2], [cx + 14, top - 12]], { seed: 2172, weight: 2, colour: "#a8a8ac" });
  blob(v, [[cx + 10, top - 16], [cx + 22, top - 10], [cx + 18, top - 6], [cx + 6, top - 12]], { fill: "#c83a2a", seed: 2173, line: 1.2 });
  blob(v, roundRectPts(cx + 18, top - 30, 20, 30, 4), { fill: "rgba(210,230,240,0.55)", seed: 2174, line: 1.4 });
  for (let i = 0; i < 3; i++) {
    stroke(v, [[cx + 23 + i * 5, top - 8], [cx + 21 + i * 6, top - 38]], { seed: 2175 + i, weight: 1, colour: "#e8e0d0", amp: 0.3 });
    v.circle(cx + 21 + i * 6, top - 40, 4, { fill: ["#e84a6a", "#f8c840", "#5ab8e8"][i] ?? "#e84a6a", stroke: INK, weight: 1 });
  }
  // A clipboard on the lower shelf.
  blob(v, roundRectPts(cx - 20, foot - m(0.3) - 26, 30, 22, 2), { fill: "#a87a4a", seed: 2180, line: 1.4 });
  v.rect(cx - 16, foot - m(0.3) - 24, 22, 17, { fill: "#f0ece0" });
  v.text("APTITUDE", { x: cx - 5, y: foot - m(0.3) - 19 }, { size: 4, fill: INK, align: "center", valign: "middle", style: "bold" });
}

/** The paper gown on a hook, for the next one. */
function gown(v: View): void {
  const [hx, hy] = at(4.3, 1.95, 0);
  stroke(v, [[hx - 4, hy], [hx + 4, hy], [hx + 4, hy + 6]], { seed: 2190, weight: 2.4, colour: "#8a8a8e" });
  blob(v, [[hx - 8, hy + 4], [hx + 8, hy + 4], [hx + 26, hy + 30], [hx + 22, hy + 120], [hx - 20, hy + 124], [hx - 26, hy + 30]], { fill: "#d8e4e8", light: "#ffffff", dark: "#8a9aa0", seed: 2191, line: 1.8, shadeSide: "right" });
  for (let i = 0; i < 3; i++) stroke(v, [[hx - 6 + i * 6, hy + 30], [hx - 10 + i * 8, hy + 118]], { seed: 2192 + i, weight: 1, colour: "#9aaab0", amp: 1.2 });
  v.text("ONE SIZE", { x: hx, y: hy + 60 }, { size: 6, fill: "#3a4a50", align: "center", valign: "middle", style: "bold" });
}

function wallPieces(v: View): void {
  equipment(v);
  gown(v);
  amaSpeaker(v, 3.92, 2.08);
}
function furniture(v: View): void {
  cables(v);
  table(v);
  cart(v);
  lamp(v);
}

function live(v: View, t: number): void {
  // The reels: one turns steadily, the other stutters.
  const [ra, rb] = reelCentres();
  reel(v, ra[0], ra[1], 22, t * 0.08, 0.8);
  reel(v, rb[0], rb[1], 22, Math.floor(t / 14) * 1.1, 0.35);
  const [rx, ry] = at(RACK.x, RACK.h, 0.3);
  lamps(v, rx - m(RACK.w) / 2 + 14, ry + 154, 7, t, { seed: 2200, gap: 10 });
  // The heart trace (someone's), the shelf monitors.
  const { ecg } = rackScreenRects();
  trace(v, ecg.x, ecg.y, ecg.w, ecg.h, t, "#5af08a");
  v.text(`${(68 + Math.floor(hash(Math.floor(t / 20), 0, 2201) * 9)).toString()}`, { x: ecg.x + ecg.w - 14, y: ecg.y + 10 }, { size: 9, fill: "#5af08a", align: "center", valign: "middle", style: "bold" });
  const [sx, sy] = at(SCREENS.x, SCREENS.h, 0.3);
  lamps(v, sx - 30, sy + 148, 4, t, { seed: 2202, gap: 12, colours: ["#ff4a3a"], rate: 20 });
  for (const [x, kind] of MONITORS) {
    const mr = monitorRect(x);
    const cx = mr.x + mr.w / 2, cy = mr.y + mr.h / 2 - 2;
    if (kind === "calm") {
      const on = Math.floor(t / 16) % 2 === 0;
      v.rect(mr.x + 2, mr.y + 2 - 2, mr.w - 4, mr.h - 4, { fill: "rgba(90,200,240,0.18)" });
      if (on) {
        v.text("REMAIN", { x: cx, y: cy - 5 }, { size: 7, fill: "#9ae8ff", align: "center", valign: "middle", style: "bold" });
        v.text("CALM", { x: cx, y: cy + 5 }, { size: 7, fill: "#9ae8ff", align: "center", valign: "middle", style: "bold" });
      }
      glow(v, cx, cy, { rx: 34, colour: "#6ad0ff", alpha: 0.3 });
    } else if (kind === "clone") {
      // The counter of how many times this citizen has woken up here.
      const n = 2 + Math.floor(t / 200);
      v.text("CLONE", { x: cx, y: cy - 5 }, { size: 7, fill: "#ffb040", align: "center", valign: "middle", style: "bold" });
      v.text(`${n.toString()} OF 6`, { x: cx, y: cy + 5 }, { size: 7, fill: "#ffb040", align: "center", valign: "middle", style: "bold" });
      glow(v, cx, cy, { rx: 34, colour: "#ffa030", alpha: 0.28 });
    } else if (hash(Math.floor(t / 4), 1, 2203) < 0.08) {
      // The dead one tries, now and then.
      v.rect(mr.x + 3, mr.y + 2 + hash(t, 0, 2204) * (mr.h - 8), mr.w - 6, 3, { fill: "rgba(220,240,255,0.7)" });
    }
  }
  // The examination lamp: a hard cone of light down onto the table, buzzing.
  const [lx, ly] = at(LAMP.x, LAMP.h, LAMP.depth);
  const buzz = hash(Math.floor(t / 3), 0, 2210) < 0.06 ? 0.4 : 1;
  const [, tableTop] = at(TABLE.x, TABLE.top, TABLE.depth);
  v.polygon([[lx - 38, ly + 4], [lx + 38, ly + 4], [lx + 130, tableTop + 4], [lx - 150, tableTop + 4]], { fill: v.linearGradient(0, ly, 0, tableTop, [[0, `rgba(255,248,210,${(0.32 * buzz).toFixed(3)})`], [1, "rgba(255,248,210,0)"]]), blend: "screen" });
  glow(v, lx - 10, tableTop, { rx: 160, ry: 34, colour: "#fff4c8", alpha: 0.4 * buzz });
  glow(v, lx, ly + 2, { rx: 50, ry: 16, colour: "#ffffff", alpha: 0.7 * buzz });
  amaEye(v, 3.92, 2.08, t);
  // The newest citizen: no number yet.
  const w = pacing(t + 120, 1.7, 4.3, 0.006);
  citizen(v, { x: w.x, facing: w.facing, pose: "walk", suit: "#8a8a7a", collar: "#84cc16", hair: "#6a4a2a", number: "--" }, t);
}

export const INTAKE: RoomSpec = {
  id: "intake",
  name: "Intake",
  width: 4.8,
  wall: "#84cc16",
  trim: "#3a5a1a",
  sky: "test-card",
  dead: [1],
  floor: "lino",
  floorColour: "#8a9a86",
  ambient: "#a8b8a8",
  exits: [
    { to: "Foyer", kind: "edge-right", label: "Foyer", glow: "#10b981" },
  ],
  paintWall: wallPieces,
  paintFurniture: furniture,
  live,
  rim: { x: m(LAMP.x), y: 380, colour: "#fff4c8", reach: 400 },
};
