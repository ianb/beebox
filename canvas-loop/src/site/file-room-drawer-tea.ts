// The drawer that comes out toward the viewer: a dark opening, the tray of
// index cards seen from above (with a gap where a card was taken or will go),
// and the face, which grows and drops as it comes out. The parts are cached
// pictures placed at a few quantized sizes; the clerk's hand follows `pullAt`.
import type { Drawing, Vec2, View } from "@ianbicking/canvas-loop";
import { K, type Stop, slotOf } from "./file-room-layout-tea.js";
import { cardIndex, cardX, facePicture, trayPicture } from "./file-room-room-tea.js";
import { cabAt } from "./file-room-layout-tea.js";

export interface DrawerSpec {
  stop: Stop;
  /** 0 closed .. 1 fully out. */
  open: number;
  /** Index of the missing card in the tray, or -1 for a full row. */
  gap: number;
}

interface Xform {
  cx: number;
  cy: number;
  sx: number;
  sy: number;
  q: number;
  top: number;
}

/** Where the drawer face is, and how big, when `open` of the way out. Sizes step in quarters so the scaled pictures stay cached. */
function faceXform(stop: Stop, open: number): Xform {
  const s = slotOf(stop.cab, stop.row);
  const q = Math.max(0.25, Math.round(open * 4) / 4);
  return { cx: s.x + s.w / 2, cy: s.y + 36 * K + 26 * K * open, sx: K * (1 + 0.12 * q), sy: K * (1 + 0.1 * q), q, top: s.y };
}

/** The pull handle's end nearest the clerk: where their hand takes hold. */
export function pullAt(stop: Stop, open: number): Vec2 {
  const f = faceXform(stop, open);
  return [f.cx + stop.side * 24 * f.sx, f.cy + 11 * f.sy];
}

/** The top of the card standing at `index` in the open drawer, in canvas coordinates. */
export function cardTop(stop: Stop, index: number): Vec2 {
  const f = faceXform(stop, 1);
  return [f.cx + cardX(index) * K * 1.04, f.top + 2 * K + 12 * K];
}

export const trayIndex = (stop: Stop): number => cardIndex(stop.side);

export function openDrawer(v: View, spec: DrawerSpec): Drawing {
  const { stop, open, gap } = spec;
  if (open <= 0.001) return null;
  const s = slotOf(stop.cab, stop.row);
  const f = faceXform(stop, open);
  return [
    v.rect(s.x + 2 * K, s.y, s.w - 4 * K, s.h, { fill: "#0a0705" }),
    v.at({ translate: [f.cx, s.y + 2 * K], scale: [K * (1 + 0.04 * f.q), K * f.q] }, v.place(trayPicture(v, gap), 0, 0)),
    v.rect(f.cx - 78 * K, s.y + s.h + 26 * K * open - 4 * K, 156 * K, 10 * K, { fill: "rgba(0,0,0,0.45)" }),
    v.at({ translate: [f.cx, f.cy], scale: [f.sx, f.sy] }, v.place(facePicture(v, { variant: cabAt(stop.cab).variant, row: stop.row }), 0, 0)),
  ];
}
